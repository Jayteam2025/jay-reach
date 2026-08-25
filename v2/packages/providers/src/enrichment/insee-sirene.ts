/**
 * INSEE SIRENE — recherche d'entreprise via l'API publique data.gouv.fr
 * (https://recherche-entreprises.api.gouv.fr) — gratuite, pas de cle requise.
 *
 * Deux usages :
 *   - fallback adresse postale quand FullEnrich ne la retourne pas ;
 *   - resolution du code d'activite (NAF / NACE) d'une entreprise a partir de
 *     son nom, pour le ciblage sectoriel (`signal_triggers.industry_filters`).
 *
 * Le nom est une cle de jointure approximative : l'API fait de la recherche
 * plein texte et renvoie toujours "quelque chose". D'ou `name_match`, qui dit
 * a quel point le resultat ressemble a ce qu'on a demande. Un filtre sectoriel
 * ne doit eliminer un signal que sur un match fiable.
 */

import { nafLabel } from "../naf.js";

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

/**
 * Fiabilite du rapprochement nom demande <-> nom trouve :
 *   exact  = memes noms apres normalisation
 *   strong = l'un contient l'autre (ex: "ASTURIENNE" vs "ASTURIENNE SAS")
 *   weak   = simple resultat de recherche plein texte, a ne pas croire
 */
export type SireneNameMatch = "exact" | "strong" | "weak";

export interface SireneCompany {
  siren: string | null;
  siret: string | null;
  name: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  /** Code APE en NAF rev. 2 (`62.01Z`) — codification en vigueur. */
  naf_code: string | null;
  naf_label: string | null;
  /**
   * Meme activite en NAF 2025 (= NACE rev. 2.1), fournie en double codification
   * par l'API. Reference pour l'attribution des codes APE au 01/01/2027.
   */
  naf_code_2025: string | null;
  employees_range: string | null;
  /** Nom tel que renvoye par l'API (permet de tracer un mauvais rapprochement). */
  matched_name: string | null;
  name_match: SireneNameMatch;
}

interface SireneApiResponse {
  results?: Array<{
    siren?: string;
    nom_complet?: string;
    nom_raison_sociale?: string;
    activite_principale?: string;
    activite_principale_naf25?: string;
    tranche_effectif_salarie?: string;
    siege?: {
      siret?: string;
      adresse?: string;
      code_postal?: string;
      libelle_commune?: string;
    };
  }>;
}

/** Normalisation dediee au rapprochement de noms : accents, formes juridiques, ponctuation. */
function normalizeForMatch(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(sas|sasu|sarl|eurl|sa|snc|scp|scs|sci|selarl|selas|sem|gie|association)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compare le nom demande au nom trouve. */
export function scoreNameMatch(requested: string, found: string | null | undefined): SireneNameMatch {
  const a = normalizeForMatch(requested);
  const b = normalizeForMatch(found ?? "");
  if (!a || !b) return "weak";
  if (a === b) return "exact";
  // Le confinement n'a de sens qu'au-dela de 4 caracteres : "abc" est contenu
  // dans trop de raisons sociales pour etre un signe de rapprochement.
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  if (shorter.length >= 4 && longer.includes(shorter)) return "strong";
  return "weak";
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
    const matchedName = first.nom_complet || first.nom_raison_sociale || null;
    const nafCode = first.activite_principale || null;
    return {
      siren: first.siren || null,
      siret: first.siege?.siret || null,
      name: matchedName,
      address: first.siege?.adresse || null,
      zip: first.siege?.code_postal || null,
      city: first.siege?.libelle_commune || null,
      naf_code: nafCode,
      // L'API ne renvoie que le code : le libelle vient du referentiel local
      // (supabase/functions/_shared/naf-codes.ts, genere depuis la NAF rev. 2).
      naf_label: nafLabel(nafCode),
      naf_code_2025: first.activite_principale_naf25 || null,
      employees_range: (trancheCode && EMPLOYEES_RANGE[trancheCode]) || null,
      matched_name: matchedName,
      name_match: scoreNameMatch(cleaned, matchedName),
    };
  } catch (err) {
    console.error(`[sirene] fetch error for "${cleaned}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * L'API publique plafonne a 7 appels/seconde, toutes origines confondues pour
 * une meme IP. On serialise les appels avec une marge : la resolution NAF d'un
 * run de scraping peut enchainer des centaines de noms.
 */
const SIRENE_MIN_INTERVAL_MS = 160;
let sireneChain: Promise<unknown> = Promise.resolve();
let sireneLastCallAt = 0;

function throttleSirene<T>(task: () => Promise<T>): Promise<T> {
  const run = sireneChain.then(async () => {
    const wait = SIRENE_MIN_INTERVAL_MS - (Date.now() - sireneLastCallAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    sireneLastCallAt = Date.now();
    return task();
  });
  // La chaine ne doit jamais rester rejetee, sinon tous les appels suivants echouent.
  sireneChain = run.catch(() => undefined);
  return run;
}

export interface CompanyNafResolution {
  siren: string | null;
  naf_code: string | null;
  naf_label: string | null;
  naf_code_2025: string | null;
  employees_range: string | null;
  matched_name: string | null;
  name_match: SireneNameMatch;
  /**
   * true si le rapprochement est assez fiable pour trancher dessus (nom
   * concordant ET code d'activite present). Sinon, l'appelant doit traiter
   * l'activite comme inconnue plutot que d'eliminer le signal.
   */
  trusted: boolean;
}

/**
 * Resout le code d'activite (NAF / NACE) d'une entreprise depuis son nom,
 * en respectant la limite de debit de l'API.
 */
export async function resolveCompanyNaf(companyName: string): Promise<CompanyNafResolution | null> {
  const company = await throttleSirene(() => findCompanyByName(companyName));
  if (!company) return null;

  return {
    siren: company.siren,
    naf_code: company.naf_code,
    naf_label: company.naf_label,
    naf_code_2025: company.naf_code_2025,
    employees_range: company.employees_range,
    matched_name: company.matched_name,
    name_match: company.name_match,
    trusted: company.name_match !== "weak" && !!company.naf_code,
  };
}
