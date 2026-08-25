/**
 * Scoring des signaux : règles (peu chères) puis modèle. La sortie du modèle
 * est validée par Zod ; le parsing est tolérant (fences, préambule) et clampe
 * le score. Le prompt est éditable/versionné (stocké hors code) et tracé dans
 * l'audit. Coût par appel estimable. Connaissance issue de T0.
 */
import { z } from 'zod';
import { isRecruitmentAgency } from './signal-filters.js';

export const scoreSchema = z.object({
  id: z.string(),
  score: z.number().int().min(0).max(100),
  reason: z.string(),
  persona_hint: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export const scoreArraySchema = z.array(scoreSchema);
export type Score = z.infer<typeof scoreSchema>;

/** Règles avant appel modèle : fraîcheur + exclusion cabinets. Rejet = coût nul. */
export interface RulePrecheckInput {
  readonly company?: string;
  readonly naf?: string | null;
  readonly occurredAt: string;
  readonly freshnessWindowDays: number;
  readonly now: number;
  /**
   * Blacklist des cabinets/intermédiaires (noms normalisés via
   * `normalizeAgencyName`), chargée depuis `recruitment_agencies_blacklist`
   * (global + organisation). Optionnelle : hors-DB, seuls le NAF + le repli
   * intégré s'appliquent.
   */
  readonly recruitmentBlacklist?: ReadonlySet<string>;
}

export function passesRules(input: RulePrecheckInput): boolean {
  if (isRecruitmentAgency({ name: input.company, naf: input.naf }, input.recruitmentBlacklist)) {
    return false;
  }
  const occurred = Date.parse(input.occurredAt);
  if (Number.isFinite(occurred)) {
    const ageDays = (input.now - occurred) / (1000 * 60 * 60 * 24);
    if (ageDays > input.freshnessWindowDays) {
      return false;
    }
  }
  return true;
}

/** Parsing tolérant de la réponse modèle : retire les fences, isole le tableau JSON, clampe le score. */
export function parseScoringResponse(raw: string): Score[] {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    text = match[0];
  }
  const parsed: unknown = JSON.parse(text);
  const array = Array.isArray(parsed) ? parsed : [];
  const clamped = array.map((item) => {
    const record = item as Record<string, unknown>;
    const rawScore = Number(record.score);
    return {
      ...record,
      score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0,
    };
  });
  return scoreArraySchema.parse(clamped);
}

/** Message utilisateur envoyé au modèle (le prompt système est stocké par source). */
export interface ScoringProspect {
  readonly id: string;
  readonly company: string;
  readonly title: string;
  readonly location?: string;
  readonly description?: string;
}

export function buildScoringUserMessage(prospects: readonly ScoringProspect[]): string {
  const blocks = prospects
    .map(
      (p) =>
        `ID: ${p.id}\nEntreprise: ${p.company}\nPoste: ${p.title}\nLocalisation: ${p.location ?? ''}\nDescription: ${(p.description ?? '').slice(0, 150)}`,
    )
    .join('\n---\n');
  return (
    `Évalue ces ${prospects.length} prospects selon les critères définis dans les instructions système.\n\n` +
    `${blocks}\n\n` +
    `Réponds UNIQUEMENT avec un tableau JSON valide, un objet par prospect, au format exact :\n` +
    `[{"id": "<recopie l'ID>", "score": <entier 0 à 100>, "reason": "<une phrase>"}]`
  );
}

/** Coût estimé d'un lot de scoring (prix par appel/prospect fourni par le provider). */
export function estimateScoringCostEur(prospectCount: number, pricePerProspectEur: number): number {
  return Math.round(prospectCount * pricePerProspectEur * 10000) / 10000;
}

// Le modèle signale un cabinet de recrutement / intermédiaire quand son motif le
// dit (« recrute pour un client », « cabinet », « intérim »…). On s'en sert pour
// l'auto-apprentissage de la blacklist (source auto_score), fidèle au v1.
const CABINET_VERDICT_RE =
  /\b(cabinet|agence)\s+de\s+recrutement|recrute\s+pour|pour\s+(le\s+compte|un\s+client)|int[eé]rim|interim|staffing|portage|prestataire\s+de\s+recrutement|soci[eé]t[eé]\s+de\s+placement|intermédiaire|intermediaire\b/i;

/**
 * Le motif de scoring désigne-t-il un cabinet/intermédiaire ? Utilisé pour
 * déclencher l'apprentissage de la blacklist quand le modèle met un score bas.
 */
export function isCabinetVerdict(reason: string | null | undefined): boolean {
  return Boolean(reason && CABINET_VERDICT_RE.test(reason));
}

/** Un signal atteint-il le seuil de qualification (score ≥ minScore) ? */
export function meetsScoreThreshold(score: number, minScore: number): boolean {
  return score >= minScore;
}

/**
 * Système de niveaux repris du socle actuel : `fast` (classification légère) et
 * `smart` (le scoring). Le modèle par défaut est réglé au niveau, PAS en dur au
 * point d'appel. Un opérateur le surcharge par organisation via la config du
 * provider Anthropic (`model_fast` / `model_smart`), éditable dans l'écran
 * Providers — jamais par variable d'environnement (qui serait globale au worker).
 *
 * Seul changement vs le socle : `claude-sonnet-4-6` → `claude-sonnet-5`. Le
 * scoring tourne en `smart` → Sonnet. (Fable est le plus cher du catalogue et
 * n'a rien à faire ici ; Haiku reste le niveau `fast`.)
 */
export type LlmTier = 'fast' | 'smart';
export const SCORING_MODELS: Record<LlmTier, string> = {
  fast: 'claude-haiku-4-5-20251001',
  smart: 'claude-sonnet-5',
};

/** Résout le modèle d'un niveau : override de la config provider, sinon défaut. */
export function resolveScoringModel(
  tier: LlmTier,
  config?: Record<string, string | undefined> | null,
): string {
  const override = config?.[tier === 'fast' ? 'model_fast' : 'model_smart'];
  return typeof override === 'string' && override.trim() ? override.trim() : SCORING_MODELS[tier];
}

/**
 * Budget de sortie dimensionné sur la taille du lot. Chaque objet
 * `{id, score, reason}` pèse ~50-80 tokens (UUID + score + phrase + ponctuation) ;
 * un `max_tokens` figé (2000) tronque dès ~30 signaux → JSON invalide → lot perdu.
 * On alloue ~200 tokens/signal + une marge de base. `thinking` étant désactivé
 * sur l'appel, ce budget sert entièrement au JSON.
 */
export function scoringMaxTokens(prospectCount: number): number {
  const n = Math.max(0, Math.trunc(prospectCount));
  return Math.max(2048, n * 200 + 512);
}
