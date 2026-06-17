import type { EnrichedProfile } from '@/hooks/useEnrichedCompanies';

/** Résout le label affichable d'un profile : persona.label. */
export function getProfileLabel(profile: EnrichedProfile): string {
  return profile.persona?.label ?? 'Contact';
}

export function hasApplicableChannel(profile: EnrichedProfile): boolean {
  const channels = profile.persona?.channels_priority || [];
  const enrichment = profile.enrichment_data || {};
  const hasAddress = typeof enrichment.company_address === 'string' && enrichment.company_address.length > 0;
  return channels.some((ch) => {
    if (ch === 'email') return !!profile.email;
    if (ch === 'postal_letter') return hasAddress;
    return false;
  });
}
