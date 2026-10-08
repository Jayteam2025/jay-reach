/**
 * Ce qu'une séquence LinkedIn ne pourra pas faire, dit AVANT le lancement plutôt que découvert
 * action par action dans le journal (lot 4b, tâche 7). Fonction pure, testable sans next-intl :
 * même convention que `linkedin-session-affichage.ts`.
 *
 * On ne rend que des clés et des positions, jamais une phrase construite — l'interface est
 * traduite en trois langues, et une phrase assemblée ici serait intraduisible.
 */

import type { EtapeVue } from '@jay-reach/core';

export type CleAvertissementSequence = 'messageSansInvitation' | 'noteDInvitation';

export interface AvertissementSequence {
  readonly cle: CleAvertissementSequence;
  /** Position de la première étape concernée : l'opérateur doit savoir laquelle ouvrir. */
  readonly position: number;
}

/**
 * Dérivé de `EtapeVue` plutôt que redéclaré : une forme recopiée à la main se serait
 * contentée d'un `canal: string` qui compile, et c'est exactement ce qui est arrivé — la
 * première version testait `canal === 'linkedin_message'` alors que `lireSequence` collapse
 * ce champ en « linkedin ». Les tests passaient sur une fixture que la base ne produit
 * jamais. Lié au type du cœur, un renommage casse la compilation au lieu de rendre cette
 * fonction muette en silence.
 */
export type EtapePourAvertissement = Pick<EtapeVue, 'position' | 'canalDetaille' | 'corps'>;

/**
 * Deux empêchements, tous deux silencieux sans cet écran.
 *
 * 1. Un message LinkedIn n'atteint qu'une relation de 1er degré. Sans invitation ACCEPTÉE
 *    avant lui, il ne part jamais — et rien dans la file ne le dit à l'avance.
 * 2. Une étape d'invitation dont le corps n'est pas vide porte une note (45 caractères,
 *    `linkedin_invite` dans les rôles de message). L'envoi côté serveur ne sait pas encore
 *    la transporter : le champ Voyager correspondant n'a jamais été relevé, et l'inventer
 *    enverrait un corps non éprouvé à de vraies personnes. L'invitation est donc refusée
 *    plutôt qu'envoyée amputée de sa note — ce dépôt ne livre jamais un message altéré.
 *
 * L'ordre de la liste est l'ordre de la séquence : l'opérateur corrige de haut en bas.
 */
export function avertissementsSequence(
  etapes: readonly EtapePourAvertissement[],
): readonly AvertissementSequence[] {
  const ordonnees = [...etapes].sort((a, b) => a.position - b.position);
  const avertissements: AvertissementSequence[] = [];

  const premierMessageOrphelin = ordonnees.find(
    (e, i) =>
      e.canalDetaille === 'linkedin_message' &&
      !ordonnees.slice(0, i).some((p) => p.canalDetaille === 'linkedin_invite'),
  );
  if (premierMessageOrphelin) {
    avertissements.push({ cle: 'messageSansInvitation', position: premierMessageOrphelin.position });
  }

  const premiereInvitationAvecNote = ordonnees.find(
    (e) => e.canalDetaille === 'linkedin_invite' && e.corps.trim() !== '',
  );
  if (premiereInvitationAvecNote) {
    avertissements.push({ cle: 'noteDInvitation', position: premiereInvitationAvecNote.position });
  }

  return avertissements;
}
