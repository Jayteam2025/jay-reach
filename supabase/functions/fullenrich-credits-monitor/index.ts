/**
 * Cron quotidien : alerte par email si le solde FullEnrich < seuil.
 *
 * Trigger : cron job postgres (cron.schedule) qui POST cette function avec
 * Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
 *
 * Comportement :
 *   1. GET /account/credits sur l'API FullEnrich
 *   2. Si solde < ALERT_THRESHOLD (100 par defaut) : envoi email aux 2 admins
 *   3. Logue le solde dans la table fullenrich_credits_log pour historisation
 *      (table optionnelle, si elle n'existe pas on skip silencieusement)
 *
 * Pour relancer manuellement le cron en cours de journee :
 *   SELECT public.call_fullenrich_credits_monitor();
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createResendService } from "../_shared/resend.ts";
import { resolveProviderForDefaultWorkspace } from "../_shared/providers/registry.ts";

const ALERT_THRESHOLD = 100;
const ALERT_RECIPIENTS_ENV = Deno.env.get("ALERT_RECIPIENTS") || "";
const ALERT_RECIPIENTS = ALERT_RECIPIENTS_ENV ? ALERT_RECIPIENTS_ENV.split(',').map(e => e.trim()) : [];

interface CreditsResponse {
  credits?: number;
  balance?: number;
  total?: number;
}

async function getFullEnrichCredits(apiKey: string): Promise<number | null> {
  const res = await fetch("https://app.fullenrich.com/api/v2/account/credits", {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`[fullenrich-credits-monitor] GET /account/credits HTTP ${res.status}`);
    return null;
  }
  const payload = (await res.json().catch(() => ({}))) as CreditsResponse;
  // L'API peut retourner soit { credits: N } soit { balance: N } selon version.
  // On essaie les noms connus.
  const balance = payload.credits ?? payload.balance ?? payload.total;
  return typeof balance === "number" ? balance : null;
}

function buildAlertEmail(balance: number): { subject: string; html: string; text: string } {
  const subject = `⚠️ FullEnrich : solde critique (${balance} credits)`;
  const text = [
    `Le solde FullEnrich est passe sous le seuil d'alerte.`,
    ``,
    `Solde actuel : ${balance} credits`,
    `Seuil d'alerte : ${ALERT_THRESHOLD} credits`,
    ``,
    `Action : recharger le compte sur https://app.fullenrich.com/billing avant que les enrichissements ne soient bloques.`,
    ``,
    `Pipeline impacte :`,
    `- enrich-company (bulk + search)`,
    `- enqueue-prospect-import`,
    ``,
    `-- monitoring system`,
  ].join("\n");
  const html = text
    .split("\n")
    .map((l) => l.trim() === "" ? "<br>" : `<p style="margin:0 0 8px 0;">${l.replace(/</g, "&lt;").replace(/&lt;br&gt;/g, "<br>")}</p>`)
    .join("");
  return { subject, html, text };
}

Deno.serve(async (req: Request) => {
  // Auth : Bearer SUPABASE_SERVICE_ROLE_KEY (service-to-service) ou CRON_SECRET
  // (pg_cron via Vault). Memes options que bouncer-batch / bounce-learning.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "");
  if (!bearer || (bearer !== serviceKey && bearer !== cronSecret)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey!,
  );

  let apiKey: string;
  try {
    const provider = await resolveProviderForDefaultWorkspace(
      supabase,
      "enricher",
      { providerType: "fullenrich" }
    );
    apiKey = provider.apiKey;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: `FullEnrich provider not configured: ${msg}` }), { status: 500 });
  }

  const balance = await getFullEnrichCredits(apiKey);
  if (balance === null) {
    return new Response(JSON.stringify({ error: "could not fetch credits" }), { status: 502 });
  }

  console.log(`[fullenrich-credits-monitor] balance=${balance} threshold=${ALERT_THRESHOLD}`);

  let alertSent = false;
  if (balance < ALERT_THRESHOLD) {
    if (!ALERT_RECIPIENTS.length) {
      console.warn(`[fullenrich-credits-monitor] ALERT_RECIPIENTS not configured, skipping email`);
    } else {
      try {
        const resend = createResendService();
        const { subject, html, text } = buildAlertEmail(balance);
        const result = await resend.sendEmail({
          to: ALERT_RECIPIENTS,
          subject,
          html,
          text,
          tags: [{ name: "type", value: "fullenrich_credits_alert" }],
        });
        alertSent = result.success;
        if (!result.success) {
          console.error(`[fullenrich-credits-monitor] email send failed: ${result.error}`);
        }
      } catch (err) {
        console.error(`[fullenrich-credits-monitor] resend init failed: ${(err as Error).message}`);
      }
    }
  }

  return new Response(
    JSON.stringify({ balance, threshold: ALERT_THRESHOLD, alert_sent: alertSent }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
