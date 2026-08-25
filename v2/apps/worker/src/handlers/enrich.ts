/**
 * Handlers d'enrichissement (files `enrichment.company` / `enrichment.contacts`).
 * On RÉUTILISE le vrai moteur FullEnrich porté du legacy (résolution
 * d'entreprise, recherche + enrichissement de contacts, filtrage recruteurs) ;
 * seule la persistance est réécrite sur le nouveau schéma (cf. enrichment-persist).
 *
 * Le cache legacy (enrichment_cache) pointe sur l'ancien schéma : on branche un
 * adaptateur « no-cache » (toujours un miss) — resolveCompany fait alors l'appel
 * réel sans jamais planter. La dédup (dedupContext) est volontairement omise.
 */
import {
  resolveCompany,
  searchContactsAtCompany,
  filterOutRecruiters,
  enrichContactsViaFullEnrich,
  pickBestEmailWithSource,
  type ResolvedCompany,
  type SupabaseLike,
  type FullEnrichContactInput,
  type FullEnrichContactResult,
} from '@jay-reach/providers/enrichment';
import type { CompanyEnrichment, EnrichedContact } from '../enrichment-persist.js';

/** Adaptateur cache inerte : satisfait SupabaseLike, renvoie toujours un miss. */
const NO_CACHE: SupabaseLike = {
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: null, error: null }) };
              },
            };
          },
        };
      },
      upsert: async () => ({ error: null }),
    };
  },
};

export interface EnrichCompanyJob {
  readonly organizationId: string;
  readonly accountId: string;
  readonly companyName: string;
  readonly domain?: string;
  readonly linkedinUrl?: string;
  readonly countryCode?: string;
}

/** Résout l'identité canonique FullEnrich d'une entreprise (domaine, effectif…). */
export async function runResolveCompany(apiKey: string, job: EnrichCompanyJob): Promise<ResolvedCompany | null> {
  return resolveCompany(NO_CACHE, apiKey, job.companyName, {
    ...(job.domain ? { domain: job.domain } : {}),
    ...(job.linkedinUrl ? { linkedin_url: job.linkedinUrl } : {}),
    ...(job.countryCode ? { country_code: job.countryCode } : {}),
    llm: null,
  });
}

export function toCompanyEnrichment(r: ResolvedCompany): CompanyEnrichment {
  return {
    domain: r.domain,
    headcount: r.headcount,
    city: r.hq_city,
    industry: r.industry,
    linkedinUrl: r.professional_network_url,
    providerId: r.id,
    matchScore: r.match_score,
  };
}

export interface EnrichContactsJob {
  readonly organizationId: string;
  readonly accountId: string;
  readonly companyName: string;
  /** Id canonique FullEnrich (le plus fiable) si déjà résolu. */
  readonly companyId?: string;
  readonly domain?: string;
  readonly positionTitles: string[];
  readonly seniorityLevels?: string[];
  readonly personaId?: string;
  readonly sourceSignalId?: string;
  readonly maxContacts?: number;
}

/** Statut brut de l'email retenu (pour le mapping email_status en base). */
function rawStatusOf(result: FullEnrichContactResult, email: string | null): string | null {
  if (!email) {
    return null;
  }
  const info = result.contact_info;
  if (!info) {
    return null;
  }
  const all = [
    info.most_probable_work_email,
    info.most_probable_personal_email,
    ...(info.work_emails ?? []),
    ...(info.personal_emails ?? []),
  ];
  for (const e of all) {
    if (e && e.email === email) {
      return e.status ?? null;
    }
  }
  return null;
}

/**
 * Recherche les contacts d'un persona dans une entreprise, les enrichit (email
 * vérifié) et retourne les contacts prêts à persister (ceux avec un email).
 */
export async function runFindContacts(apiKey: string, job: EnrichContactsJob): Promise<EnrichedContact[]> {
  const search = await searchContactsAtCompany(apiKey, {
    ...(job.companyId ? { companyIds: [{ value: job.companyId }] } : {}),
    ...(!job.companyId && job.domain ? { companyDomains: [{ value: job.domain }] } : {}),
    ...(!job.companyId && !job.domain ? { companyNames: [{ value: job.companyName }] } : {}),
    positionTitles: job.positionTitles.map((value) => ({ value })),
    ...(job.seniorityLevels && job.seniorityLevels.length > 0
      ? { seniorityLevels: job.seniorityLevels.map((value) => ({ value })) }
      : {}),
    maxContacts: job.maxContacts ?? 10,
  });

  const people = filterOutRecruiters(search.people);
  if (people.length === 0) {
    return [];
  }

  const inputs: FullEnrichContactInput[] = people.map((p, idx) => ({
    ...(p.first_name ? { first_name: p.first_name } : {}),
    ...(p.last_name ? { last_name: p.last_name } : {}),
    company_name: job.companyName,
    ...(job.domain ? { domain: job.domain } : {}),
    ...(p.social_profiles?.professional_network?.url ? { linkedin_url: p.social_profiles.professional_network.url } : {}),
    custom: { contact_key: `c_${idx}` },
  }));

  const enriched = await enrichContactsViaFullEnrich(apiKey, `enrich-${job.accountId}`, inputs);

  const out: EnrichedContact[] = [];
  people.forEach((p, idx) => {
    const result = enriched.resultsByKey.get(`c_${idx}`);
    const picked = result ? pickBestEmailWithSource(result) : { email: null };
    if (!picked.email) {
      return;
    }
    out.push({
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      jobTitle: p.employment?.current?.title ?? null,
      email: picked.email,
      emailStatusRaw: result ? rawStatusOf(result, picked.email) : null,
      linkedinUrl: p.social_profiles?.professional_network?.url ?? null,
      linkedinProviderId: p.id ?? null,
      ...(job.personaId ? { personaId: job.personaId } : {}),
      ...(job.sourceSignalId ? { sourceSignalId: job.sourceSignalId } : {}),
    });
  });
  return out;
}
