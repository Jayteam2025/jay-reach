/**
 * Handler de scoring des signaux (T12) : pré-filtre blacklist/NAF/fraîcheur, puis
 * scoring LLM par persona, persistance (score/statut) et auto-apprentissage de la
 * blacklist. Le modèle est injecté (`SignalScorer`) : le worker branche
 * l'adaptateur Anthropic réel, les tests un scorer déterministe (zéro réseau).
 *
 * Le worker utilise la clé de service (bypass RLS) → filtre par organisation.
 */
import type { Pool } from 'pg';
import {
  buildScoringUserMessage,
  isCabinetVerdict,
  isRecruitmentAgency,
  meetsScoreThreshold,
  passesRules,
  type Score,
  type ScoringProspect,
} from '@jay-reach/core';
import { loadRecruitmentBlacklist, learnRecruitmentAgency } from '../blacklist.js';

/**
 * Injection du modèle. Reçoit les prospects et le prompt système (de la persona),
 * renvoie un score par prospect. L'implémentation réelle appelle Anthropic ;
 * les tests fournissent une fonction pure.
 */
export type SignalScorer = (
  prospects: readonly ScoringProspect[],
  systemPrompt: string,
) => Promise<Score[]>;

// Longueur minimale d'un prompt de scoring exploitable (repris de
// signal-scoring-core : en-dessous, la persona est considérée non configurée).
const MIN_SCORING_PROMPT_LENGTH = 200;
const DEFAULT_MIN_SCORE = 60;
const DEFAULT_FRESHNESS_DAYS = 30;
const DEFAULT_BATCH = 50;

export interface ScoreSignalsInput {
  readonly pool: Pool;
  readonly organizationId: string;
  readonly scorer: SignalScorer;
  readonly minScore?: number;
  readonly freshnessWindowDays?: number;
  readonly batchSize?: number;
  readonly now?: number;
}

export interface ScoreSummary {
  readonly considered: number;
  readonly prefiltered: number;
  readonly scored: number;
  readonly qualified: number;
  readonly discarded: number;
  readonly learned: number;
  readonly skippedNoPrompt: boolean;
}

interface CandidateRow {
  id: string;
  company: string | null;
  title: string | null;
  location: string | null;
  description: string | null;
  occurred_at: string;
  naf_code: string | null;
}

async function markDiscarded(pool: Pool, id: string, reason: string): Promise<void> {
  await pool.query(
    `update public.signals
        set status = 'discarded', discard_reason = $2, scored_at = now()
      where id = $1`,
    [id, reason],
  );
}

async function persistScore(
  pool: Pool,
  id: string,
  score: number,
  reason: string,
  status: 'qualified' | 'discarded',
  discardReason: string | null,
): Promise<void> {
  await pool.query(
    `update public.signals
        set score = $2, score_reason = $3, status = $4, discard_reason = $5, scored_at = now()
      where id = $1`,
    [id, score, reason, status, discardReason],
  );
}

/**
 * Score un lot de signaux « new » (non encore scorés) d'une organisation.
 * Retourne un récapitulatif. Idempotent au niveau job : ne reprend que les
 * signaux `status='new'` et `score is null`.
 */
export async function runScore(input: ScoreSignalsInput): Promise<ScoreSummary> {
  const minScore = input.minScore ?? DEFAULT_MIN_SCORE;
  const freshnessWindowDays = input.freshnessWindowDays ?? DEFAULT_FRESHNESS_DAYS;
  const batchSize = input.batchSize ?? DEFAULT_BATCH;
  const now = input.now ?? Date.now();
  const pool = input.pool;
  const org = input.organizationId;

  // Prompt de scoring : première persona active avec un prompt exploitable.
  // (Raffinement possible : scorer chaque signal contre chaque persona et garder
  // le meilleur — noté dans QUESTIONS.md. Pour l'instant : un prompt par org.)
  const personaRes = await pool.query<{ scoring_prompt: string | null }>(
    `select scoring_prompt from public.personas
      where organization_id = $1 and is_active = true and scoring_prompt is not null
      order by created_at asc`,
    [org],
  );
  const prompt = personaRes.rows
    .map((r) => r.scoring_prompt)
    .find((p): p is string => Boolean(p && p.trim().length >= MIN_SCORING_PROMPT_LENGTH));

  const empty: ScoreSummary = {
    considered: 0, prefiltered: 0, scored: 0, qualified: 0, discarded: 0, learned: 0, skippedNoPrompt: !prompt,
  };
  if (!prompt) return empty;

  const blacklist = await loadRecruitmentBlacklist(pool, org);

  const candRes = await pool.query<CandidateRow>(
    `select s.id,
            coalesce(a.name, s.company_hint) as company,
            s.title, s.location,
            s.raw ->> 'description' as description,
            s.occurred_at, a.naf_code
       from public.signals s
       left join public.accounts a on a.id = s.account_id
      where s.organization_id = $1 and s.status = 'new' and s.score is null
      order by s.occurred_at desc
      limit $2`,
    [org, batchSize],
  );
  const candidates = candRes.rows;
  if (candidates.length === 0) return { ...empty, skippedNoPrompt: false };

  let prefiltered = 0;
  let qualified = 0;
  let discarded = 0;
  let learned = 0;

  // 1) Pré-filtre bon marché : cabinets (blacklist + NAF) et signaux périmés.
  const survivors: CandidateRow[] = [];
  for (const c of candidates) {
    const company = c.company ?? '';
    const isAgency = isRecruitmentAgency({ name: company, naf: c.naf_code }, blacklist);
    if (isAgency) {
      await markDiscarded(pool, c.id, 'recruitment_agency');
      prefiltered++;
      discarded++;
      continue;
    }
    const fresh = passesRules({
      company,
      naf: c.naf_code,
      occurredAt: c.occurred_at,
      freshnessWindowDays,
      now,
      recruitmentBlacklist: blacklist,
    });
    if (!fresh) {
      await markDiscarded(pool, c.id, 'stale');
      prefiltered++;
      discarded++;
      continue;
    }
    survivors.push(c);
  }

  // 2) Scoring LLM des survivants.
  if (survivors.length > 0) {
    const prospects: ScoringProspect[] = survivors.map((c) => ({
      id: c.id,
      company: c.company ?? '',
      title: c.title ?? '',
      location: c.location ?? undefined,
      description: c.description ?? undefined,
    }));
    const scores = await input.scorer(prospects, prompt);
    const byId = new Map(scores.map((s) => [s.id, s]));

    for (const c of survivors) {
      const s = byId.get(c.id);
      if (!s) {
        // Le modèle n'a pas renvoyé ce prospect : on le laisse « new » (retry).
        continue;
      }
      // Auto-apprentissage : score nul + motif « cabinet » → blacklist de l'org.
      if (s.score === 0 && isCabinetVerdict(s.reason)) {
        await learnRecruitmentAgency(pool, org, c.company ?? '');
        await persistScore(pool, c.id, s.score, s.reason, 'discarded', 'recruitment_agency');
        learned++;
        discarded++;
        continue;
      }
      if (meetsScoreThreshold(s.score, minScore)) {
        await persistScore(pool, c.id, s.score, s.reason, 'qualified', null);
        qualified++;
      } else {
        await persistScore(pool, c.id, s.score, s.reason, 'discarded', 'low_score');
        discarded++;
      }
    }
  }

  return {
    considered: candidates.length,
    prefiltered,
    scored: survivors.length,
    qualified,
    discarded,
    learned,
    skippedNoPrompt: false,
  };
}

// Ré-exporté pour l'assemblage du message côté adaptateur réel (voir scorer-anthropic).
export { buildScoringUserMessage };
