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

export type CleEtatEnvoi =
  | 'pret'
  | 'planifie'
  | 'reprise'
  | 'enPause'
  | 'rienAEnvoyer'
  | 'enVol'
  | 'horsFenetre'
  | 'plafondAtteint'
  | 'plafondHoraire'
  | 'plafondHoraireDate'
  | 'canalBloque';

/**
 * État du canal d'ENVOI, sous la phrase de session (lot 4b).
 *
 * Elle ne devine rien : elle traduit le verdict de `prochainEnvoiLinkedIn`, c'est-à-dire la
 * fonction même qui décide quand le moteur enverra. Une première version ne connaissait que la
 * session et la pause, et affichait donc « Prêt à envoyer » la nuit, le week-end et une fois le
 * plafond du jour atteint — soit la majorité des heures de la semaine. Un écran qui ment sur
 * l'état du canal est pire qu'un écran muet : il fait chercher la panne ailleurs.
 *
 * Chaque motif a sa phrase, parce qu'ils n'appellent pas la même action : vérifier ses heures,
 * attendre un plafond, ou ne rien faire. Un libellé qui les regroupe envoie l'opérateur
 * corriger un réglage qui est déjà juste.
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
    // Une ligne restée en cours n'est pas un créneau d'envoi : elle va être close, pas rejouée.
    if (prochain.raison === 'reparation') return { ton: 'attention', cle: 'reprise' };
    return prochain.quand.getTime() <= maintenant.getTime()
      ? { ton: 'bon', cle: 'pret' }
      : { ton: 'bon', cle: 'planifie' };
  }
  switch (prochain.motif) {
    case 'canal_en_pause':
      return { ton: 'attention', cle: 'enPause' };
    case 'session_inactive':
      return { ton: 'gris', cle: 'canalBloque' };
    // En mode manuel il Y A des actions en attente, et elles ne partiront jamais : « aucune
    // action en attente », en vert, serait doublement faux. L'état est impossible en base
    // depuis la migration 20260831160000, mais la branche existe encore dans `jugerRythme` au
    // cas où la contrainte serait relâchée — par cohérence, elle existe aussi ici.
    case 'manual_mode':
      return { ton: 'gris', cle: 'canalBloque' };
    // Ni l'un ni l'autre n'est un empêchement : rien n'attend, ou un envoi est déjà parti.
    case 'file_vide':
    case 'queue_empty':
      return { ton: 'bon', cle: 'rienAEnvoyer' };
    case 'action_en_cours':
      return { ton: 'bon', cle: 'enVol' };
    // `outside_window` couvre AUSSI le jour non coché : le libellé doit nommer les deux, sinon
    // un samedi l'opérateur va vérifier des heures qui sont justes.
    case 'outside_window':
      return { ton: 'attention', cle: 'horsFenetre' };
    case 'daily_cap_reached':
    case 'weekly_cap_reached':
      return { ton: 'attention', cle: 'plafondAtteint' };
    // Distinct des plafonds de volume : celui-ci est le budget de requêtes de l'heure, que la
    // COLLECTE partage avec l'envoi. Rien n'est à corriger dans les réglages d'envoi, et le dire
    // autrement enverrait baisser un plafond qui n'y est pour rien. Deux clés sur le modèle
    // d'`absence`/`absenceNoDate` : la date n'existe que si le budget peut se libérer, ce qui est
    // faux quand le plafond est plus petit que le coût d'un seul envoi.
    case 'plafond_horaire_atteint':
      return { ton: 'attention', cle: prochain.disponibleA ? 'plafondHoraireDate' : 'plafondHoraire' };
    // Inatteignables par `prochainEnvoiLinkedIn` : `too_soon` y arrive toujours avec un délai,
    // donc avec une date, et `race_retry` n'appartient qu'à la réclamation. Nommés quand même,
    // parce qu'un motif rangé dans un fourre-tout silencieux est un motif qu'on ne verra pas
    // changer de sens.
    case 'too_soon':
    case 'race_retry':
      return { ton: 'bon', cle: 'rienAEnvoyer' };
    // Le `never` fait échouer la COMPILATION si un motif nouveau apparaît ; le `return` qui suit
    // garde l'écran debout à l'exécution, car un écran de réglages ne doit pas tomber parce que
    // le moteur a appris un refus de plus.
    default: {
      const _exhaustif: never = prochain;
      void _exhaustif;
      return { ton: 'bon', cle: 'rienAEnvoyer' };
    }
  }
}
