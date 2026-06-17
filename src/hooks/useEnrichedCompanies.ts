import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useHasActiveBatches } from '@/hooks/useActiveProspectBatches';

/** Persona resolu depuis icp_personas (Jay Reach 1.2.2+). */
export interface ProspectPersona {
  id: string;
  slug: string;
  label: string;
  channels_priority: string[];
}

export interface EnrichedProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  /** Statut de verification email (cf EmailStatusBadge): verified, deduced_high, deduced_unverified, unverified. */
  email_validation_status: string;
  /** Verdict Bouncer (prioritaire sur email_validation_status si renseigne) : valid|invalid|risky|disposable|role|unknown|null. */
  deliverability_status: string | null;
  deliverability_reason: string | null;
  deliverability_checked_at: string | null;
  phone: string | null;
  job_title: string | null;
  company_name: string;
  company_siren: string | null;
  company_size: string | null;
  company_sector: string | null;
  company_city: string | null;
  /** Legacy enum Jay-only. Maintenu pour retro-compat ; preferer `persona` quand disponible. */
  target_category: 'director' | 'field_sales' | 'hr';
  /** FK vers icp_personas (Jay Reach 1.2.2+). NULL pour les rows pre-migration. */
  persona_id: string | null;
  /** Persona resolu (denormalise au fetch). Null si persona_id NULL ou persona introuvable. */
  persona: ProspectPersona | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  /** Timestamp d'envoi de l'invitation LinkedIn (auto via extension ou manuelle). */
  linkedin_invited_at: string | null;
  linkedin_invitation_method: 'extension_auto' | 'cowork_csv' | 'manual' | null;
  company_group_id: string;
  enrichment_data: Record<string, unknown> | null;
  created_at: string;
  /** Decision du gate Smartlead lors du dernier push : 'push' = envoye, sinon raison du skip. */
  smartlead_push_decision: string | null;
}

export interface MoreAvailableCounts {
  [key: string]: number;
}

export interface EnrichedCompany {
  company_group_id: string;
  company_name: string;
  profiles: EnrichedProfile[];
  /** Premier RH trouve (legacy, pour compat). Voir hrList pour tous les RH. */
  hr: EnrichedProfile | null;
  /** Premier Dir Co trouve (legacy, pour compat). Voir directorList pour tous. */
  director: EnrichedProfile | null;
  /** Tous les RH de la boite (>= 1 depuis FullEnrich search). */
  hrList: EnrichedProfile[];
  /** Tous les Dir Co de la boite. */
  directorList: EnrichedProfile[];
  /** Tous les commerciaux terrain. */
  sales: EnrichedProfile[];
  /**
   * Groupes dynamiques par persona slug (Jay Reach 1.2.2+). Permet aux futurs
   * composants de filtrer par n'importe quel persona du workspace, pas
   * uniquement les 3 legacy (hr/director/field_sales).
   */
  personaGroups: Record<string, EnrichedProfile[]>;
  hasEmail: boolean;
  hasLinkedIn: boolean;
  /** Nombre de contacts additionnels dispo dans FullEnrich par categorie. */
  moreAvailable: MoreAvailableCounts | null;
}

export type RawProspectProfile = Omit<EnrichedProfile, 'persona'> & {
  icp_personas:
    | { id: string; slug: string; label: string; channels_priority: string[] }
    | null;
};

/**
 * Denormalise les profils bruts (icp_personas join) + groupe par
 * company_group_id en EnrichedCompany[]. Partage entre useEnrichedCompanies
 * (legacy, full load) et useEnrichedCompaniesPaginated (RPC keyset).
 */
export function denormalizeProfilesToCompanies(
  rawProfiles: RawProspectProfile[],
): EnrichedCompany[] {
  if (rawProfiles.length === 0) return [];

  const profiles: EnrichedProfile[] = rawProfiles.map((p) => {
    const { icp_personas, ...rest } = p;
    return { ...rest, persona: icp_personas ?? null };
  });

  const groupMap = new Map<string, EnrichedProfile[]>();
  for (const p of profiles) {
    const group = groupMap.get(p.company_group_id) || [];
    group.push(p);
    groupMap.set(p.company_group_id, group);
  }

  const deliverabilityOrder: Record<string, number> = {
    valid: 0,
    risky: 1, disposable: 1, role: 1,
    unknown: 2,
    invalid: 4,
  };
  const sortByBouncer = (a: EnrichedProfile, b: EnrichedProfile) => {
    const ra = a.deliverability_status ? (deliverabilityOrder[a.deliverability_status] ?? 5) : 3;
    const rb = b.deliverability_status ? (deliverabilityOrder[b.deliverability_status] ?? 5) : 3;
    if (ra !== rb) return ra - rb;
    return (a.last_name || '').localeCompare(b.last_name || '');
  };

  const companies: EnrichedCompany[] = [];
  for (const [groupId, groupProfiles] of groupMap) {
    const personaGroups: Record<string, EnrichedProfile[]> = {};
    for (const p of groupProfiles) {
      const slug = p.persona?.slug || 'unknown';
      (personaGroups[slug] ||= []).push(p);
    }
    for (const slug of Object.keys(personaGroups)) {
      const group = personaGroups[slug];
      if (group) {
        group.sort(sortByBouncer);
      }
    }

    // Groupes legacy (pour retro-compat)
    const hrList = groupProfiles.filter((p) => p.persona?.slug === 'hr-decision-maker').sort(sortByBouncer);
    const directorList = groupProfiles
      .filter((p) => p.persona?.slug === 'director')
      .sort(sortByBouncer);
    const sales = groupProfiles
      .filter((p) => p.persona?.slug === 'field-sales')
      .sort(sortByBouncer);

    const moreAvailable =
      (groupProfiles[0] as unknown as { more_available_counts?: MoreAvailableCounts | null })
        .more_available_counts ?? null;

    companies.push({
      company_group_id: groupId,
      company_name: groupProfiles[0]?.company_name ?? "",
      profiles: groupProfiles,
      hr: hrList[0] || null,
      director: directorList[0] || null,
      hrList,
      directorList,
      sales,
      personaGroups,
      hasEmail: groupProfiles.some((p) => p.email),
      hasLinkedIn: groupProfiles.some((p) => p.linkedin_url),
      moreAvailable,
    });
  }

  return companies;
}

/**
 * @deprecated Charge TOUS les profils (paginé manuel). Utilise
 * `useEnrichedCompaniesPaginated()` qui scale via RPC keyset.
 * Garde pour les rares cas qui ont besoin de toute la liste (ex: tri/filtre full).
 */
export function useEnrichedCompanies() {
  const hasActiveBatches = useHasActiveBatches();
  return useQuery({
    queryKey: ['enriched-companies'],
    refetchInterval: hasActiveBatches ? 45_000 : false,
    queryFn: async (): Promise<EnrichedCompany[]> => {
      const PAGE = 1000;
      const rawProfiles: RawProspectProfile[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from('prospect_profiles')
          .select('*, icp_personas:persona_id(id, slug, label, channels_priority)')
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rawProfiles.push(...(data as RawProspectProfile[]));
        if (data.length < PAGE) break;
      }
      return denormalizeProfilesToCompanies(rawProfiles);
    },
  });
}
