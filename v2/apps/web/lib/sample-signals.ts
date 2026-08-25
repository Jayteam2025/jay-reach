/**
 * Données représentatives pour la revue visuelle de l'écran Signaux (T13).
 * PRÉSENTATIONNEL uniquement — entreprises fictives, aucune donnée réelle.
 * Remplacé par les vrais signaux dès que le pipeline (worker) est branché.
 */
export type SignalState = 'todo' | 'validated' | 'discarded' | 'arbitrate';

export interface SampleSignal {
  readonly id: string;
  readonly company: string;
  readonly siren?: string;
  readonly title: string;
  readonly location: string;
  readonly source: string;
  readonly score: number;
  readonly state: SignalState;
  readonly daysAgo: number;
  readonly discardReasonKey?: string;
  readonly url?: string;
}

export const SAMPLE_SIGNALS: readonly SampleSignal[] = [
  { id: 's1', company: 'Société Témoin', siren: '843 291 774', title: 'Commercial itinérant H/F', location: 'Lyon (69)', source: 'FRANCE TRAVAIL', score: 82, state: 'todo', daysAgo: 2 },
  { id: 's2', company: 'Entreprise Alpha', siren: '512 004 883', title: 'Business Developer', location: 'Paris (75)', source: 'ADZUNA', score: 74, state: 'todo', daysAgo: 1 },
  { id: 's3', company: 'Groupe Meridian', siren: '702 118 540', title: 'Directeur Commercial', location: 'Nantes (44)', source: 'FRANCE TRAVAIL', score: 91, state: 'todo', daysAgo: 3 },
  { id: 's4', company: 'Atelier Norbert', siren: '389 552 017', title: 'Responsable des ventes', location: 'Lille (59)', source: 'ADZUNA', score: 66, state: 'validated', daysAgo: 4 },
  { id: 's5', company: 'Cabinet Durand Conseil', title: 'Consultant en recrutement', location: 'Bordeaux (33)', source: 'FRANCE TRAVAIL', score: 12, state: 'discarded', daysAgo: 5, discardReasonKey: 'signals.reason.recruiter' },
  { id: 's6', company: 'Groupe Vantel', siren: '111 222 333', title: 'Ingénieur commercial', location: 'Toulouse (31)', source: 'ADZUNA', score: 58, state: 'discarded', daysAgo: 6, discardReasonKey: 'signals.reason.customer' },
  { id: 's7', company: 'Fabrique du Sud', title: 'Chargé de développement', location: 'Marseille (13)', source: 'FRANCE TRAVAIL', score: 61, state: 'arbitrate', daysAgo: 2 },
];
