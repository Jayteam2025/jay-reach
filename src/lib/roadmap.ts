/**
 * Donnees statiques de la roadmap produit Jay Reach.
 *
 * Volontairement SANS dates ni echeances : la roadmap est organisee en trois
 * horizons « Now / Next / Later » (En cours / A venir / Plus tard). L'ordre des
 * items dans chaque colonne reflete la priorite. Pour faire evoluer la roadmap,
 * il suffit d'editer ce fichier — aucun backend n'est implique.
 */

export type RoadmapStage = 'now' | 'next' | 'later';

export interface RoadmapItem {
  /** Identifiant stable (utilise comme key React). */
  id: string;
  title: string;
  description: string;
  /** Etiquettes libres (domaine fonctionnel). */
  tags: string[];
}

export interface RoadmapColumn {
  stage: RoadmapStage;
  /** Libelle affiche en tete de colonne. */
  label: string;
  items: RoadmapItem[];
}

// Aucune donnee fictive : les colonnes sont vides par defaut. Pour alimenter la
// roadmap, ajouter des RoadmapItem dans `items` (chaque item : id, title,
// description, tags[]).
export const ROADMAP: RoadmapColumn[] = [
  {
    stage: 'now',
    label: 'En cours',
    items: [],
  },
  {
    stage: 'next',
    label: 'A venir',
    items: [],
  },
  {
    stage: 'later',
    label: 'Plus tard',
    items: [],
  },
];
