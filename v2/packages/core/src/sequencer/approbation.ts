/**
 * « Cette action doit-elle attendre l'accord d'un humain ? »
 *
 * UNE règle, deux formes, et c'est la raison d'être de ce fichier. Le tick la pose en TypeScript
 * sur une ligne déjà en mémoire ; les trois chemins qui DÉBLOQUENT une action la reposent en SQL,
 * sur des lignes qu'ils mettent à jour en masse. Les deux doivent dire la même chose, sous peine
 * de laisser partir un message sans l'accord requis — et ce dépôt vient de payer exactement ça :
 * une clause posée à deux endroits sur trois a laissé une action approuvée sans aucun lecteur,
 * par un chemin que notre propre élargissement avait ouvert.
 *
 * Les deux formes ne peuvent pas être une seule fonction : l'une lit un objet, l'autre fabrique
 * du texte que Postgres évalue. Elles vivent donc côte à côte, dérivées des MÊMES constantes, et
 * le harnais `accroche-post.sh` les compare sur un jeu de politiques (contrôle 40) — c'est ce
 * garde-là qui tient la promesse, pas la proximité des lignes.
 */

/** Le canal dont le NOM seul impose l'accord : le courrier ne part jamais sans relecture (règle non négociable n°1). */
export const CANAL_TOUJOURS_APPROUVE = 'letter';

/** La valeur de `approval_policy.mode` qui exige l'accord sur TOUS les canaux. */
export const MODE_POLITIQUE_TOUT = 'all';

/**
 * Forme TypeScript : la politique d'une campagne exige-t-elle l'accord pour ce canal ?
 *
 * Lue par le tick (`apps/worker/src/handlers/sequence.ts`) sur la ligne de campagne déjà jointe.
 * Une politique absente, nulle ou d'une autre forme n'exige rien — le défaut sûr est celui qui ne
 * met pas en file ce que personne n'a demandé d'y mettre.
 */
export function policyRequiresApproval(policy: unknown, channel: string): boolean {
  if (!policy || typeof policy !== 'object') return false;
  const p = policy as { mode?: unknown; channels?: unknown };
  if (p.mode === MODE_POLITIQUE_TOUT) return true;
  // UN TABLEAU DE CHAÎNES, rien d'autre : c'est la forme stricte sur laquelle les deux écritures
  // s'alignent. L'opérateur `jsonb ?` du SQL acceptait en plus les CLÉS d'un objet
  // (`{"channels":{"email":true}}`) et un scalaire lu comme un tableau d'un élément
  // (`{"channels":"email"}`) — deux entrées sur lesquelles le SQL exigeait l'accord quand le
  // tick ne l'exigeait pas, donc deux entrées par lesquelles un message serait parti sans lui.
  if (Array.isArray(p.channels) && p.channels.some((c) => c === channel)) return true;
  return false;
}

/**
 * Ce que le TICK exige, hors du seuil des premiers envois : le miroir TypeScript EXACT de
 * `sqlApprobationExigee`, moins le drapeau — qui n'existe pas encore au moment du tick, puisque
 * c'est lui qui l'écrit.
 *
 * Le canal `letter` est ici, et pas seulement dans la forme SQL : c'est le seul canal dont la
 * règle du dépôt dit qu'il n'est « jamais négociable » (règle non négociable n°1), et le garder
 * d'un seul côté laissait le tick libre de cesser de l'exiger sans que rien ne rougisse.
 *
 * `lk_mode = 'manual'` reste chez l'appelant : il ne vit pas sur la campagne, et aucune des deux
 * formes de ce fichier ne le connaît. Écart assumé, inatteignable aujourd'hui (une contrainte en
 * base impose `mode = 'auto'`).
 */
export function approbationExigeeHorsRelecture(channel: string, policy: unknown): boolean {
  return channel === CANAL_TOUJOURS_APPROUVE || policyRequiresApproval(policy, channel);
}

/**
 * Forme SQL : l'expression booléenne qui dit, pour UNE action, si l'accord d'un humain est exigé.
 *
 * TROIS termes, et il en faut trois :
 *
 *  - le DRAPEAU du payload (`requiresApproval`), écrit par le tick au moment où il bloque une
 *    action sur un post non relu. C'est le seul terme qui couvre une campagne SANS politique dont
 *    l'accord vient du seuil des premiers envois (`relecturePremiersEnvoisRequise`) — ce seuil
 *    compte les envois déjà partis, donc il ne se rejoue pas dans une mise à jour en masse.
 *  - le CANAL `letter`, toujours.
 *  - la POLITIQUE COURANTE — lue sur la forme STRICTE, un tableau de chaînes : `jsonb ?` aurait
 *    accepté en plus les clés d'un objet et un scalaire, là où le tick les refuse, et l'écart
 *    allait dans le mauvais sens (le SQL exige, le tick non, donc c'est le tick qui laisse
 *    partir). Elle compte parce que le drapeau dit ce qui était exigé AU MOMENT DU BLOCAGE :
 *    une politique posée depuis doit s'appliquer, sinon l'action repart sans l'accord désormais
 *    requis.
 *
 * Les trois ne peuvent que DURCIR : aucun ne retire une approbation, ils l'ajoutent.
 *
 * @param action   alias SQL de la ligne `actions` (`a`)
 * @param campagne alias SQL de la ligne `campaigns` (`camp`)
 */
export function sqlApprobationExigee(action: string, campagne: string): string {
  return `(coalesce((${action}.payload ->> 'requiresApproval')::boolean, false)
             or ${action}.channel = '${CANAL_TOUJOURS_APPROUVE}'
             or ${campagne}.approval_policy ->> 'mode' = '${MODE_POLITIQUE_TOUT}'
             or (jsonb_typeof(${campagne}.approval_policy -> 'channels') = 'array'
                 and ${campagne}.approval_policy -> 'channels' @> to_jsonb(${action}.channel::text)))`;
}

/**
 * L'état où une action DÉBLOQUÉE retourne : la file d'attente humaine, ou la partance.
 *
 * Écrit une fois, lu par les trois chemins qui débloquent (`relacherLesRetenuesDuPost`,
 * `reprendreInscription`, `reprendreAbsencesEchues`). Les relâcher toutes en `scheduled` leur
 * ferait SAUTER la file : la branche du post passe avant celle de l'approbation dans
 * `composeTick`, donc une action qui devait attendre un humain part quand même en `blocked`.
 */
export function sqlEtatApresDeblocage(action: string, campagne: string): string {
  return `case when ${sqlApprobationExigee(action, campagne)}
               then 'pending_approval'::action_status else 'scheduled'::action_status end`;
}
