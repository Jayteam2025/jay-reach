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
}

export function passesRules(input: RulePrecheckInput): boolean {
  if (isRecruitmentAgency({ name: input.company, naf: input.naf })) {
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
