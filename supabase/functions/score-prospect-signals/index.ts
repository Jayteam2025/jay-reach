import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";
import { resolveSystemPrompt, MIN_CUSTOM_PROMPT_LENGTH } from "../_shared/signal-scoring-core.ts";
import { resolveLLMForDefaultWorkspace } from "../_shared/providers/registry.ts";
import type { LLMBatchRequestItem, LLMHandle } from "../_shared/providers/types.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Types ───────────────────────────────────────────

interface ProspectSignal {
  id: string;
  signal_type: string;
  extracted_data: Record<string, unknown>;
  trigger_id?: string | null;
}

interface SignalTriggerRow {
  id: string;
  signal_scoring_prompt: string | null;
  signal_match_threshold: number;
}

interface BatchSignal {
  id: string;
  company_name: string;
  job_title?: string;
  location?: string;
  email?: string;
  description?: string;
}

interface ScoringResult {
  id: string;
  score: number;
  reason: string;
}

const CHUNK_SIZE = 50;

// ─── Helpers (shared across modes) ───────────────────

/**
 * Recupere les triggers actifs indexes par id. Permet de resoudre le
 * signal_scoring_prompt specifique a chaque trigger (Jay Reach 1.2.3.b).
 */
async function loadActiveTriggers(): Promise<Map<string, SignalTriggerRow>> {
  const { data, error } = await supabase
    .from('signal_triggers')
    .select('id, signal_scoring_prompt, signal_match_threshold')
    .eq('is_active', true);
  if (error) {
    console.warn('[SCORE] Failed to load signal_triggers, will fallback to legacy prompt:', error.message);
    return new Map();
  }
  return new Map((data || []).map((t) => [t.id, t as SignalTriggerRow]));
}

function buildUserMessage(signals: BatchSignal[]): string {
  const signalLines = signals.map((s) => {
    const parts = [
      `ID: ${s.id}`,
      `Entreprise: ${s.company_name || 'N/A'}`,
      s.job_title ? `Poste: ${s.job_title}` : '',
      s.location ? `Localisation: ${s.location}` : '',
      s.email ? `Email: ${s.email}` : '',
      s.description ? `Description: ${s.description.substring(0, 150)}` : '',
    ].filter((p) => p);
    return parts.join('\n');
  });

  return `Évalue ces ${signals.length} prospects:\n\n${signalLines.join('\n\n---\n\n')}`;
}

function extractSignalData(signal: ProspectSignal): BatchSignal {
  const data = signal.extracted_data || {};
  return {
    id: signal.id,
    company_name: (data.company_name as string) || '',
    job_title: (data.job_title as string),
    location: (data.location as string),
    email: (data.email as string),
    description: (data.description as string),
  };
}

function parseClaudeResponse(text: string): ScoringResult[] {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
  }

  // Robust : si Claude met un preambule ("Voici...", "Je vais..."), on extrait
  // le premier tableau JSON. Evite de re-cramer un batch entier sur un prompt
  // pas assez strict.
  if (!cleaned.startsWith('[')) {
    const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) cleaned = arrayMatch[0];
  }

  const parsed = JSON.parse(cleaned.trim());
  if (!Array.isArray(parsed)) {
    throw new Error('Expected JSON array from Claude');
  }

  return parsed.map((item) => ({
    id: item.id as string,
    score: Math.max(0, Math.min(100, item.score as number)),
    reason: (item.reason as string) || '',
  }));
}

async function updateSignalScores(
  results: ScoringResult[],
  validIds: Set<string>
): Promise<number> {
  let updated = 0;

  for (const result of results) {
    if (!validIds.has(result.id)) {
      console.warn(`[SCORE] Unknown ID from Claude: ${result.id.substring(0, 12)}...`);
      continue;
    }

    const { error } = await supabase.rpc('jsonb_merge_signal_score', {
      signal_id: result.id,
      score: result.score,
      reason: result.reason,
    });

    if (error) {
      const { data: current } = await supabase
        .from('prospect_signals')
        .select('extracted_data')
        .eq('id', result.id)
        .single();

      if (current) {
        const merged = { ...(current.extracted_data || {}), ai_score: result.score, ai_reason: result.reason };
        const { error: updateError } = await supabase
          .from('prospect_signals')
          .update({ extracted_data: merged })
          .eq('id', result.id);

        if (updateError) {
          console.error(`[SCORE] Failed to update ${result.id.substring(0, 12)}: ${updateError.message}`);
          continue;
        }
      }
    }

    updated++;
  }

  return updated;
}

/**
 * Auto-learning : detecte les cabinets / intermediaires dans les resultats du
 * scoring et les ajoute a recruitment_agencies_blacklist.
 *
 * Critere de detection : score <= 30 ET reason mentionne cabinet / intermediaire /
 * "recrute pour" / placement / etc. Si Claude est sur que c'est un intermediaire
 * (reason explicite), on le persiste pour ne plus le rescraper.
 *
 * Retourne le nombre d'INSERT/UPDATE effectues (utile pour les logs).
 */
async function learnRecruitmentAgencies(scores: ScoringResult[]): Promise<number> {
  const RECRUITMENT_REASON_PATTERN = /\b(cabinet|intermédiaire|intermediaire|recrute pour|recrutement par|recrutement|agence (?:de )?recrutement|placement|chasseur|headhunt|interim|intérim|esn(\s|$))/i;

  const candidates = scores.filter(s => s.score <= 30 && RECRUITMENT_REASON_PATTERN.test(s.reason || ''));
  if (candidates.length === 0) return 0;

  // Recupere les company_name pour ces signal ids
  const { data: signals, error: fetchErr } = await supabase
    .from('prospect_signals')
    .select('id, company_name')
    .in('id', candidates.map(c => c.id));
  if (fetchErr || !signals) {
    console.warn('[learn] Failed to fetch company_names:', fetchErr?.message);
    return 0;
  }

  const idToName = new Map<string, string>(signals.map(s => [s.id, s.company_name || '']));

  let learned = 0;
  for (const candidate of candidates) {
    const companyName = idToName.get(candidate.id);
    if (!companyName || companyName.trim().length < 2) continue;

    // Normalise client-side pour eviter un round-trip RPC (logique = normalize_agency_name SQL)
    const nameNormalized = companyName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[\s\-']/g, '');

    if (!nameNormalized) continue;

    // ignoreDuplicates:true => ON CONFLICT DO NOTHING. detected_count reste a 1
    // pour le premier insert ; pour incrementer sur les re-detections, il faudrait
    // une RPC dediee. La valeur du compteur est "best effort" et le filtrage
    // utilise juste la presence/absence de l'entree.
    const { error } = await supabase
      .from('recruitment_agencies_blacklist')
      .upsert({
        name_normalized: nameNormalized,
        name_display: companyName,
        source: 'auto_score',
        notes: `Auto-learned from score=${candidate.score}: ${candidate.reason}`,
      }, { onConflict: 'name_normalized', ignoreDuplicates: true });

    if (error) {
      continue;
    }
    learned++;
  }

  return learned;
}

// ─── Dedup: keep 1 signal per company, dismiss duplicates ───

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-zàâäéèêëïîôùûüÿçœæ0-9\s]/g, '')
    .replace(/\b(sa|sas|sca|sarl|eurl|group|groupe|france|international|distribution)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function deduplicateByCompany(signals: ProspectSignal[]): Promise<ProspectSignal[]> {
  const groups = new Map<string, ProspectSignal[]>();

  for (const s of signals) {
    const name = (s.extracted_data?.company_name as string) || '';
    const key = normalizeCompanyName(name);
    if (!key) { groups.set(s.id, [s]); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const kept: ProspectSignal[] = [];
  const dismissIds: string[] = [];

  for (const [, group] of groups) {
    // Keep the signal with the longest description
    group.sort((a, b) => {
      const descA = ((a.extracted_data?.description as string) || '').length;
      const descB = ((b.extracted_data?.description as string) || '').length;
      return descB - descA;
    });
    kept.push(group[0]);
    for (let i = 1; i < group.length; i++) {
      dismissIds.push(group[i].id);
    }
  }

  // Dismiss duplicates in DB
  if (dismissIds.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < dismissIds.length; i += BATCH) {
      const batch = dismissIds.slice(i, i + BATCH);
      await supabase
        .from('prospect_signals')
        .update({ status: 'dismissed' })
        .in('id', batch);
    }
    console.log(`[SCORE] Dedup: ${kept.length} entreprises uniques, ${dismissIds.length} doublons dismissed`);
  }

  return kept;
}

// ─── Mode: Submit Batch ──────────────────────────────

async function handleSubmitBatch(corsHeaders: HeadersInit) {
  const { data: signals, error: fetchError } = await supabase
    .from('prospect_signals')
    .select('id, extracted_data, trigger_id')
    .eq('status', 'raw')
    .eq('signal_type', 'job_posting')
    .order('detected_at', { ascending: true });

  if (fetchError) throw fetchError;

  const toScore = (signals || []).filter((s) => {
    const data = s.extracted_data || {};
    return !('ai_score' in data);
  });

  if (toScore.length === 0) {
    console.log('[SCORE] No signals to score');
    return new Response(
      JSON.stringify({ batch_id: null, total: 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Dedup: 1 offre par entreprise, doublons dismissed
  const unique = await deduplicateByCompany(toScore as ProspectSignal[]);
  console.log(`[SCORE] Building batch for ${unique.length} entreprises uniques (${toScore.length - unique.length} doublons retirés)...`);

  // Group signaux par trigger_id pour appliquer le bon prompt par groupe (Jay Reach 1.2.3.b)
  const triggers = await loadActiveTriggers();
  const signalsByTrigger = new Map<string, ProspectSignal[]>();
  for (const sig of unique) {
    const key = sig.trigger_id ?? '__no_trigger__';
    if (!signalsByTrigger.has(key)) signalsByTrigger.set(key, []);
    signalsByTrigger.get(key)!.push(sig);
  }

  const batchRequests: LLMBatchRequestItem[] = [];
  let chunkCounter = 0;
  let skippedNoPrompt = 0;
  for (const [triggerKey, sigs] of signalsByTrigger) {
    const triggerId = triggerKey === '__no_trigger__' ? null : triggerKey;
    const systemPrompt = resolveSystemPrompt(triggerId, triggers);

    if (systemPrompt === null) {
      // Fail-fast : aucun prompt de scoring exploitable pour ce groupe.
      // On NE score PAS (plus de repli Jay hardcodé) — le signal reste 'raw'
      // et sera re-tenté quand le trigger aura un signal_scoring_prompt valide.
      skippedNoPrompt += sigs.length;
      console.warn(
        `[SCORE] Groupe ${triggerKey} : ${sigs.length} signaux SKIPPÉS — ` +
        `pas de signal_scoring_prompt exploitable (>= ${MIN_CUSTOM_PROMPT_LENGTH} car.) ` +
        `sur ce déclencheur. Configurez-le dans Prospection > Déclencheurs.`,
      );
      continue;
    }

    console.log(`[SCORE] Trigger ${triggerKey} : ${sigs.length} signaux, prompt source = trigger:${triggerKey}`);

    for (let i = 0; i < sigs.length; i += CHUNK_SIZE) {
      const chunk = sigs.slice(i, i + CHUNK_SIZE);
      const extracted = chunk.map(extractSignalData);
      batchRequests.push({
        customId: `chunk-${chunkCounter++}`,
        request: {
          tier: 'smart',
          maxTokens: 4000,
          system: systemPrompt,
          user: buildUserMessage(extracted),
        },
      });
    }
  }
  if (skippedNoPrompt > 0) {
    console.warn(`[SCORE] Total skippés (pas de prompt déclencheur) : ${skippedNoPrompt}`);
  }

  if (batchRequests.length === 0) {
    console.log('[SCORE] Aucun batch genere (probable: aucun trigger actif et aucun fallback applicable)');
    return new Response(
      JSON.stringify({ batch_id: null, total: 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Résout le LLM actif (anthropic par défaut, openai_compatible possible)
  const llm = await resolveLLMOrNull();
  if (!llm) {
    return new Response(
      JSON.stringify({ error: 'no_llm_provider' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Fallback sync : provider sans Batch API (openai_compatible). On score
  // tout de suite, séquentiellement — pas de row prospect_batches ni de
  // polling (batch_id null, le caller sait qu'il n'y a rien à poller).
  if (!llm.provider.supportsBatch || !llm.provider.submitBatch) {
    console.log(`[SCORE] Provider '${llm.provider.type}' sans batch — scoring sync de ${batchRequests.length} chunks`);
    const scored = await scoreSynchronously(llm, batchRequests);
    return new Response(
      JSON.stringify({
        batch_id: null,
        mode: 'sync',
        scored,
        total: unique.length,
        duplicates_dismissed: toScore.length - unique.length,
        chunks: batchRequests.length,
        triggers: signalsByTrigger.size,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const { providerBatchId } = await llm.provider.submitBatch(batchRequests, llm.context);
  console.log(`[SCORE] Batch submitted: ${providerBatchId} (${batchRequests.length} chunks, ${unique.length} entreprises, ${signalsByTrigger.size} triggers)`);

  return new Response(
    JSON.stringify({
      batch_id: providerBatchId,
      total: unique.length,
      duplicates_dismissed: toScore.length - unique.length,
      chunks: batchRequests.length,
      triggers: signalsByTrigger.size,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/** Résout le LLM actif du workspace par défaut, null (+ log) si non configuré. */
async function resolveLLMOrNull(): Promise<LLMHandle | null> {
  try {
    return await resolveLLMForDefaultWorkspace(supabase);
  } catch (err) {
    console.error('[SCORE] Failed to resolve LLM provider:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fallback sync pour les providers sans Batch API : boucle complete() chunk
 * par chunk, écrit les scores au fil de l'eau. Une erreur sur un chunk ne
 * bloque pas les suivants (même sémantique que les items errored d'un batch).
 */
async function scoreSynchronously(llm: LLMHandle, items: LLMBatchRequestItem[]): Promise<number> {
  const { data: allSignals } = await supabase
    .from('prospect_signals')
    .select('id')
    .eq('status', 'raw')
    .eq('signal_type', 'job_posting');
  const validIds = new Set((allSignals || []).map((s) => s.id));

  let totalScored = 0;
  for (const item of items) {
    try {
      const result = await llm.provider.complete(item.request, llm.context);
      const scores = parseClaudeResponse(result.text);
      totalScored += await updateSignalScores(scores, validIds);
      const learned = await learnRecruitmentAgencies(scores);
      if (learned > 0) {
        console.log(`[SCORE] Auto-learning : ${learned} cabinet(s) ajoute(s) a recruitment_agencies_blacklist`);
      }
    } catch (e) {
      console.error(`[SCORE] sync ${item.customId} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return totalScored;
}

// ─── Mode: Check Batch ───────────────────────────────

async function handleCheckBatch(batchId: string, corsHeaders: HeadersInit) {
  const llm = await resolveLLMOrNull();
  if (!llm) {
    return new Response(
      JSON.stringify({ error: 'no_llm_provider' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  // Un batch ne peut exister que pour un provider batch. Si le provider actif
  // a changé entre submit et check (batch orphelin), on le signale clairement.
  if (!llm.provider.checkBatch || !llm.provider.fetchBatchResults) {
    console.error(`[SCORE] check_batch ${batchId} : provider actif '${llm.provider.type}' sans Batch API (batch orphelin ?)`);
    return new Response(
      JSON.stringify({ error: 'batch_not_supported_by_active_provider' }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const batch = await llm.provider.checkBatch(batchId, llm.context);

  if (batch.status !== 'ended') {
    console.log(`[SCORE] Batch ${batchId}: ${batch.status} (${batch.counts.succeeded}/${batch.counts.processing + batch.counts.succeeded} done)`);
    return new Response(
      JSON.stringify({
        status: batch.status,
        request_counts: batch.counts,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log(`[SCORE] Batch ${batchId} ended, processing results...`);

  // Fetch valid signal IDs
  const { data: allSignals } = await supabase
    .from('prospect_signals')
    .select('id')
    .eq('status', 'raw')
    .eq('signal_type', 'job_posting');

  const validIds = new Set((allSignals || []).map((s) => s.id));

  // Fetch and process batch results
  const results = await llm.provider.fetchBatchResults(batchId, llm.context);

  let totalScored = 0;
  let totalTokensInput = 0;
  let totalTokensOutput = 0;

  for (const result of results) {
    if (result.text === null) {
      console.error(`[SCORE] ${result.customId}: ${result.error}`);
      continue;
    }

    totalTokensInput += result.usage?.input_tokens ?? 0;
    totalTokensOutput += result.usage?.output_tokens ?? 0;

    try {
      const scores = parseClaudeResponse(result.text);
      console.log(`[SCORE] ${result.customId}: ${scores.length} scores parsed`);
      const updated = await updateSignalScores(scores, validIds);
      totalScored += updated;
      // Auto-learning : detecte les cabinets de recrutement dans le scoring et
      // les ajoute a la blacklist DB pour eviter de les rescraper la prochaine fois.
      const learned = await learnRecruitmentAgencies(scores);
      if (learned > 0) {
        console.log(`[SCORE] Auto-learning : ${learned} cabinet(s) ajoute(s) a recruitment_agencies_blacklist`);
      }
    } catch (e) {
      console.error(`[SCORE] ${result.customId} parse error:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`[SCORE] Batch complete: ${totalScored} signals scored (${totalTokensInput} in / ${totalTokensOutput} out tokens)`);

  return new Response(
    JSON.stringify({
      status: 'ended',
      scored: totalScored,
      request_counts: batch.counts,
      tokens: { input: totalTokensInput, output: totalTokensOutput },
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ─── Main Handler ────────────────────────────────────

const ScoreProspectSignalsRequestSchema = z.object({
  user_id: z.string().uuid().optional(),
  check_batch: z.string().optional(),
}).passthrough();

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'));

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Read body ONCE via text() — Deno Request.clone() is unreliable in edge runtime.
  // We read the raw text and parse it here, then pass the parsed body downstream
  // instead of reading req again.
  let parsedBody: Record<string, unknown> = {};
  try {
    const rawText = await req.text();
    if (rawText && rawText.trim()) {
      parsedBody = JSON.parse(rawText);
    }
  } catch {
    // body may be empty or invalid JSON — OK
  }

  const _validation = validateOrRespond(ScoreProspectSignalsRequestSchema, parsedBody, corsHeaders, "strict", { functionName: "score-prospect-signals" });
  if (_validation.response) return _validation.response;

  try {
    const bodyUserId = parsedBody.user_id as string | undefined;
    const { userId, error: authError } = await extractUserId(supabase, req, bodyUserId);
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', detail: authError }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (profile?.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Body already parsed at top of handler — reuse it
    const body = parsedBody;

    if (body.check_batch) {
      return await handleCheckBatch(body.check_batch as string, corsHeaders);
    } else {
      return await handleSubmitBatch(corsHeaders);
    }
  } catch (error) {
    console.error('[SCORE] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
