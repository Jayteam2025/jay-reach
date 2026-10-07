/**
 * Session LinkedIn du serveur, vue de l'interface (lot 4a).
 *
 * `lireSessionLinkedInCourante` : mémoïsé pour la durée d'un rendu RSC, même motif que
 * `lireAujourdhuiCourant` (`lib/aujourdhui.ts`) — la coquille et la page LinkedIn lisent la même
 * ligne. La lecture reste séparée de `lireResumeCoquille` : le menu doit rester sous six requêtes
 * (`test/pg-verify/coquille-coherence.sh`) et n'a besoin que d'une ligne, pas de toute la session.
 *
 * `composerLigneLinkedIn` : la ligne LinkedIn des deux blocs d'état du moteur (pied de barre
 * latérale et Réglages › Moteur). Une seule composition pour les deux, pour qu'ils ne puissent pas
 * dire deux choses. Pas de « prochaine collecte » : la collecte est à la demande.
 */
import { cache } from 'react';
import { lireSessionLinkedIn, type Contexte, type SessionLinkedIn } from '@jay-reach/core';
import { ligneMoteurLinkedIn } from '../components/reglages/linkedin-session-affichage';
import type { PuceTon } from '../components/ui';
import { dateRelativeCourte } from './dates';

export const lireSessionLinkedInCourante = cache((ctx: Contexte) => lireSessionLinkedIn(ctx));

/**
 * Lecture de la coquille : une ligne facultative du pied de barre ne doit JAMAIS emporter toute
 * l'application. La coquille entoure chaque page ; si la table n'existe pas encore (interface
 * déployée avant la migration `20261005130000`) ou si la lecture échoue, on rend `undefined` (état
 * inconnu : la ligne disparaît plutôt que de prétendre « aucune session », ce que `null` dit) et
 * le reste de la page se rend. Seul le type de l'erreur est consigné (le message d'une erreur de
 * base peut citer une requête). La page LinkedIn, elle, utilise la lecture qui échoue franchement.
 */
export const lireSessionLinkedInPourLaCoquille = cache(async (ctx: Contexte): Promise<SessionLinkedIn | null | undefined> => {
  try {
    return await lireSessionLinkedIn(ctx);
  } catch (err) {
    console.warn('[coquille] session LinkedIn illisible :', err instanceof Error ? err.name : typeof err);
    return undefined;
  }
});

export interface LigneLinkedin {
  ton: PuceTon;
  libelle: string;
  detail: string;
}

/** `t` porte la racine des messages (`getTranslations()`), comme `Coquille`. */
export function composerLigneLinkedIn(
  session: SessionLinkedIn | null,
  t: (cle: string, valeurs?: Record<string, string>) => string,
  maintenant: Date,
  fuseau: string,
): LigneLinkedin {
  const ligne = ligneMoteurLinkedIn(session);
  const quand = session?.derniereCollecte
    ? dateRelativeCourte(session.derniereCollecte.toISOString(), maintenant, fuseau)
    : '';
  return {
    ton: ligne.ton,
    libelle: t(`coquille.linkedin.libelle.${ligne.cleLibelle}`),
    detail: t(`coquille.linkedin.detail.${ligne.cleDetail}`, { quand }),
  };
}
