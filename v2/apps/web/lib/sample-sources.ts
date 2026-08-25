/** Sources de signaux + historique d'exécution (docs/09). Fictif. */

export type RunStatus = 'success' | 'error' | 'running';

export interface SourceRun {
  readonly status: RunStatus;
  readonly when: string;
  readonly itemsFound: number;
  readonly itemsNew: number;
  readonly error?: string;
}

export interface SampleSource {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly keywords: readonly string[];
  readonly location?: string;
  readonly active: boolean;
  readonly runs: readonly SourceRun[];
}

export const SAMPLE_SOURCES: readonly SampleSource[] = [
  {
    id: 'ft-commerciaux',
    name: 'France Travail — commerciaux',
    provider: 'francetravail',
    keywords: ['commercial', 'business developer'],
    location: 'Lyon (69)',
    active: true,
    runs: [
      { status: 'success', when: 'aujourd’hui 06:00', itemsFound: 34, itemsNew: 6 },
      { status: 'success', when: 'hier 06:00', itemsFound: 31, itemsNew: 9 },
      { status: 'success', when: 'avant-hier 06:00', itemsFound: 28, itemsNew: 4 },
    ],
  },
  {
    id: 'adzuna-commerciaux',
    name: 'Adzuna — commerciaux',
    provider: 'adzuna',
    keywords: ['commercial'],
    location: 'Lyon (69)',
    active: true,
    runs: [
      { status: 'success', when: 'aujourd’hui 06:05', itemsFound: 12, itemsNew: 2 },
      { status: 'error', when: 'hier 06:05', itemsFound: 0, itemsNew: 0, error: 'HTTP 429 — quota Adzuna atteint' },
    ],
  },
  {
    id: 'apify-linkedin',
    name: 'Apify — offres LinkedIn',
    provider: 'apify',
    keywords: ['commercial'],
    location: 'Lyon (69)',
    active: false,
    runs: [{ status: 'success', when: 'il y a 5 j', itemsFound: 25, itemsNew: 11 }],
  },
];
