/** Données représentatives des campagnes (mockup jay-reach-mockups.html). Fictives. */
export interface SampleCampaign {
  readonly name: string;
  readonly status: 'active' | 'paused' | 'draft';
  /** Vivier total de contacts. */
  readonly total: number;
  readonly contacted: number;
  readonly sent: number;
  readonly channels: number;
  /** Taux d'acceptation LinkedIn (%). */
  readonly acceptanceRate: number;
  readonly replies: number;
  /** Taux de réponse (%). */
  readonly replyRate: number;
  readonly positives: number;
  readonly source: string;
}

export const SAMPLE_CAMPAIGNS: readonly SampleCampaign[] = [
  {
    name: 'Recrutement terrain · DRH',
    status: 'active',
    total: 658,
    contacted: 197,
    sent: 197,
    channels: 3,
    acceptanceRate: 26.9,
    replies: 21,
    replyRate: 10.6,
    positives: 9,
    source: 'Offres d’emploi France Travail',
  },
  {
    name: 'Nominations · Directeurs commerciaux',
    status: 'active',
    total: 90,
    contacted: 36,
    sent: 36,
    channels: 2,
    acceptanceRate: 31.0,
    replies: 6,
    replyRate: 16.7,
    positives: 3,
    source: 'Nominations LinkedIn',
  },
  {
    name: 'Salons · Exposants FR',
    status: 'paused',
    total: 60,
    contacted: 23,
    sent: 60,
    channels: 2,
    acceptanceRate: 12.0,
    replies: 9,
    replyRate: 15.0,
    positives: 2,
    source: 'En pause depuis le 4 août · clé Apify expirée',
  },
];
