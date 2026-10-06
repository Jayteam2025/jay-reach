/**
 * Logique d'affichage pure de la session LinkedIn du serveur (lot 4a) — séparée de la page et
 * du pied de barre latérale pour rester testable sans contexte next-intl, même convention que
 * `compte-linkedin-affichage.ts`.
 *
 * UNE phrase par session : ce qui empêche réellement de collecter (un motif de blocage)
 * l'emporte sur l'état enregistré. Un motif `sortie_inattendue` sur une session encore marquée
 * `active` ne doit jamais rendre « prête » : la sortie suspecte gagne. On rend une clé de
 * traduction et un ton, jamais une phrase construite.
 *
 * Le logo LinkedIn garde sa couleur de marque en toute circonstance : l'état se dit par le
 * libellé, rien ici ne porte de consigne de couleur pour la marque.
 */
import type { SessionLinkedIn } from '@jay-reach/core';
import type { PuceTon } from '../ui';

export type CleEtatSession = 'absente' | 'prete' | 'defi' | 'cookieRefuse' | 'disjoncteur' | 'revoquee' | 'sortieInattendue';

const CLE_PAR_MOTIF = {
  defi: 'defi',
  cookie_refuse: 'cookieRefuse',
  disjoncteur: 'disjoncteur',
  revoquee: 'revoquee',
  sortie_inattendue: 'sortieInattendue',
} as const satisfies Record<NonNullable<SessionLinkedIn['motif']>, CleEtatSession>;

function cleDeLaSession(session: SessionLinkedIn | null): CleEtatSession {
  if (!session) return 'absente';
  // Le motif d'abord : seul le motif dit pourquoi on ne collecte pas, quel que soit `etat`.
  if (session.motif) return CLE_PAR_MOTIF[session.motif];
  return session.etat === 'active' ? 'prete' : 'absente';
}

const TON_PAR_CLE: Record<CleEtatSession, PuceTon> = {
  absente: 'gris',
  prete: 'bon',
  defi: 'erreur',
  cookieRefuse: 'erreur',
  disjoncteur: 'erreur',
  // Révoquée par l'opérateur lui-même : un choix, pas une panne.
  revoquee: 'gris',
  sortieInattendue: 'erreur',
};

export function phraseEtatSession(session: SessionLinkedIn | null): {
  ton: PuceTon;
  cle: string;
  avecCommande: boolean;
} {
  const cle = cleDeLaSession(session);
  return {
    ton: TON_PAR_CLE[cle],
    cle,
    // Reconnecter ne corrige pas un proxy qui sort par la mauvaise adresse : proposer la
    // commande ferait croire que c'est la session qui est en cause. Rien à coller quand elle marche.
    avecCommande: cle !== 'prete' && cle !== 'sortieInattendue',
  };
}

/**
 * Ligne LinkedIn des deux blocs d'état du moteur. `null` quand la session n'a jamais existé :
 * une organisation qui n'utilise pas LinkedIn n'a pas à voir une ligne grise permanente.
 * Pas de « prochaine collecte » : la collecte est à la demande, il n'y en a pas de prochaine.
 */
export function ligneMoteurLinkedIn(
  session: SessionLinkedIn | null,
): { ton: PuceTon; cleLibelle: 'pret' | 'arrete' | 'aucune'; cleDetail: string } | null {
  if (!session) return null;
  const cle = cleDeLaSession(session);
  if (cle === 'prete') {
    return { ton: 'bon', cleLibelle: 'pret', cleDetail: session.derniereCollecte ? 'derniereCollecte' : 'aucuneCollecte' };
  }
  if (cle === 'absente') return { ton: 'gris', cleLibelle: 'aucune', cleDetail: 'absente' };
  return { ton: TON_PAR_CLE[cle], cleLibelle: 'arrete', cleDetail: cle };
}

/**
 * Gabarit du détail sous la phrase : une donnée absente change de gabarit plutôt que d'afficher
 * « Vue à null » ou « Dernière collecte : » à vide.
 */
export function varianteDetailSession(
  session: SessionLinkedIn | null,
): 'detail' | 'detailSansCollecte' | 'detailSansOrigine' | 'detailSansIp' {
  const cle = cleDeLaSession(session);
  if (cle === 'prete') return session?.derniereCollecte ? 'detail' : 'detailSansCollecte';
  if (cle === 'sortieInattendue') {
    if (!session?.ipVue) return 'detailSansIp';
    return session.operateur || session.pays ? 'detail' : 'detailSansOrigine';
  }
  return 'detail';
}
