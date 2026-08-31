/**
 * Constantes partagées des sources de signaux.
 *
 * Ce module n'est PAS marqué `'use server'` : un module d'actions serveur ne
 * peut exporter que des fonctions asynchrones, et une constante qui y vivrait
 * arriverait côté client sous forme de référence serveur — `SOURCE_PROVIDERS.map`
 * échouait ainsi à l'exécution, sans que le typage n'y voie rien.
 */

/**
 * Providers de signaux proposés à la création. Volontairement limité aux
 * connecteurs réellement implémentés : proposer un provider sans connecteur
 * créerait une source qui ne collecte jamais, sans que rien ne l'explique.
 */
export const SOURCE_PROVIDERS = ['francetravail', 'adzuna', 'apify'] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

export interface SourceInput {
  readonly name: string;
  /** À quoi sert cette veille, en une phrase. Sert de rappel, pas de réglage. */
  readonly description: string;
  /**
   * Fournisseurs interrogés pour ce thème. Les mots-clés appartiennent au
   * thème et valent pour tous : c'est ce qui empêche deux fournisseurs censés
   * couvrir la même veille de dériver l'un de l'autre.
   */
  readonly providerIds: string[];
  readonly keywords: string[];
  readonly location: string;
  /** Consigne de qualification. Sans elle, le scoring laisse les signaux en attente. */
  readonly scoringPrompt: string;
  /** Score minimum pour qualifier un signal (0-100). */
  readonly matchThreshold: number;
  readonly isActive: boolean;
}
