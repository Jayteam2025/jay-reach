/**
 * Logique pure de mapping persona → recherche FullEnrich / filtre IA / fallback
 * (Jay Reach dé-hardcoding PR3). Zéro import runtime (type-only depuis
 * workspace-config-core), testé par Vitest, consommé par enrich-company +
 * expand-prospect-profiles (Deno).
 */
import type { PersonaConfig } from './workspace-config-core.ts';

/** Filtre FullEnrich (forme attendue par searchContactsAtCompany). */
export interface SearchFilterLike {
  value: string;
  exact_match?: boolean;
}

export interface PersonaSearch {
  /** positionTitles pour /people/search ; undefined en stratégie cast_wide. */
  positionTitles?: SearchFilterLike[];
  /** seniorityLevels ; undefined si le persona n'en définit pas (hors cast_wide). */
  seniorityLevels?: SearchFilterLike[];
  /** cap de candidats demandés (enrichment_caps.search_max). */
  maxContacts: number;
  /** seuil d'arrêt cascade géo (enrichment_caps.min_contacts). */
  minContacts: number;
  /** cap de candidats gardés après filtre IA (enrichment_caps.keep_cap, null = pas de cap). */
  keepCap: number | null;
}

/**
 * Construit la recherche FullEnrich d'un persona.
 * - by_titles : positionTitles = job_title_keywords (+ seniority_levels si non vide).
 * - seniority_cast_wide : seniorityLevels SEULS (pas de positionTitles) ; le filtre
 *   IA derrière garde les bons (stratégie DirCo : capter tous les Director/VP de
 *   l'entité puis trier).
 */
export function buildPersonaSearch(persona: PersonaConfig): PersonaSearch {
  const caps = persona.enrichment_caps;
  const seniority = persona.seniority_levels.length > 0
    ? persona.seniority_levels.map((s) => ({ value: s }))
    : undefined;

  if (persona.search_strategy === 'seniority_cast_wide') {
    return {
      positionTitles: undefined,
      seniorityLevels: seniority,
      maxContacts: caps.search_max,
      minContacts: caps.min_contacts,
      keepCap: caps.keep_cap,
    };
  }
  return {
    positionTitles: persona.job_title_keywords.map((t) => ({ value: t, exact_match: false })),
    seniorityLevels: seniority,
    maxContacts: caps.search_max,
    minContacts: caps.min_contacts,
    keepCap: caps.keep_cap,
  };
}

export interface RoleDefinitionLike {
  id: string;
  display_name: string;
  description: string;
}

/** RoleDefinition pour validateCandidatesWithAI, construite depuis le persona. */
export function buildRoleDefinition(persona: PersonaConfig): RoleDefinitionLike {
  return {
    id: persona.slug,
    display_name: persona.label,
    description: persona.persona_scoring_prompt,
  };
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Fallback générique quand l'IA est indisponible : un titre matche le persona si
 * un job_title_keyword OU un department_pattern y est inclus ET qu'aucun
 * exclude_title n'y est inclus. Le filet department_patterns ('Commercial',
 * 'Sales'...) capte les variantes (féminin/pluriel) que les keywords masculins
 * ne couvrent pas (« Directrice Commerciale » via 'Commercial').
 * Remplace les regex Jay isStrictHrRole/isStrictDirectorRole/isCommercialRole.
 */
export function matchesPersonaTitle(title: string | null | undefined, persona: PersonaConfig): boolean {
  if (!title || !title.trim()) return false;
  const t = normalize(title);
  if (persona.exclude_titles.some((x) => x && t.includes(normalize(x)))) return false;
  const needles = [...persona.job_title_keywords, ...persona.department_patterns];
  return needles.some((kw) => kw && t.includes(normalize(kw)));
}

const JAY_SLUG_TO_CATEGORY: Record<string, string> = {
  'director': 'director',
  'field-sales': 'field_sales',
  'hr-decision-maker': 'hr',
};

/**
 * TRANSITION (retiré en PR4) : dérive le target_category legacy depuis le slug
 * du persona, pour les personas Jay connus. NULL pour tout autre slug.
 * Sert uniquement à ne pas casser les consommateurs de target_category (messages)
 * tant que PR4 ne les a pas basculés sur persona_id.
 */
export function legacyTargetCategory(slug: string): string | null {
  return JAY_SLUG_TO_CATEGORY[slug] ?? null;
}
