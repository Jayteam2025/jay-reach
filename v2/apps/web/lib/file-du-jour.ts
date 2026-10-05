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
 * « En file » d'une file du jour (G2) : remis au transporteur (`envoye`) mais
 * pas encore réellement parti (`livre` faux) — le bucket que la carte « File
 * du jour » de la vue d'ensemble d'une campagne ne comptait nulle part avant
 * ce correctif. `compterPartis` (`livre`) et `projeterEnvoisDuJour` (appelée
 * sur `!envoye`, `possibles`/`reportes`) se partageaient déjà tout ce qui
 * n'était PAS encore remis ou déjà parti — ce qui restait, remis mais en
 * attente de départ réel chez le transporteur, n'avait sa place dans aucun
 * des deux : une campagne entièrement remise mais pas encore partie (le cas
 * réel « Jay coach - RH », 47 remis, 0 parti) affichait donc « 0 parti · 0
 * encore possible · 0 reporté » au-dessus d'une liste de 47 messages.
 */
export function compterEnFile(fileDuJour: readonly Pick<EnvoiPrevu, 'envoye' | 'livre'>[]): number {
  return fileDuJour.filter((envoi) => envoi.envoye && !envoi.livre).length;
}

/**
 * Ne garde que les segments dont le compte est non nul (retour produit, G2) : la carte « File du
 * jour » d'une vue d'ensemble de campagne affichait ses quatre segments (partis/en file/possibles/
 * reportés) même à zéro — « 0 parti · 0 encore possible · 0 reporté » au-dessus d'une liste de 47
 * messages « en file ». Même principe que la jauge de la coquille (`CarteEnvois`), qui masque déjà
 * la mention « en file » quand elle est nulle : n'aligner que ce qui a une valeur, jamais des zéros.
 */
export function segmentsNonNuls<T extends { compte: number }>(segments: readonly T[]): T[] {
  return segments.filter((segment) => segment.compte > 0);
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
