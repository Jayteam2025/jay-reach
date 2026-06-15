/**
 * Types + mappers purs de la config workspace prospection (Jay Reach dé-hardcoding PR1).
 *
 * Philosophie identique à workspace-brand.ts : AUCUN fallback Jay-specifique.
 * Une config invalide ou manquante => WorkspaceConfigError explicite, jamais
 * de valeur par défaut métier. C'est volontaire : un fallback silencieux
 * réintroduirait le hardcode qu'on supprime.
 *
 * Fichier PUR (zéro import) : testé par Vitest (src/__tests__/workspace-config-core.test.ts),
 * consommé par workspace-config.ts (Deno) qui fait les requêtes.
 *
 * Champs OBLIGATOIRES (throw si manquants/invalides) : id, workspace_id, slug
 * + persona : label, persona_scoring_prompt, channels_priority non vide,
 *   search_strategy valide, enrichment_caps valides
 * + trigger : signal_scoring_prompt.
 * Fallbacks DÉFENSIFS (champ optionnel ou colonne NOT NULL avec défaut DB) :
 * geo_filters/elimination_rules -> [], exclude_intermediaries -> true,
 * signal_match_threshold -> 60.
 */

export type SearchStrategy = 'by_titles' | 'seniority_cast_wide';

export interface EnrichmentCaps {
  /** Nombre max de candidats demandés à FullEnrich /people/search. */
  search_max: number;
  /** Nombre max de candidats gardés après validation IA (null = pas de cap). */
  keep_cap: number | null;
  /** Nombre min de contacts visés (sert aux cascades géo). */
  min_contacts: number;
}

export interface PersonaConfig {
  id: string;
  workspace_id: string;
  slug: string;
  label: string;
  job_title_keywords: string[];
  seniority_levels: string[];
  department_patterns: string[];
  exclude_titles: string[];
  persona_scoring_prompt: string;
  channels_priority: string[];
  search_strategy: SearchStrategy;
  enrichment_caps: EnrichmentCaps;
  is_default: boolean;
}

export interface GeoFilter {
  country?: string;
  regions?: string[];
  cities?: string[];
}

export interface TriggerConfig {
  id: string;
  workspace_id: string;
  slug: string;
  search_keywords: string[];
  exclude_keywords: string[];
  source_types: string[];
  geo_filters: GeoFilter[];
  signal_scoring_prompt: string;
  signal_match_threshold: number;
  elimination_rules: unknown[];
  exclude_intermediaries: boolean;
  is_default: boolean;
}

export class WorkspaceConfigError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceConfigError';
  }
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string');
}

function requireString(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorkspaceConfigError(
      'invalid_config',
      `${context}: champ ${field} manquant ou vide — configurez-le dans Prospection > Config`,
    );
  }
  return value;
}

function parseCaps(value: unknown, context: string): EnrichmentCaps {
  const obj = (value ?? {}) as Record<string, unknown>;
  const searchMax = obj.search_max;
  const keepCap = obj.keep_cap;
  const minContacts = obj.min_contacts;
  const searchMaxOk = typeof searchMax === 'number' && Number.isFinite(searchMax) && searchMax > 0;
  const keepCapOk = keepCap === null || (typeof keepCap === 'number' && Number.isFinite(keepCap) && keepCap > 0);
  const minOk = typeof minContacts === 'number' && Number.isFinite(minContacts) && minContacts >= 0;
  if (!searchMaxOk || !keepCapOk || !minOk) {
    throw new WorkspaceConfigError(
      'invalid_config',
      `${context}: enrichment_caps invalides (attendu {search_max>0, keep_cap>0|null, min_contacts>=0})`,
    );
  }
  return { search_max: searchMax, keep_cap: keepCap as number | null, min_contacts: minContacts };
}

export function mapPersonaRow(row: Record<string, unknown>): PersonaConfig {
  const slug = requireString(row.slug, 'slug', 'icp_personas');
  const context = `icp_personas[${slug}]`;
  const strategy = row.search_strategy;
  if (strategy !== 'by_titles' && strategy !== 'seniority_cast_wide') {
    throw new WorkspaceConfigError('invalid_config', `${context}: search_strategy inconnue "${String(strategy)}"`);
  }
  const channels = strArray(row.channels_priority);
  if (channels.length === 0) {
    throw new WorkspaceConfigError('invalid_config', `${context}: channels_priority vide — au moins un canal requis`);
  }
  return {
    id: requireString(row.id, 'id', context),
    workspace_id: requireString(row.workspace_id, 'workspace_id', context),
    slug,
    label: requireString(row.label, 'label', context),
    job_title_keywords: strArray(row.job_title_keywords),
    seniority_levels: strArray(row.seniority_levels),
    department_patterns: strArray(row.department_patterns),
    exclude_titles: strArray(row.exclude_titles),
    persona_scoring_prompt: requireString(row.persona_scoring_prompt, 'persona_scoring_prompt', context),
    channels_priority: channels,
    search_strategy: strategy,
    enrichment_caps: parseCaps(row.enrichment_caps, context),
    is_default: row.is_default === true,
  };
}

export function mapTriggerRow(row: Record<string, unknown>): TriggerConfig {
  const slug = requireString(row.slug, 'slug', 'signal_triggers');
  const context = `signal_triggers[${slug}]`;
  const geoRaw = row.geo_filters;
  const geo: GeoFilter[] = Array.isArray(geoRaw)
    ? geoRaw.filter((g): g is GeoFilter => typeof g === 'object' && g !== null)
    : [];
  return {
    id: requireString(row.id, 'id', context),
    workspace_id: requireString(row.workspace_id, 'workspace_id', context),
    slug,
    search_keywords: strArray(row.search_keywords),
    exclude_keywords: strArray(row.exclude_keywords),
    source_types: strArray(row.source_types),
    geo_filters: geo,
    signal_scoring_prompt: requireString(row.signal_scoring_prompt, 'signal_scoring_prompt', context),
    signal_match_threshold: typeof row.signal_match_threshold === 'number' ? row.signal_match_threshold : 60,
    elimination_rules: Array.isArray(row.elimination_rules) ? row.elimination_rules : [],
    exclude_intermediaries: typeof row.exclude_intermediaries === 'boolean' ? row.exclude_intermediaries : true,
    is_default: row.is_default === true,
  };
}
