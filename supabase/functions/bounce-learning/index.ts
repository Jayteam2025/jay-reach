import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SEUIL_BOUNCE_RATE = 0.20;
const MIN_SENDS = 10;
const PROTECTION_REPLY_RATE = 0.02;

// Signal Bouncer : permet downgrade sans envois reels.
// Si >=5 verdicts et >50% invalid -> downgrade meme sans envoi.
const SEUIL_BOUNCER_INVALID_RATE = 0.50;
const MIN_BOUNCER_VERDICTS = 5;

// Cas extreme : 100% d'invalides sur 3+ verdicts = signal certain (zero exception).
// Engie 2026-05-18 : 4/4 invalides apres 7 FullEnrich valides -> deduction cassee
// pour ce domaine specifique, downgrade immediat sans attendre 5 verdicts.
const SEUIL_BOUNCER_TOTAL_INVALID = 1.0;
const MIN_BOUNCER_VERDICTS_TOTAL_INVALID = 3;

const TIER_DOWNGRADE: Record<string, string> = {
  high: "medium",
  medium: "low",
  low: "skip",
};

interface PatternRow {
  domain: string;
  pattern_id: string;
  sends: number;
  bounces: number;
  replies: number;
  bouncer_total: number;
  bouncer_invalids: number;
}

interface DowngradeResult {
  domain: string;
  pattern_id: string;
  old_tier: string;
  new_tier: string;
  bounce_rate: number;
  reply_rate: number;
}

interface ResponsePayload {
  ok: boolean;
  dry_run: boolean;
  rows_analyzed: number;
  downgrades: number;
  downgrades_detail?: DowngradeResult[];
  restores: number;
  error?: string;
}

function authorize(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  return (
    (!!serviceKey && authHeader === `Bearer ${serviceKey}`) ||
    (!!cronSecret && authHeader === `Bearer ${cronSecret}`)
  );
}

async function computePatternEmpirical(
  client: any,
  windowDays: number
): Promise<PatternRow[]> {
  const { data, error } = await client.rpc("compute_pattern_empirical", {
    window_days: windowDays,
  });

  if (error) {
    throw new Error(`RPC error: ${error.message}`);
  }

  return (data as PatternRow[]) || [];
}

async function downgradePattern(
  client: any,
  domain: string,
  patternId: string,
  newTier: string,
  reason: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    console.log(`[DRY-RUN] Would downgrade ${domain}/${patternId} to ${newTier}`);
    return;
  }

  const { error } = await client
    .from("domain_email_patterns")
    .update({
      tier: newTier,
      downgraded_at: new Date().toISOString(),
      downgraded_reason: reason,
    })
    .eq("domain", domain)
    .eq("pattern_id", patternId);

  if (error) {
    throw new Error(`Update error: ${error.message}`);
  }
}

async function processPatterns(
  client: any,
  patterns: PatternRow[],
  dryRun: boolean
): Promise<{ downgrades: number; downgrades_detail: DowngradeResult[]; restores: number }> {
  let downgrades = 0;
  let restores = 0;
  const downgrades_detail: DowngradeResult[] = [];

  for (const pattern of patterns) {
    const { sends, bounces, replies, bouncer_total, bouncer_invalids } = pattern;

    const bounce_rate = sends > 0 ? bounces / sends : 0;
    const reply_rate = sends > 0 ? replies / sends : 0;
    const bouncer_invalid_rate = bouncer_total > 0 ? bouncer_invalids / bouncer_total : 0;

    // 3 signaux de downgrade :
    //   (a) envois reels : sends >= 10 AND bounce_rate > 20% AND reply_rate < 2%
    //   (b) verdicts Bouncer : bouncer_total >= 5 AND invalid_rate > 50%
    //   (c) 100% invalides sur 3+ verdicts : signal certain, deduction cassee
    const trigger_by_sends = sends >= MIN_SENDS
      && bounce_rate > SEUIL_BOUNCE_RATE
      && reply_rate < PROTECTION_REPLY_RATE;
    const trigger_by_bouncer = bouncer_total >= MIN_BOUNCER_VERDICTS
      && bouncer_invalid_rate > SEUIL_BOUNCER_INVALID_RATE;
    const trigger_by_total_invalid = bouncer_total >= MIN_BOUNCER_VERDICTS_TOTAL_INVALID
      && bouncer_invalid_rate >= SEUIL_BOUNCER_TOTAL_INVALID;

    if (!trigger_by_sends && !trigger_by_bouncer && !trigger_by_total_invalid) {
      if (sends < MIN_SENDS && bouncer_total < MIN_BOUNCER_VERDICTS_TOTAL_INVALID) {
        console.log(
          `[SKIP] ${pattern.domain}/${pattern.pattern_id}: insufficient signals (sends=${sends}, bouncer=${bouncer_total})`
        );
      }
      // Verifier restore plus bas
    }

    // Récupérer le tier actuel et la source
    const { data: patternData, error: fetchError } = await client
      .from("domain_email_patterns")
      .select("tier, source")
      .eq("domain", pattern.domain)
      .eq("pattern", pattern.pattern_id)
      .single();

    if (fetchError) {
      console.warn(
        `[WARN] Could not fetch pattern ${pattern.domain}/${pattern.pattern_id}: ${fetchError.message}`
      );
      continue;
    }

    const { tier: currentTier, source } = patternData || {
      tier: "high",
      source: "unknown",
    };

    // Logique de downgrade (envois OU bouncer OU 100% invalides)
    if (
      (trigger_by_sends || trigger_by_bouncer || trigger_by_total_invalid) &&
      currentTier !== "low" &&
      source !== "manual_override"
    ) {
      // 100% invalides = signal le plus fort : on saute directement a "skip"
      // au lieu du downgrade graduel (high -> medium -> low). Inutile de garder
      // un pattern qui n'a jamais produit un seul email valide.
      const newTier = trigger_by_total_invalid ? "skip" : (TIER_DOWNGRADE[currentTier] || "skip");

      if (newTier !== "skip" || trigger_by_total_invalid) {
        const signal = trigger_by_total_invalid ? "total_invalid" : (trigger_by_sends ? "sends" : "bouncer");
        const reason = `Auto-downgraded (${signal}): bounce_rate=${bounce_rate.toFixed(3)}, reply_rate=${reply_rate.toFixed(3)}, bouncer_invalid_rate=${bouncer_invalid_rate.toFixed(3)} (n=${bouncer_total})`;
        await downgradePattern(
          client,
          pattern.domain,
          pattern.pattern_id,
          newTier,
          reason,
          dryRun
        );
        downgrades++;
        downgrades_detail.push({
          domain: pattern.domain,
          pattern_id: pattern.pattern_id,
          old_tier: currentTier,
          new_tier: newTier,
          bounce_rate,
          reply_rate,
        });
        console.log(
          `[DOWNGRADE] ${pattern.domain}/${pattern.pattern_id}: ${currentTier} → ${newTier}`
        );
      }
    }

    // Logique de restore (si bounce_rate s'améliore et reply_rate bon)
    if (
      bounce_rate < 0.05 &&
      reply_rate > 0.05 &&
      (currentTier === "medium" || currentTier === "low") &&
      source !== "manual_override"
    ) {
      const upgradeTier = currentTier === "low" ? "medium" : "high";
      const reason = `Auto-restored: bounce_rate=${bounce_rate.toFixed(3)}, reply_rate=${reply_rate.toFixed(3)}`;
      await downgradePattern(
        client,
        pattern.domain,
        pattern.pattern_id,
        upgradeTier,
        reason,
        dryRun
      );
      restores++;
      console.log(
        `[RESTORE] ${pattern.domain}/${pattern.pattern_id}: ${currentTier} → ${upgradeTier}`
      );
    }
  }

  return { downgrades, downgrades_detail, restores };
}

Deno.serve(async (req) => {
  try {
    // Auth
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!authorize(req)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Query params
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const windowDays = parseInt(url.searchParams.get("window_days") || "30", 10);

    console.log(`[START] bounce-learning cron. dry_run=${dryRun}, window_days=${windowDays}`);

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(supabaseUrl, supabaseServiceKey);

    // Compute empirical metrics
    const patterns = await computePatternEmpirical(client, windowDays);
    console.log(`[ANALYZE] Found ${patterns.length} patterns with activity in last ${windowDays} days`);

    // Process downgrades and restores
    const { downgrades, downgrades_detail, restores } = await processPatterns(
      client,
      patterns,
      dryRun
    );

    const result: ResponsePayload = {
      ok: true,
      dry_run: dryRun,
      rows_analyzed: patterns.length,
      downgrades,
      downgrades_detail,
      restores,
    };

    console.log(`[END] Complete. downgrades=${downgrades}, restores=${restores}`);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ERROR] ${errorMsg}`);

    const result: ResponsePayload = {
      ok: false,
      dry_run: false,
      rows_analyzed: 0,
      downgrades: 0,
      restores: 0,
      error: errorMsg,
    };

    return new Response(JSON.stringify(result), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
