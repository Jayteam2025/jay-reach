/**
 * Manifest d'un provider : ce qui permet de le charger, de le valider et de
 * générer son écran de configuration. Validé par Zod (docs/01-architecture.md).
 */
import { z } from 'zod';

export const PROVIDER_CATEGORIES = [
  'signals',
  'enrichment',
  'email',
  'linkedin',
  'mail',
  'inbox',
  'ai',
  'crm',
] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

export const credentialFieldSchema = z.object({
  name: z.string().min(1),
  labelKey: z.string().min(1),
  type: z.enum(['text', 'password']),
  secret: z.boolean(),
  required: z.boolean(),
  fallbackEnv: z.string().optional(),
  /**
   * Aide sous le champ, et exemple dans le champ.
   *
   * Séparés du libellé parce qu'un libellé doit nommer, pas expliquer : la
   * première version du plafond d'enrichissement portait toute sa
   * justification dans son nom, une phrase de cent cinquante caractères là où
   * l'on attend deux mots.
   */
  hintKey: z.string().optional(),
  placeholderKey: z.string().optional(),
});
export type CredentialField = z.infer<typeof credentialFieldSchema>;

export const providerManifestSchema = z.object({
  id: z.string().min(1),
  category: z.enum(PROVIDER_CATEGORIES),
  labelKey: z.string().min(1),
  fields: z.array(credentialFieldSchema).default([]),
});
export type ProviderManifest = z.infer<typeof providerManifestSchema>;

/** Compat T5 : une entrée de catalogue EST un manifest. */
export type ProviderCatalogEntry = ProviderManifest;

/** Valide un manifest (lève une ZodError détaillée sinon). */
export function parseManifest(input: unknown): ProviderManifest {
  return providerManifestSchema.parse(input);
}
