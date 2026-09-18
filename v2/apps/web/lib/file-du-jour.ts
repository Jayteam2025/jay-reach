/**
 * « Déjà partis » d'une file du jour (F12) : le départ RÉEL (`livre`), jamais
 * la simple remise au transporteur (`envoye`) — un email remis à SalesBlink
 * mais pas encore envoyé n'est pas « déjà parti ». Extrait en fonction pure
 * (testable) après la revue qui a trouvé la carte File du jour de la vue
 * d'ensemble d'une campagne (`campaigns/[id]/page.tsx`) encore branchée sur
 * `envoye`, alors qu'`aujourdhui.ts` et `campagnes.ts::listerFileDuJour`
 * avaient déjà basculé sur `livre` — sans elle, cette carte comptait un
 * nombre de « partis » différent de celui de la page Aujourd'hui et de
 * l'onglet File du jour pour le même jour et la même campagne.
 */
import type { EnvoiPrevu, EtatEnvoi } from '@jay-reach/core';

export function compterPartis(fileDuJour: readonly Pick<EnvoiPrevu, 'livre'>[]): number {
  return fileDuJour.filter((envoi) => envoi.livre).length;
}

/**
 * État affiché d'un envoi (F13, décision du 18/09) : deux états réels, pas
 * trois. « Remis » (`dispatched`) et « Parti » (`delivered`) ne se lisent
 * JAMAIS sur le statut brut de la base pour ces deux-là — il ne dit rien du
 * canal. Un email `dispatched` n'est que remis : SalesBlink ne l'a pas encore
 * réellement envoyé (`livre` faux). Une action LinkedIn `dispatched`, elle,
 * EST son départ réel (`livre` vrai, F12 : pas de transporteur asynchrone
 * entre l'extension et le départ) — elle ne doit jamais rester « Remis » à
 * vie, ce canal n'atteint jamais le statut `delivered`. Réutilise les clés
 * `EtatEnvoi` existantes (`dispatched`/`delivered`) comme représentation
 * interne du mot affiché : seul le sens du libellé catalogue change, la table
 * `TON_ETAT` et les dictionnaires de libellés restent valables tels quels.
 * Les autres statuts (prévu, à relire, échoué, bloqué, annulé) ne dépendent
 * pas du canal et passent inchangés.
 */
export function etatAffichage(envoi: Pick<EnvoiPrevu, 'etatDetaille' | 'envoye' | 'livre'>): EtatEnvoi {
  const etat = envoi.etatDetaille ?? 'scheduled';
  if (etat !== 'dispatched' && etat !== 'delivered') return etat;
  return envoi.livre ? 'delivered' : 'dispatched';
}
