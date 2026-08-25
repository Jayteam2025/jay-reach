// Données de démonstration du tableau de bord (docs/09 : quatre chiffres, une
// courbe, un anneau, deux listes). Aucun montant de pipeline — c'est un calcul
// de CRM, jamais ici. La métrique propre à Jay Reach est le délai médian
// signal → premier contact : la seule qui mesure ce que le produit améliore.

export interface DashKpi {
  readonly replies: number;
  readonly positives: number;
  readonly qualified: number;
  /** Délai médian signal → premier contact, en jours. */
  readonly medianDays: number;
  /** Écarts vs période précédente (points de %, ou jours pour la médiane). */
  readonly delta: {
    readonly replies: number;
    readonly positives: number;
    readonly qualified: number;
    /** Négatif = plus rapide = mieux. */
    readonly medianDays: number;
  };
}

export interface DashPoint {
  readonly qualified: number;
  readonly replies: number;
}

export interface ChannelShare {
  readonly key: 'email' | 'linkedin' | 'courrier';
  readonly share: number; // 0..1
}

export interface DashSignalRow {
  readonly company: string;
  readonly title: string;
  readonly source: string;
  readonly score: number;
}

export interface DashReplyRow {
  readonly name: string;
  readonly company: string;
  readonly step: number;
}

export const DASH_KPI: DashKpi = {
  replies: 34,
  positives: 12,
  qualified: 168,
  medianDays: 3.4,
  delta: { replies: 18, positives: 25, qualified: 9, medianDays: -1.1 },
};

// 30 jours d'activité (le plus ancien en premier).
export const DASH_ACTIVITY: readonly DashPoint[] = [
  { qualified: 3, replies: 0 },
  { qualified: 5, replies: 1 },
  { qualified: 4, replies: 0 },
  { qualified: 6, replies: 1 },
  { qualified: 8, replies: 1 },
  { qualified: 7, replies: 2 },
  { qualified: 5, replies: 1 },
  { qualified: 9, replies: 2 },
  { qualified: 11, replies: 1 },
  { qualified: 8, replies: 3 },
  { qualified: 6, replies: 2 },
  { qualified: 10, replies: 1 },
  { qualified: 12, replies: 2 },
  { qualified: 9, replies: 3 },
  { qualified: 7, replies: 1 },
  { qualified: 5, replies: 2 },
  { qualified: 8, replies: 1 },
  { qualified: 11, replies: 3 },
  { qualified: 13, replies: 2 },
  { qualified: 10, replies: 4 },
  { qualified: 6, replies: 1 },
  { qualified: 4, replies: 2 },
  { qualified: 9, replies: 1 },
  { qualified: 12, replies: 3 },
  { qualified: 14, replies: 2 },
  { qualified: 11, replies: 4 },
  { qualified: 8, replies: 2 },
  { qualified: 6, replies: 1 },
  { qualified: 10, replies: 3 },
  { qualified: 13, replies: 5 },
];

export const DASH_CHANNELS: readonly ChannelShare[] = [
  { key: 'email', share: 0.62 },
  { key: 'linkedin', share: 0.31 },
  { key: 'courrier', share: 0.07 },
];

export const DASH_NO_CAMPAIGN: readonly DashSignalRow[] = [
  { company: 'Atelier Vernier', title: 'Responsable ADV H/F', source: 'FRANCE TRAVAIL', score: 88 },
  { company: 'Groupe Halden', title: 'Directeur commercial', source: 'ADZUNA', score: 84 },
  { company: 'Novaterre', title: 'Ingénieur avant-vente', source: 'FRANCE TRAVAIL', score: 81 },
  { company: 'Camille & Fils', title: 'Chargé de développement', source: 'ADZUNA', score: 76 },
];

export const DASH_REPLIES: readonly DashReplyRow[] = [
  { name: 'Camille Rousseau', company: 'Société Témoin', step: 3 },
  { name: 'Julien Ferrand', company: 'Atelier Vernier', step: 2 },
  { name: 'Sofia Meunier', company: 'Groupe Halden', step: 4 },
  { name: 'Marc Delaunay', company: 'Novaterre', step: 2 },
];

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
