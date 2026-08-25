/** Données représentatives pour la revue visuelle (T16). Fictives. */
export interface SampleContact {
  readonly firstName: string;
  readonly lastName: string;
  readonly jobTitle: string;
  readonly hasLinkedin: boolean;
}
export interface SampleSeqStep {
  readonly channel: string;
  readonly when: string;
  readonly label: string;
  readonly state: 'done' | 'current' | 'planned';
}
export interface SampleCompany {
  readonly name: string;
  readonly siren: string;
  readonly naf: string;
  readonly city: string;
  readonly headcount: number;
  readonly contacts: readonly SampleContact[];
  readonly signals: ReadonlyArray<{ title: string; source: string; score: number; daysAgo: number }>;
  readonly sequence: readonly SampleSeqStep[];
}

export const SAMPLE_COMPANY: SampleCompany = {
  name: 'Société Témoin',
  siren: '843 291 774',
  naf: '46.90Z',
  city: 'Lyon (69)',
  headcount: 45,
  contacts: [
    { firstName: 'Alex', lastName: 'Martin', jobTitle: 'Directeur Commercial', hasLinkedin: true },
    { firstName: 'Camille', lastName: 'Roux', jobTitle: 'Responsable des ventes', hasLinkedin: false },
  ],
  signals: [{ title: 'Commercial itinérant H/F', source: 'FRANCE TRAVAIL', score: 82, daysAgo: 2 }],
  sequence: [
    { channel: 'EMAIL', when: 'J+0', label: 'Introduction', state: 'done' },
    { channel: 'LINKEDIN', when: 'J+1', label: 'Invitation', state: 'done' },
    { channel: 'EMAIL', when: 'J+3', label: 'Relance', state: 'current' },
    { channel: 'COURRIER', when: 'J+7', label: 'Lettre manuscrite', state: 'planned' },
  ],
};
