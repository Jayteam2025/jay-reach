import type { EnrichedProfile } from '@/hooks/useEnrichedCompanies';

/** Résout le label affichable d'un profile : persona.label. */
export function getProfileLabel(profile: EnrichedProfile): string {
  return profile.persona?.label ?? 'Contact';
}

export function hasApplicableChannel(profile: EnrichedProfile): boolean {
  const channels = profile.persona?.channels_priority || [];
  return channels.some((ch) => {
    if (ch === 'email') return !!profile.email;
    return false;
  });
}
