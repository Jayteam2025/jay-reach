/**
 * INSEE SIRENE — recherche d'entreprise via l'API publique data.gouv.fr
 * (https://recherche-entreprises.api.gouv.fr) — gratuite, pas de cle requise.
 *
 * Utilise en fallback quand FullEnrich ne retourne pas d'adresse postale.
 */

const SIRENE_BASE = "https://recherche-entreprises.api.gouv.fr/search";

// Codes INSEE tranche_effectif_salarie → libelle lisible
const EMPLOYEES_RANGE: Record<string, string> = {
  "00": "0 salarie",
  "01": "1 ou 2 salaries",
  "02": "3 a 5 salaries",
  "03": "6 a 9 salaries",
  "11": "10 a 19 salaries",
  "12": "20 a 49 salaries",
  "21": "50 a 99 salaries",
  "22": "100 a 199 salaries",
  "31": "200 a 249 salaries",
  "32": "250 a 499 salaries",
  "41": "500 a 999 salaries",
  "42": "1000 a 1999 salaries",
  "51": "2000 a 4999 salaries",
  "52": "5000 a 9999 salaries",
  "53": "10000 salaries ou plus",
};

export interface SireneCompany {
  siren: string | null;
  siret: string | null;
  name: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  naf_code: string | null;
  naf_label: string | null;
  employees_range: string | null;
}

interface SireneApiResponse {
  results?: Array<{
    siren?: string;
    nom_complet?: string;
    nom_raison_sociale?: string;
    activite_principale?: string;
    tranche_effectif_salarie?: string;
    siege?: {
      siret?: string;
      adresse?: string;
      code_postal?: string;
      libelle_commune?: string;
    };
  }>;
}

/**
 * Cherche une entreprise par nom sur l'API Recherche Entreprises.
 * Retourne le premier resultat (siege) ou null si aucun match.
 *
 * @param companyName Nom de l'entreprise (ex: "ASTURIENNE")
 * @returns SireneCompany ou null
 */
export async function findCompanyByName(companyName: string): Promise<SireneCompany | null> {
  const cleaned = companyName.trim();
  if (!cleaned) return null;

  const url = `${SIRENE_BASE}?q=${encodeURIComponent(cleaned)}&per_page=1&mtm_campaign=jay-prospection`;

  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) {
      console.warn(`[sirene] HTTP ${res.status} for "${cleaned}"`);
      return null;
    }
    const data = await res.json() as SireneApiResponse;
    const first = data.results?.[0];
    if (!first) {
      console.log(`[sirene] no result for "${cleaned}"`);
      return null;
    }

    const trancheCode = first.tranche_effectif_salarie;
    return {
      siren: first.siren || null,
      siret: first.siege?.siret || null,
      name: first.nom_complet || first.nom_raison_sociale || null,
      address: first.siege?.adresse || null,
      zip: first.siege?.code_postal || null,
      city: first.siege?.libelle_commune || null,
      naf_code: first.activite_principale || null,
      // L'API ne renvoie pas de libelle d'activite au niveau racine,
      // on laisse null et on garde le code NAF pour diagnostic
      naf_label: null,
      employees_range: (trancheCode && EMPLOYEES_RANGE[trancheCode]) || null,
    };
  } catch (err) {
    console.error(`[sirene] fetch error for "${cleaned}":`, err instanceof Error ? err.message : err);
    return null;
  }
}
