import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createResendService } from "../_shared/resend.ts";
import { loadWorkspaceBrand, type WorkspaceBrand } from "../_shared/workspace-brand.ts";

/**
 * prospect-weekly-recap
 *
 * Email business envoye lundi 07:00 UTC (09:00 Paris ete) a chaque
 * workspace ayant configure des notification_recipients dans workspace_brand.
 * Non technique. Resume la prospection preparee pour la semaine :
 * top entreprises scorees + contacts LinkedIn a contacter.
 *
 * Multi-tenant (Jay Reach 1.3.2) :
 * - Boucle sur tous les workspaces ayant des recipients configures
 * - Toutes les queries sont scoped a workspace_id pour ne jamais leaker
 * - brand_name, founder_name et app_url sont resolus par workspace
 */

interface ProspectSignal {
  id: string;
  company_name: string | null;
  extracted_data: Record<string, unknown> | null;
}

const SCORE_THRESHOLD = 70;
const TOP_COUNT = 5;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req.headers.get("origin")) });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isAuthorized = authHeader === `Bearer ${cronSecret}` || authHeader === `Bearer ${serviceRoleKey}`;

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: getCorsHeaders(req.headers.get("origin")),
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Recupere tous les workspaces avec au moins un recipient configure.
  // cardinality > 0 evite d'envoyer a un workspace qui n'a pas opt-in.
  const { data: brandsRaw, error: brandsErr } = await supabase
    .from("workspace_brand")
    .select("*")
    .not("notification_recipients", "eq", "{}");

  if (brandsErr) {
    console.error("[prospect-weekly-recap] Failed to load workspace_brand:", brandsErr);
    return new Response(JSON.stringify({ error: brandsErr.message }), {
      status: 500,
      headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
    });
  }

  const brands = (brandsRaw || []).filter((b) => (b.notification_recipients?.length ?? 0) > 0) as WorkspaceBrand[];
  if (brands.length === 0) {
    return new Response(JSON.stringify({ sent: 0, message: "No workspace with notification_recipients configured" }), {
      status: 200,
      headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
    });
  }

  const results: Array<{ workspace_id: string; sent: boolean; kind: string; email_id?: string; error?: string }> = [];
  for (const brand of brands) {
    const result = await sendRecapForWorkspace(supabase, brand);
    results.push(result);
  }

  const sentCount = results.filter((r) => r.sent).length;
  return new Response(
    JSON.stringify({ sent: sentCount, total: brands.length, results }),
    { status: 200, headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" } }
  );
});

async function sendRecapForWorkspace(
  supabase: SupabaseClient,
  brand: WorkspaceBrand
): Promise<{ workspace_id: string; sent: boolean; kind: string; email_id?: string; error?: string }> {
  const brandName = brand.brand_name || "Prospection";
  const appUrl = brand.app_url || "";
  const firstName = brand.founder_name?.split(" ")[0] || null;
  const recipients = brand.notification_recipients;

  // Fenetre : 7 derniers jours (le run du dimanche soir est inclus)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: scoredThisWeek } = await supabase
    .from("prospect_signals")
    .select("id, company_name, extracted_data")
    .eq("workspace_id", brand.workspace_id)
    .eq("signal_type", "job_posting")
    .neq("status", "dismissed")
    .gte("created_at", since)
    .not("extracted_data->ai_score", "is", null);

  const scored = (scoredThisWeek || []) as ProspectSignal[];

  const highScored = scored.filter((s) => {
    const score = Number((s.extracted_data as Record<string, unknown> | null)?.ai_score);
    return Number.isFinite(score) && score >= SCORE_THRESHOLD;
  });

  const top = [...highScored]
    .sort((a, b) => {
      const sa = Number((a.extracted_data as Record<string, unknown>)?.ai_score) || 0;
      const sb = Number((b.extracted_data as Record<string, unknown>)?.ai_score) || 0;
      return sb - sa;
    })
    .slice(0, TOP_COUNT);

  const { count: linkedinReady } = await supabase
    .from("prospect_signals")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", brand.workspace_id)
    .eq("source", "linkedin")
    .eq("signal_type", "direct_listing")
    .neq("status", "dismissed")
    .not("extracted_data->linkedin_message", "is", null)
    .gte("created_at", since);

  const totalThisWeek = scored.length;
  const highCount = highScored.length;
  const resend = createResendService();

  if (totalThisWeek === 0 && (linkedinReady ?? 0) === 0) {
    const emptyResult = await resend.sendEmail({
      to: recipients,
      subject: `${brandName} — rien de neuf cette semaine`,
      html: renderEmptyEmail({ brandName, firstName }),
    });
    if (!emptyResult.success) {
      console.error(`[prospect-weekly-recap] Resend error (empty, ws ${brand.workspace_id}):`, emptyResult.error);
    }
    return {
      workspace_id: brand.workspace_id,
      sent: emptyResult.success,
      kind: "empty",
      email_id: emptyResult.id,
      error: emptyResult.success ? undefined : emptyResult.error,
    };
  }

  const html = renderRecapEmail({
    brandName,
    firstName,
    appUrl,
    highCount,
    totalThisWeek,
    linkedinReady: linkedinReady ?? 0,
    top,
  });

  const subject = highCount > 0
    ? `${brandName} — ${highCount} entreprise${highCount > 1 ? "s" : ""} a contacter cette semaine`
    : `${brandName} — ${linkedinReady ?? 0} contact${(linkedinReady ?? 0) > 1 ? "s" : ""} LinkedIn prets`;

  const result = await resend.sendEmail({ to: recipients, subject, html });
  if (!result.success) {
    console.error(`[prospect-weekly-recap] Resend error (ws ${brand.workspace_id}):`, result.error);
  }

  return {
    workspace_id: brand.workspace_id,
    sent: result.success,
    kind: highCount > 0 ? "high-scored" : "linkedin-only",
    email_id: result.id,
    error: result.success ? undefined : result.error,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderRecapEmail(data: {
  brandName: string;
  firstName: string | null;
  appUrl: string;
  highCount: number;
  totalThisWeek: number;
  linkedinReady: number;
  top: ProspectSignal[];
}): string {
  const { brandName, firstName, appUrl, highCount, linkedinReady, top } = data;
  const greeting = firstName ? `Salut ${escapeHtml(firstName)},` : "Bonjour,";

  const topHtml = top.length > 0
    ? `
      <div style="margin: 28px 0;">
        <p style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 0 0 16px 0; font-weight: 600;">
          Le top ${top.length}
        </p>
        ${top.map((s, i) => {
          const ed = (s.extracted_data || {}) as Record<string, unknown>;
          const score = Number(ed.ai_score) || 0;
          const name = escapeHtml(s.company_name || "Entreprise");
          const justification = escapeHtml((ed.ai_justification as string) || (ed.ai_reason as string) || "");
          return `
            <div style="padding: 16px 0; border-bottom: ${i === top.length - 1 ? "none" : "1px solid #eef0f3"};">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <strong style="color: #0f172a; font-size: 16px;">${name}</strong>
                <span style="color: #8B5CF6; font-weight: 600; font-size: 14px;">${score}/100</span>
              </div>
              ${justification ? `<p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0;">${justification}</p>` : ""}
            </div>
          `;
        }).join("")}
      </div>
    `
    : "";

  const linkedinBlock = linkedinReady > 0
    ? `
      <div style="padding: 18px 20px; background: #f5f3ff; border-radius: 10px; margin: 24px 0;">
        <p style="margin: 0; color: #4c1d95; font-size: 15px;">
          <strong>${linkedinReady} contact${linkedinReady > 1 ? "s" : ""} LinkedIn</strong>
          avec message personnalise ${linkedinReady > 1 ? "prets" : "pret"} a envoyer.
        </p>
      </div>
    `
    : "";

  const hook = highCount > 0
    ? `Il y a <strong>${highCount} entreprise${highCount > 1 ? "s" : ""}</strong> avec un vrai signal cette semaine.`
    : `Pas de gros signaux sur les offres d'emploi cette semaine, mais les contacts LinkedIn sont prets.`;

  const ctaBlock = appUrl
    ? `<a href="${escapeHtml(appUrl)}"
         style="display: inline-block; background: #8B5CF6; color: #ffffff; padding: 13px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px; margin-top: 8px;">
        Ouvrir la prospection
      </a>`
    : "";

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin: 0; padding: 0; background: #fafafa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 40px 24px;">
    <div style="background: #ffffff; border-radius: 14px; padding: 36px 32px; border: 1px solid #eef0f3;">

      <p style="color: #64748b; margin: 0 0 6px 0; font-size: 14px;">Lundi matin</p>
      <h1 style="color: #0f172a; font-size: 22px; font-weight: 700; margin: 0 0 20px 0; letter-spacing: -0.01em;">
        Ta semaine de prospection est prete
      </h1>

      <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 8px 0;">
        ${greeting}
      </p>
      <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 8px 0;">
        ${hook}
      </p>

      ${topHtml}

      ${linkedinBlock}

      ${ctaBlock}

      <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin: 32px 0 0 0;">
        Bonne semaine.
      </p>
    </div>

    <p style="text-align: center; color: #94a3b8; font-size: 12px; margin: 20px 0 0 0;">
      ${escapeHtml(brandName)}
    </p>
  </div>
</body>
</html>
  `.trim();
}

function renderEmptyEmail(data: { brandName: string; firstName: string | null }): string {
  const greeting = data.firstName ? `Salut ${escapeHtml(data.firstName)},` : "Bonjour,";
  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background: #fafafa; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 40px 24px;">
    <div style="background: #ffffff; border-radius: 14px; padding: 36px 32px; border: 1px solid #eef0f3;">
      <p style="color: #64748b; margin: 0 0 6px 0; font-size: 14px;">Lundi matin</p>
      <h1 style="color: #0f172a; font-size: 22px; font-weight: 700; margin: 0 0 16px 0;">
        Rien de neuf cette semaine
      </h1>
      <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">
        ${greeting} pas de nouveau signal fort ce week-end. On relance le scraping dimanche prochain.
      </p>
      <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">${escapeHtml(data.brandName)}</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
