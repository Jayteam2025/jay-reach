/**
 * Validation (Zod) des entrées de l'éditeur de campagne (T24). Vit dans le cœur
 * pour respecter la règle CLAUDE.md #6 (Zod sur toute donnée entrante) sans
 * imposer Zod au paquet web, et pour être testable hors réseau.
 *
 * Traduit les entrées UI en formes prêtes pour la base :
 *  - `entry_rules` (jsonb) = `{ min_score?, personas? }` ;
 *  - une campagne est adossée à UNE source OU UNE liste (contrainte
 *    `campaigns_one_source`), jamais les deux ;
 *  - `conditions` (jsonb) d'une étape = `{ requires? }`.
 */
import { z } from 'zod';

export const CHANNEL_VALUES = ['email', 'linkedin_invite', 'linkedin_message', 'letter', 'call'] as const;
export type StepChannel = (typeof CHANNEL_VALUES)[number];

/** Conditions d'entrée d'une étape (jsonb `conditions.requires`). */
export const STEP_CONDITION_VALUES = ['previous_opened', 'previous_accepted', 'no_reply'] as const;
export type StepCondition = (typeof STEP_CONDITION_VALUES)[number];

const uuid = z.string().uuid();

/** Création de campagne : nom + point d'entrée (source XOR liste) + règles. */
export const campaignCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Nom requis.').max(120),
    entryKind: z.enum(['source', 'list']),
    entryId: uuid,
    minScore: z.number().int().min(0).max(100).optional(),
    personaIds: z.array(uuid).max(50).optional(),
    dailyCap: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

/** Réglages modifiables d'une campagne (hors étapes). */
export const campaignSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    dailyCap: z.number().int().min(1).max(10_000).nullable().optional(),
    minScore: z.number().int().min(0).max(100).nullable().optional(),
    personaIds: z.array(uuid).max(50).optional(),
  })
  .strict();

export type CampaignSettingsInput = z.infer<typeof campaignSettingsSchema>;

export const campaignStatusSchema = z.enum(['draft', 'active', 'paused', 'archived']);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

/** Étape de séquence (création ou mise à jour). */
export const stepSchema = z
  .object({
    channel: z.enum(CHANNEL_VALUES),
    delayHours: z.number().int().min(0).max(24 * 365),
    templateParentId: uuid.nullable().optional(),
    condition: z.enum(STEP_CONDITION_VALUES).nullable().optional(),
    stopOn: z.array(z.string().min(1)).max(20).optional(),
    callBrief: z.string().max(2000).nullable().optional(),
  })
  .strict();

export type StepInput = z.infer<typeof stepSchema>;

/** Construit l'objet `entry_rules` (jsonb) à partir des entrées validées. */
export function toEntryRules(input: { minScore?: number | null; personaIds?: string[] }): Record<string, unknown> {
  const rules: Record<string, unknown> = {};
  if (typeof input.minScore === 'number') rules.min_score = input.minScore;
  if (input.personaIds && input.personaIds.length > 0) rules.personas = input.personaIds;
  return rules;
}

/** Construit l'objet `conditions` (jsonb) d'une étape. */
export function toStepConditions(condition?: StepCondition | null): Record<string, unknown> {
  return condition ? { requires: condition } : {};
}

/** Résultat de parse : succès typé, ou liste d'erreurs lisibles. */
export type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: string[] };

function parseWith<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  const res = schema.safeParse(value);
  if (res.success) return { ok: true, data: res.data };
  return { ok: false, errors: res.error.issues.map((i) => i.message) };
}

export const parseCampaignCreate = (v: unknown): ParseResult<CampaignCreateInput> => parseWith(campaignCreateSchema, v);
export const parseCampaignSettings = (v: unknown): ParseResult<CampaignSettingsInput> => parseWith(campaignSettingsSchema, v);
export const parseStep = (v: unknown): ParseResult<StepInput> => parseWith(stepSchema, v);
