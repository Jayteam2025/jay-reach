/**
 * Handler de la file `sources.discover` : exécute le connecteur de signaux
 * (code moteur repris du legacy) pour une source donnée. Première brique du
 * branchement du moteur sur le worker.
 */
import {
  adzunaScraper,
  franceTravailScraper,
  apifyScraper,
  type Scraper,
  type ScraperResult,
} from '@jay-reach/providers/signals';

const SCRAPERS: Record<string, Scraper> = {
  adzuna: adzunaScraper,
  francetravail: franceTravailScraper,
  apify: apifyScraper,
};

/**
 * Payload de la file — sans secret : les credentials sont résolus à l'exécution
 * par le worker (coffre + repli env), jamais transportés dans le job.
 */
export interface DiscoverJob {
  readonly organizationId: string;
  readonly sourceId: string;
  readonly provider: string;
  /**
   * Rattachement (thème, fournisseur) dont vient cette collecte. Absent des
   * jobs enfilés avant la bascule vers les thèmes : l'exécution est alors
   * tracée sur le thème seul, comme auparavant.
   */
  readonly sourceProviderId?: string;
  readonly keywords: string[];
  readonly location?: string;
  /**
   * Temps que la collecte a le droit de prendre. Posé par l'appelant qui
   * connaît son propre plafond — une fonction serverless en a un, un worker
   * permanent n'en a pas.
   */
  readonly budgetMs?: number;
  /**
   * `sources.config.ageMaxJours` de CETTE source, s'il est réglé (I3, revue
   * finale du 17/09). Absent → le persisteur des signaux (`insertSignals`)
   * retombe sur le défaut d'organisation `age_max_offres_jours`.
   */
  readonly ageMaxJours?: number;
}

export async function runDiscover(
  job: DiscoverJob,
  credentials: Record<string, string>,
): Promise<ScraperResult> {
  // Une source LinkedIn ne passe pas par ici : elle n'a pas de connecteur, elle
  // a un navigateur et sa propre file (`linkedin.collecte`). Le producteur
  // l'aiguille déjà ; ce message existe pour qu'un job mal routé se lise d'un
  // coup d'œil au lieu de ressembler à un fournisseur mal orthographié.
  if (job.provider.startsWith('linkedin')) {
    throw new Error(`Source LinkedIn routée vers sources.discover : elle relève de la file linkedin.collecte (${job.provider})`);
  }
  const scraper = SCRAPERS[job.provider];
  if (!scraper) {
    throw new Error(`Connecteur de signal inconnu : ${job.provider}`);
  }
  return scraper.fetch(job.keywords, {
    location: job.location,
    credentials,
    ...(job.budgetMs !== undefined ? { budgetMs: job.budgetMs } : {}),
  });
}
