/**
 * Connecteur `jobboard` — normalisation des réponses France Travail et Adzuna
 * vers un signal `job_posting`. Paramètres d'API et champs issus de
 * `docs/legacy-assets/signaux-scrapers.md`. Fonctions PURES et testées.
 */

export interface JobSignal {
  readonly externalId: string;
  readonly source: 'francetravail' | 'adzuna';
  readonly kind: 'job_posting';
  readonly title: string;
  readonly company: string;
  readonly url?: string;
  readonly location?: string;
  readonly postalCode?: string;
  readonly naf?: string;
  readonly occurredAt: string;
}

// ---- France Travail -------------------------------------------------------
export interface FranceTravailRaw {
  id: string;
  intitule?: string;
  entreprise?: { nom?: string };
  lieuTravail?: { libelle?: string; codePostal?: string };
  dateCreation?: string;
  codeNAF?: string;
}

export function normalizeFranceTravail(raw: FranceTravailRaw): JobSignal {
  return {
    externalId: `ft:${raw.id}`,
    source: 'francetravail',
    kind: 'job_posting',
    title: raw.intitule ?? '',
    company: raw.entreprise?.nom ?? '',
    url: `https://candidat.francetravail.fr/offres/recherche/detail/${raw.id}`,
    location: raw.lieuTravail?.libelle,
    postalCode: raw.lieuTravail?.codePostal,
    naf: raw.codeNAF,
    occurredAt: raw.dateCreation ?? '',
  };
}

// ---- Adzuna ---------------------------------------------------------------
export interface AdzunaRaw {
  id: string;
  title?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  created?: string;
  redirect_url?: string;
}

export function normalizeAdzuna(raw: AdzunaRaw): JobSignal {
  return {
    externalId: `adzuna:${raw.id}`,
    source: 'adzuna',
    kind: 'job_posting',
    title: raw.title ?? '',
    company: raw.company?.display_name ?? '',
    url: raw.redirect_url,
    location: raw.location?.display_name,
    occurredAt: raw.created ?? '',
  };
}
