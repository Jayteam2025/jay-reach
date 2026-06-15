import type { EnrichedProfile } from '@/hooks/useEnrichedCompanies';

/**
 * Labels legacy par target_category. Utilises en fallback quand profile.persona
 * n'est pas resolu (rows pre-migration 1.2.2). Préférer profile.persona.label.
 */
export const CATEGORY_LABELS: Record<EnrichedProfile['target_category'], string> = {
  hr: 'Ressources humaines',
  director: 'Directeur commercial',
  field_sales: 'Commercial terrain',
};

/** Résout le label affichable d'un profile : persona.label en priorité, fallback legacy. */
export function getProfileLabel(profile: EnrichedProfile): string {
  return profile.persona?.label ?? CATEGORY_LABELS[profile.target_category];
}

/**
 * Canaux automatisables par catégorie — doit rester aligné avec
 * supabase/functions/generate-prospect-messages-bulk/index.ts (CHANNELS_BY_CATEGORY).
 * TODO 1.2.3.c : basculer sur profile.persona.channels_priority quand le backend
 * sera refactor.
 */
export const AUTOMATABLE_CHANNELS_BY_CATEGORY: Record<EnrichedProfile['target_category'], string[]> = {
  hr: ['email'],
  director: ['email', 'postal_letter'],
  field_sales: ['email'],
};

export function hasApplicableChannel(profile: EnrichedProfile): boolean {
  const channels = AUTOMATABLE_CHANNELS_BY_CATEGORY[profile.target_category] || [];
  const enrichment = profile.enrichment_data || {};
  const hasAddress = typeof enrichment.company_address === 'string' && enrichment.company_address.length > 0;
  return channels.some((ch) => {
    if (ch === 'email') return !!profile.email;
    if (ch === 'postal_letter') return hasAddress;
    return false;
  });
}
