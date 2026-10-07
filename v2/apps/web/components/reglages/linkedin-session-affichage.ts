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
import type { ProchainEnvoi, SessionLinkedIn } from '@jay-reach/core';
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
  // Une session `bloquee` porte toujours un motif : la contrainte `linkedin_server_sessions_motif_coherent`
  // (`status = 'bloquee'` <=> `blocked_reason is not null`) l'impose en base.
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
 * Ligne LinkedIn des deux blocs d'état du moteur. Toujours une ligne, même sans session : un
 * opérateur qui n'a jamais connecté LinkedIn doit y voir le canal et savoir qu'il reste à ouvrir.
 * Pas de « prochaine collecte » : la collecte est à la demande, il n'y en a pas de prochaine.
 */
export function ligneMoteurLinkedIn(
  session: SessionLinkedIn | null,
): { ton: PuceTon; cleLibelle: 'pret' | 'arrete' | 'aucune'; cleDetail: string } {
  const cle = cleDeLaSession(session);
  if (cle === 'prete') {
    return { ton: 'bon', cleLibelle: 'pret', cleDetail: session?.derniereCollecte ? 'derniereCollecte' : 'aucuneCollecte' };
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

export type CleEtatEnvoi = 'pret' | 'planifie' | 'enPause' | 'rienAEnvoyer' | 'horsCreneau' | 'canalBloque';

/**
 * État du canal d'ENVOI, sous la phrase de session (lot 4b).
 *
 * Elle ne devine rien : elle traduit le verdict de `prochainEnvoiLinkedIn`, c'est-à-dire la
 * fonction même qui décide quand le moteur enverra. Une première version ne connaissait que
 * la session et la pause, et affichait donc « Prêt à envoyer » la nuit, le week-end et une
 * fois le plafond du jour atteint — soit la majorité des heures de la semaine. Un écran qui
 * ment sur l'état du canal est pire qu'un écran muet : il fait chercher la panne ailleurs.
 *
 * Quand la session ne tient pas, on ne répète pas sa raison — elle est écrite juste au-dessus —
 * et on ne la nomme pas non plus : sur une sortie réseau inattendue, la session EST ouverte, et
 * « tant que la session n'est pas ouverte » contredirait la ligne du dessus.
 */
export function phraseEtatEnvoi(
  session: SessionLinkedIn | null,
  prochain: ProchainEnvoi,
  maintenant: Date,
): { ton: PuceTon; cle: CleEtatEnvoi } {
  if (phraseEtatSession(session).cle !== 'prete') return { ton: 'gris', cle: 'canalBloque' };
  if (prochain.quand !== null) {
    return prochain.quand.getTime() <= maintenant.getTime()
      ? { ton: 'bon', cle: 'pret' }
      : { ton: 'bon', cle: 'planifie' };
  }
  if (prochain.motif === 'canal_en_pause') return { ton: 'attention', cle: 'enPause' };
  if (prochain.motif === 'session_inactive') return { ton: 'gris', cle: 'canalBloque' };
  // `file_vide` et `action_en_cours` ne sont pas des empêchements : rien n'attend, ou un envoi
  // est en vol. Les deux se disent « rien à envoyer là, tout de suite » à l'opérateur.
  if (prochain.motif === 'file_vide' || prochain.motif === 'action_en_cours') {
    return { ton: 'bon', cle: 'rienAEnvoyer' };
  }
  // Le reste vient du rythme : hors fenêtre horaire, jour non coché, plafond du jour ou des
  // sept jours. Rien ne partira avant le prochain créneau, et aucune date n'est calculable ici.
  return { ton: 'attention', cle: 'horsCreneau' };
}
