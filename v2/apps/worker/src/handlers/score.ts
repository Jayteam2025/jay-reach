/**
 * Handler de scoring des signaux (T12) : pré-filtre blacklist/NAF/fraîcheur, puis
 * scoring LLM par SOURCE (le « déclencheur »), persistance (score/statut) et
 * auto-apprentissage de la blacklist. Le modèle est injecté (`SignalScorer`) : le
 * worker branche l'adaptateur Anthropic réel, les tests un scorer déterministe.
 *
 * Le prompt de scoring et le seuil vivent dans `sources.config` (jsonb) : le
 * scoring qualifie le signal via sa source, pas via une persona (arbitrage
 * option A, cf. QUESTIONS.md). Chaque source impose son prompt et son seuil.
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
 * Injection du modèle. Reçoit les prospects et le prompt système (de la source),
 * renvoie un score par prospect. L'implémentation réelle appelle Anthropic ;
 * les tests fournissent une fonction pure.
 */
export type SignalScorer = (
  prospects: readonly ScoringProspect[],
  systemPrompt: string,
) => Promise<Score[]>;

// Longueur minimale d'un prompt de scoring exploitable (repris de
// signal-scoring-core : en-dessous, la source est considérée non configurée).
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
  opposition: boolean | null;
  // Config de scoring portée par la source du signal (sources.config).
  source_id: string | null;
  scoring_prompt: string | null;
  match_threshold: number | null;
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

  const blacklist = await loadRecruitmentBlacklist(pool, org);

  // Candidats : signaux « new » non scorés, accompagnés de la config de scoring
  // de leur SOURCE (le « déclencheur »). Le prompt et le seuil vivent dans
  // `sources.config` (option A) : le scoring qualifie le signal via sa source.
  const candRes = await pool.query<CandidateRow>(
    `select s.id,
            coalesce(a.name, s.company_hint) as company,
            s.title, s.location,
            s.raw ->> 'description' as description,
            s.occurred_at, a.naf_code, a.prospecting_opposition as opposition,
            s.source_id,
            so.config ->> 'scoring_prompt' as scoring_prompt,
            nullif(so.config ->> 'match_threshold', '')::double precision as match_threshold
       from public.signals s
       left join public.accounts a on a.id = s.account_id
       left join public.sources so on so.id = s.source_id
      where s.organization_id = $1 and s.status = 'new' and s.score is null
      order by s.occurred_at desc
      limit $2`,
    [org, batchSize],
  );
  const candidates = candRes.rows;
  const empty: ScoreSummary = {
    considered: 0, prefiltered: 0, scored: 0, qualified: 0, discarded: 0, learned: 0, skippedNoPrompt: false,
  };
  if (candidates.length === 0) return empty;

  let prefiltered = 0;
  let qualified = 0;
  let discarded = 0;
  let learned = 0;

  // 1) Pré-filtre bon marché : cabinets (blacklist + NAF) et signaux périmés.
  const survivors: CandidateRow[] = [];
  for (const c of candidates) {
    const company = c.company ?? '';
    // Opposition au démarchage (Sirene) : filtre NON désactivable — l'entreprise a
    // refusé la diffusion publique, on ne la prospecte jamais.
    if (c.opposition === true) {
      await markDiscarded(pool, c.id, 'prospecting_opposition');
      prefiltered++;
      discarded++;
      continue;
    }
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

  // 2) Scoring LLM, groupé par SOURCE : chaque source impose SON prompt et SON
  //    seuil. Une source sans prompt exploitable (< MIN) n'est pas scorée : ses
  //    signaux restent « new » (déclencheur non configuré). Le seuil de la source
  //    (`match_threshold`) prime ; à défaut, on retombe sur `minScore`.
  const bySource = new Map<string, CandidateRow[]>();
  for (const c of survivors) {
    const key = c.source_id ?? '__none__';
    const arr = bySource.get(key);
    if (arr) arr.push(c);
    else bySource.set(key, [c]);
  }

  let scored = 0;
  for (const group of bySource.values()) {
    const first = group[0];
    if (!first) continue;
    const prompt = first.scoring_prompt;
    if (!prompt || prompt.trim().length < MIN_SCORING_PROMPT_LENGTH) {
      continue; // source non configurée pour le scoring → signaux laissés « new »
    }
    const threshold = first.match_threshold ?? minScore;

    const prospects: ScoringProspect[] = group.map((c) => ({
      id: c.id,
      company: c.company ?? '',
      title: c.title ?? '',
      location: c.location ?? undefined,
      description: c.description ?? undefined,
    }));
    const scores = await input.scorer(prospects, prompt);
    const byId = new Map(scores.map((s) => [s.id, s]));
    scored += group.length;

    for (const c of group) {
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
      if (meetsScoreThreshold(s.score, threshold)) {
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
    scored,
    qualified,
    discarded,
    learned,
    // Des signaux ont survécu au pré-filtre mais aucun n'a été scoré = aucune
    // source configurée avec un prompt exploitable.
    skippedNoPrompt: survivors.length > 0 && scored === 0,
  };
}

// Ré-exporté pour l'assemblage du message côté adaptateur réel (voir scorer-anthropic).
export { buildScoringUserMessage };
