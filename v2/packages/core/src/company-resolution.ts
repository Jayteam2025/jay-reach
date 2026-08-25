/**
 * Résolution d'entreprise (docs/01-architecture.md). Un nom en texte libre est
 * rattaché à une entité stable (SIREN). Quatre passes, du plus sûr au plus flou.
 * La logique est pure : les accès (domaine, annuaire légal, trigram) sont injectés,
 * ce qui la rend testable sur les cas difficiles (filiales, homonymes, sigles, accents).
 */

/** Normalise un nom d'entreprise : minuscules, sans accents, sans suffixe juridique. */
export function normalizeCompanyName(raw: string): string {
  const noAccents = raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const lower = noAccents.toLowerCase();
  const stripped = lower
    .replace(
      /\b(sas|sasu|sarl|eurl|sa|snc|scp|scs|sci|selarl|selas|group|groupe|holding|international|france|europe)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return stripped;
}

export interface CompanyHint {
  readonly name: string;
  readonly domain?: string;
  readonly postalCode?: string;
}

export interface AccountCandidate {
  readonly accountId: string;
  readonly name: string;
  /** Score de similarité 0..1 (rempli par la passe trigram). */
  readonly similarity?: number;
}

export type ResolutionPass = 'domain' | 'legal_registry' | 'trigram' | 'unresolved';

export interface ResolutionResult {
  readonly status: 'resolved' | 'unresolved';
  readonly accountId?: string;
  readonly pass: ResolutionPass;
  readonly siren?: string;
}

export interface ResolutionLookups {
  /** Passe 1 : compte connu par domaine web exact. */
  byDomain(domain: string): Promise<AccountCandidate | null>;
  /** Passe 2 : annuaire légal (raison sociale + code postal) → SIREN. */
  byLegalRegistry(name: string, postalCode?: string): Promise<{ accountId: string; siren: string } | null>;
  /** Passe 3 : correspondance floue (trigram) sur les comptes en base. */
  byTrigram(normalizedName: string): Promise<AccountCandidate[]>;
}

/** Seuil de similarité trigram au-dessus duquel on accepte un rattachement. */
export const TRIGRAM_MATCH_THRESHOLD = 0.5;

export async function resolveCompany(
  hint: CompanyHint,
  lookups: ResolutionLookups,
): Promise<ResolutionResult> {
  // Passe 1 — domaine web exact.
  if (hint.domain) {
    const byDomain = await lookups.byDomain(hint.domain);
    if (byDomain) {
      return { status: 'resolved', accountId: byDomain.accountId, pass: 'domain' };
    }
  }

  // Passe 2 — annuaire légal (raison sociale + code postal).
  const legal = await lookups.byLegalRegistry(hint.name, hint.postalCode);
  if (legal) {
    return { status: 'resolved', accountId: legal.accountId, pass: 'legal_registry', siren: legal.siren };
  }

  // Passe 3 — trigram sur les comptes existants.
  const normalized = normalizeCompanyName(hint.name);
  const candidates = await lookups.byTrigram(normalized);
  const best = [...candidates].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))[0];
  if (best && (best.similarity ?? 0) >= TRIGRAM_MATCH_THRESHOLD) {
    return { status: 'resolved', accountId: best.accountId, pass: 'trigram' };
  }

  // Passe 4 — aucune correspondance sûre : arbitrage humain.
  return { status: 'unresolved', pass: 'unresolved' };
}
