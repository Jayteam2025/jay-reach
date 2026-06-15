import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { adzunaScraper } from '../_shared/scrapers/adzuna.ts';
import { franceTravailScraper } from '../_shared/scrapers/france-travail.ts';
import { processSignals } from '../_shared/scrapers/signal-processor.ts';
import type { Scraper, IcpCriteria } from '../_shared/scrapers/types.ts';
import { resolveCredential } from '../_shared/providers/registry.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

/**
 * Mapping source_type (signal_triggers.source_types) -> Scraper module.
 * Le trigger declare les sources qu'il veut activer ; on construit le set
 * en fonction des credentials disponibles ET des sources demandees.
 */
const SCRAPER_BY_SOURCE: Record<string, Scraper> = {
  adzuna: adzunaScraper,
  france_travail: franceTravailScraper,
};

interface SignalTrigger {
  id: string;
  workspace_id: string;
  search_keywords: string[];
  exclude_keywords: string[];
  source_types: string[];
}

function buildScrapersForTrigger(trigger: SignalTrigger): Scraper[] {
  const scrapers: Scraper[] = [];
  for (const sourceType of trigger.source_types) {
    const scraper = SCRAPER_BY_SOURCE[sourceType];
    if (!scraper) {
      console.warn(`[scrape] Trigger ${trigger.id} : source_type "${sourceType}" non implementee, skipped`);
      continue;
    }
    scrapers.push(scraper);
  }
  return scrapers;
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // 1. Fetch tous les signal_triggers actifs (toutes workspaces confondues).
    // Service_role bypass RLS, donc on lit tous les workspaces. Pour chaque trigger
    // on scrape avec ses keywords et on tag les signaux avec workspace_id + trigger_id.
    const { data: triggers, error: triggersError } = await supabase
      .from('signal_triggers')
      .select('id, workspace_id, search_keywords, exclude_keywords, source_types')
      .eq('is_active', true);

    if (triggersError) {
      throw new Error(`Failed to fetch signal_triggers: ${triggersError.message}`);
    }

    if (!triggers || triggers.length === 0) {
      console.warn('[scrape] Aucun signal_trigger actif. Aucun scraping lance.');
      return new Response(
        JSON.stringify({
          success: true,
          warning: 'Aucun signal_trigger actif - configurez un declencheur dans l\'onglet Declencheurs',
          triggers_processed: 0,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[scrape] ${triggers.length} trigger(s) actif(s) trouve(s)`);

    type ScrapeOneResult = Awaited<ReturnType<typeof scrapeOneSource>>;
    const results: Array<{
      trigger_id: string;
      workspace_id: string;
      scrapers: Record<string, ScrapeOneResult>;
    }> = [];
    let totalSignals = 0, totalInserted = 0, totalDuplicates = 0, totalDismissed = 0;

    // 2. Pour chaque trigger, lance les scrapers configures avec ses keywords
    for (const trigger of triggers as SignalTrigger[]) {
      const triggerScrapers = buildScrapersForTrigger(trigger);
      if (triggerScrapers.length === 0) {
        console.warn(`[scrape] Trigger ${trigger.id} : aucun scraper actif, skipped`);
        continue;
      }
      if (trigger.search_keywords.length === 0) {
        console.warn(`[scrape] Trigger ${trigger.id} : aucun keyword configure, skipped`);
        continue;
      }

      // ICP criteria derived from this trigger (utilise par processSignals pour le matching)
      const icpFilters: IcpCriteria[] = [{
        job_keywords: trigger.search_keywords,
        exclude_keywords: trigger.exclude_keywords,
      }];

      const triggerResults: Record<string, ScrapeOneResult> = {};

      for (const scraper of triggerScrapers) {
        const r = await scrapeOneSource(scraper, trigger, icpFilters);
        triggerResults[scraper.name] = r;
        totalSignals += r.signals_found;
        totalInserted += r.inserted;
        totalDuplicates += r.duplicates;
        totalDismissed += r.dismissed;
      }

      results.push({
        trigger_id: trigger.id,
        workspace_id: trigger.workspace_id,
        scrapers: triggerResults,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      triggers_processed: triggers.length,
      results,
      total_signals: totalSignals,
      total_inserted: totalInserted,
      total_duplicates: totalDuplicates,
      total_dismissed: totalDismissed,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Lance un scraper pour un trigger donne, process les signaux, log.
 */
async function scrapeOneSource(
  scraper: Scraper,
  trigger: SignalTrigger,
  icpFilters: IcpCriteria[]
): Promise<{
  success: boolean;
  signals_found: number;
  inserted: number;
  duplicates: number;
  dismissed: number;
  duration_ms: number;
  errors: string[];
}> {
  try {
    console.log(`[scrape] Trigger ${trigger.id} > ${scraper.name} : start`);

    // Résout les credentials du scraper
    const creds = await resolveCredential(supabase, trigger.workspace_id, 'source', scraper.name);
    if (!creds) {
      console.warn(`[scrape] Trigger ${trigger.id} : ${scraper.name} actif mais aucune credential resolue, skipped`);
      return { success: false, signals_found: 0, inserted: 0, duplicates: 0, dismissed: 0, duration_ms: 0, errors: [`source_no_credential`] };
    }

    const result = await scraper.fetch(trigger.search_keywords, { credentials: creds });
    console.log(`[scrape] Trigger ${trigger.id} > ${scraper.name} : ${result.signals.length} signals, ${result.duration_ms}ms`);

    let processResult = { inserted: 0, duplicates: 0, dismissed: 0 };
    if (result.signals.length > 0) {
      processResult = await processSignals(
        result.signals,
        icpFilters,
        trigger.workspace_id,
        trigger.id
      );
      console.log(`[scrape] Trigger ${trigger.id} > ${scraper.name} : +${processResult.inserted} new, ${processResult.duplicates} dupes, ${processResult.dismissed} dismissed`);
    }

    await supabase.from('prospect_scraping_logs').insert({
      workspace_id: trigger.workspace_id,
      source: scraper.name,
      status: result.signals.length > 0 ? 'success' : (result.errors.length > 0 ? 'error' : 'success'),
      duration_ms: result.duration_ms,
      results_count: result.signals.length,
      metadata: {
        trigger_id: trigger.id,
        errors: result.errors,
        inserted: processResult.inserted,
      },
    });

    return {
      success: result.errors.length === 0,
      signals_found: result.signals.length,
      inserted: processResult.inserted,
      duplicates: processResult.duplicates,
      dismissed: processResult.dismissed,
      duration_ms: result.duration_ms,
      errors: result.errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scrape] Trigger ${trigger.id} > ${scraper.name} crashed:`, msg);

    await supabase.from('prospect_scraping_logs').insert({
      workspace_id: trigger.workspace_id,
      source: scraper.name,
      status: 'error',
      error_message: msg,
      duration_ms: 0,
      results_count: 0,
      metadata: { trigger_id: trigger.id },
    });

    return {
      success: false,
      signals_found: 0,
      inserted: 0,
      duplicates: 0,
      dismissed: 0,
      duration_ms: 0,
      errors: [msg],
    };
  }
}
