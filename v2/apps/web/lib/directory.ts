/**
 * Annuaire d'entreprises (T32b) — accès au référentiel public
 * `recherche-entreprises.api.gouv.fr` (gratuit, sans clé). Recherche structurée
 * par code d'activité (NAF), département, tranche d'effectifs. Les entreprises
 * cessées sont exclues des résultats (`etat_administratif=A`).
 */

export interface DirectoryParams {
  naf?: string;
  department?: string;
  /** Bucket d'effectifs : small | mid | large | xl. */
  effectif?: string;
  q?: string;
  page?: number;
}

export interface DirectoryCompany {
  siren: string;
  name: string;
  naf: string | null;
  effectifLabel: string;
  city: string | null;
  postalCode: string | null;
}

export interface DirectoryResult {
  total: number;
  page: number;
  perPage: number;
  results: DirectoryCompany[];
}

// Codes INSEE de tranche d'effectifs → libellé lisible.
const TRANCHE: Record<string, string> = {
  '00': '0 salarié',
  '01': '1 à 2',
  '02': '3 à 5',
  '03': '6 à 9',
  '11': '10 à 19',
  '12': '20 à 49',
  '21': '50 à 99',
  '22': '100 à 199',
  '31': '200 à 249',
  '32': '250 à 499',
  '41': '500 à 999',
  '42': '1 000 à 1 999',
  '51': '2 000 à 4 999',
  '52': '5 000 à 9 999',
  '53': '10 000 et plus',
};

// Buckets d'effectifs de l'UI → liste de codes de tranche INSEE.
export const EFFECTIF_BUCKETS: Record<string, string> = {
  small: '01,02,03',
  mid: '11,12',
  large: '21,22,31,32',
  xl: '41,42,51,52,53',
};

const PER_PAGE = 10;

export async function searchCompanies(p: DirectoryParams): Promise<DirectoryResult> {
  const hasFilter = p.naf || p.department || p.effectif || p.q;
  if (!hasFilter) return { total: 0, page: 1, perPage: PER_PAGE, results: [] };

  const url = new URL('https://recherche-entreprises.api.gouv.fr/search');
  if (p.q) url.searchParams.set('q', p.q);
  if (p.naf) url.searchParams.set('activite_principale', p.naf);
  if (p.department) url.searchParams.set('code_departement', p.department);
  const bucket = p.effectif ? EFFECTIF_BUCKETS[p.effectif] : undefined;
  if (bucket) url.searchParams.set('tranche_effectif_salarie', bucket);
  url.searchParams.set('etat_administratif', 'A'); // actives uniquement (exclut les cessées)
  url.searchParams.set('page', String(p.page ?? 1));
  url.searchParams.set('per_page', String(PER_PAGE));

  const res = await fetch(url, { headers: { accept: 'application/json' }, next: { revalidate: 0 } });
  if (!res.ok) {
    return { total: 0, page: p.page ?? 1, perPage: PER_PAGE, results: [] };
  }
  const data = (await res.json()) as {
    total_results?: number;
    results?: {
      siren: string;
      nom_complet?: string;
      activite_principale?: string;
      tranche_effectif_salarie?: string;
      siege?: { libelle_commune?: string; commune?: string; code_postal?: string };
    }[];
  };

  return {
    total: data.total_results ?? 0,
    page: p.page ?? 1,
    perPage: PER_PAGE,
    results: (data.results ?? []).map((r) => ({
      siren: r.siren,
      name: r.nom_complet ?? r.siren,
      naf: r.activite_principale ?? null,
      effectifLabel: TRANCHE[r.tranche_effectif_salarie ?? ''] ?? '—',
      city: r.siege?.libelle_commune ?? r.siege?.commune ?? null,
      postalCode: r.siege?.code_postal ?? null,
    })),
  };
}
