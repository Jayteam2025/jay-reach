import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { resolveValidatorForDefaultWorkspace, isDemoMode } from "../_shared/providers/registry.ts";
import { reoonVerifyOne } from "../_shared/providers/reoon.ts";
import { fakeBouncerVerdicts } from "../_shared/providers/demo.ts";
import type { EmailValidator, ResolvedProvider } from "../_shared/providers/types.ts";

/**
 * bouncer-batch
 *
 * Cron 2x/jour (08:00 et 14:00 Europe/Paris).
 * Selectionne jusqu'a 500 profils unverified, dedoublonne par email,
 * route vers le validateur ACTIF (Bouncer webhook OU Reoon sync).
 *
 * Auth : 3 paths
 *  - Bearer SUPABASE_SERVICE_ROLE_KEY (test manuel)
 *  - Bearer CRON_SECRET (pg_cron)
 *  - Bearer <user JWT> avec profile.role='admin' (UI bouton 'Verifier emails')
 *
 * Query params :
 *  - ?emails=a,b,c  : liste explicite d'emails a verifier (sinon prend deliverability_status NULL)
 *  - ?company_group_id=<uuid> : restreint au groupe d'entreprise (pour bouton UI)
 *  - ?limit=N : limite batch (default 500, max 500)
 *  - ?since_hours=N : balayage restreint aux profils crees < N heures (sweep fin de job)
 */

const BATCH_LIMIT = 500;
const MAX_VERIFICATIONS_PER_RUN = 250; // Limite synchrone par cron tick (Reoon)

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  const webhookToken = Deno.env.get("BOUNCER_WEBHOOK_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: "Service key missing" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Resout le validateur ACTIF (Bouncer reel, Reoon, ou mode demo).
  let provider: EmailValidator | null;
  let context: ResolvedProvider;
  try {
    const resolved = await resolveValidatorForDefaultWorkspace(supabase);
    provider = resolved.provider;
    context = resolved.context;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[bouncer-batch] validator resolve failed: ${message}`);
    return new Response(JSON.stringify({ error: `Validator not configured: ${message}` }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const demoMode = provider === null || isDemoMode(context);

  // Auth : 3 paths
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");

  let authorized = false;
  if (token && (token === serviceKey || token === cronSecret)) {
    authorized = true;
  } else if (token) {
    // Tente JWT user + check admin role
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (!authError && user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        if (profile?.role === "admin") {
          authorized = true;
        }
      }
    } catch {
      // fall through to 401
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Query params
  const url = new URL(req.url);
  const emailsParam = url.searchParams.get("emails");
  const companyGroupId = url.searchParams.get("company_group_id");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || BATCH_LIMIT, BATCH_LIMIT) : BATCH_LIMIT;
  // Mode balayage restreint aux profils recents : evite qu'un sweep de fin de
  // job (spawn_bouncer_sweep) consomme le cap quotidien sur le vieux backlog
  // jamais valide (profils anterieurs au pipeline de validation).
  const sinceHoursParam = url.searchParams.get("since_hours");
  const sinceHours = sinceHoursParam ? parseInt(sinceHoursParam, 10) || 0 : 0;

  // 1. Selectionne profils unverified (ou liste explicite si emails param, ou par entreprise)
  let query = supabase
    .from("prospect_profiles")
    .select("id, email")
    .is("deleted_at", null)
    .not("email", "is", null);

  if (emailsParam) {
    const emails = emailsParam.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    query = query.in("email", emails);
  } else if (companyGroupId) {
    // Mode UI : verifie tous les leads d'une entreprise qui n'ont pas encore de verdict
    query = query
      .eq("company_group_id", companyGroupId)
      .is("deliverability_status", null);
  } else {
    query = query
      .is("deliverability_status", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (sinceHours > 0) {
      query = query.gte("created_at", new Date(Date.now() - sinceHours * 3_600_000).toISOString());
    }
  }

  const { data: profiles, error } = await query;

  if (error) {
    console.error(`[bouncer-batch] query failed: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (!profiles || profiles.length === 0) {
    return new Response(JSON.stringify({ ok: true, queued: 0 }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // 2. Dedoublonne par email (cas plusieurs prospect_id sur meme email)
  const uniqueEmails = Array.from(new Set(profiles.map(p => p.email!.toLowerCase())));
  const profileIds = profiles.map(p => p.id);

  // Helper pour retrouver les IDs d'un email (avoid ilike jokers)
  const idsForEmail = (em: string) =>
    profiles.filter(p => (p.email ?? "").toLowerCase() === em.toLowerCase()).map(p => p.id);

  // 3a. Mode demo : fake les verdicts immediatement, dual-write
  if (demoMode) {
    const verdicts = fakeBouncerVerdicts(uniqueEmails);
    const now = new Date().toISOString();
    for (const v of verdicts) {
      const ids = idsForEmail(v.email);
      if (ids.length === 0) continue;
      await supabase
        .from("prospect_profiles")
        .update({
          deliverability_status: v.verdict,
          deliverability_reason: v.reason,
          deliverability_checked_at: now,
          deliverability_provider: "demo",
        })
        .in("id", ids);
    }
    console.log(`[bouncer-batch] demo mode: ${verdicts.length} fake verdicts written`);
    return new Response(JSON.stringify({
      ok: true, demo: true, queued: verdicts.length, distribution: distributionOf(verdicts),
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // 3b. Branche selon le mode de livraison du validateur
  if (provider && provider.deliveryMode === "webhook") {
    // ──── Mode webhook (Bouncer) ────
    if (!webhookToken) {
      return new Response(JSON.stringify({ error: "Bouncer webhook token missing" }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const callbackUrl = `${supabaseUrl}/functions/v1/bouncer-webhook?token=${webhookToken}`;
    (context.config as Record<string, unknown>).callback_url = callbackUrl;
    let result;
    try {
      result = await provider.submitBatch(uniqueEmails, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[bouncer-batch] submit failed: ${message}`);
      return new Response(JSON.stringify({ error: message }), {
        status: 502, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Track le job
    await supabase.from("bouncer_jobs").insert({
      job_id: result.providerBatchId,
      profile_ids: profileIds,
      status: "pending",
    });

    console.log(`[bouncer-batch] webhook mode: submitted job_id=${result.providerBatchId} emails=${uniqueEmails.length} profiles=${profileIds.length}`);

    return new Response(JSON.stringify({
      ok: true,
      provider: provider.type,
      queued: uniqueEmails.length,
      job_id: result.providerBatchId,
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

  } else if (provider && provider.deliveryMode === "sync") {
    // ──── Mode sync (Reoon) ────
    const now = new Date().toISOString();
    let processed = 0;
    let verified = 0;

    for (const email of uniqueEmails) {
      if (processed >= MAX_VERIFICATIONS_PER_RUN) {
        console.log(`[bouncer-batch] sync mode: hit MAX_VERIFICATIONS_PER_RUN (${MAX_VERIFICATIONS_PER_RUN}), pausing`);
        break;
      }

      // Consommer 1 credit via RPC
      const { data: quotaOk, error: quotaErr } = await supabase.rpc("consume_reoon_credit", { p_count: 1 });
      if (quotaErr || !quotaOk) {
        console.log(`[bouncer-batch] sync mode: quota exhausted at email ${email}, stopping`);
        break;
      }

      try {
        const result = await reoonVerifyOne(context.apiKey, email);
        const ids = idsForEmail(email);
        if (ids.length > 0) {
          await supabase
            .from("prospect_profiles")
            .update({
              deliverability_status: result.verdict,
              deliverability_reason: result.reason,
              deliverability_checked_at: now,
              deliverability_provider: context.providerType,
            })
            .in("id", ids);
          verified++;
        }
        processed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[bouncer-batch] sync mode: reoonVerifyOne failed for ${email}: ${message}`);
        processed++;
      }
    }

    console.log(`[bouncer-batch] sync mode: processed=${processed} verified=${verified}`);

    return new Response(JSON.stringify({
      ok: true,
      provider: provider.type,
      processed,
      verified,
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } else {
    return new Response(JSON.stringify({ error: "Provider adapter not available" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

function distributionOf(verdicts: Array<{ verdict: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of verdicts) out[v.verdict] = (out[v.verdict] ?? 0) + 1;
  return out;
}
