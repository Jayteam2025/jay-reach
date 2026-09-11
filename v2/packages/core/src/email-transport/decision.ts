/**
 * Décisions pures du transport email : quel mode d'envoi choisir pour une
 * étape de séquence, que faire d'une erreur HTTP SalesBlink, et quand une
 * relance en file est trop vieille pour partir en relance normale.
 */

export type ModeEnvoi =
  | { mode: 'premier' }
  | { mode: 'relance'; messageId: string }
  | { mode: 'relance_repli'; objet: string };

/**
 * Premier email si aucun envoi email antérieur sur cette inscription ;
 * relance sur le dernier Message-ID connu ; repli « Re: » si le dernier est
 * parti sans Message-ID connu (SalesBlink ne le rapporte pas toujours).
 */
export function deciderModeEnvoi(p: { envoisAnterieurs: { messageId: string | null; objet: string }[] }): ModeEnvoi {
  if (p.envoisAnterieurs.length === 0) return { mode: 'premier' };
  const dernier = p.envoisAnterieurs[p.envoisAnterieurs.length - 1]!;
  if (dernier.messageId !== null) return { mode: 'relance', messageId: dernier.messageId };
  return { mode: 'relance_repli', objet: `Re: ${dernier.objet}` };
}

/** Nombre d'essais transitoires tolérés avant d'abandonner (limite et serveur/réseau). */
const ESSAIS_MAX_TRANSITOIRE = 2;

/**
 * Quel est le sort d'une erreur HTTP : nouvel essai au tick suivant, ou échec
 * définitif. `limite` (429) réessaie toujours — SalesBlink porte le pacing,
 * pas nous. `client` (4xx hors 429) est définitif : rejouer une requête mal
 * formée ne la corrige pas. `serveur` et `reseau` sont transitoires mais pas
 * indéfiniment : au-delà de deux essais, mieux vaut échouer et laisser
 * l'opérateur constater plutôt que boucler en silence.
 */
export function sortDErreur(code: 'limite' | 'client' | 'serveur' | 'reseau', essais: number): 'reessayer' | 'echouer' {
  if (code === 'limite') return 'reessayer';
  if (code === 'client') return 'echouer';
  return essais < ESSAIS_MAX_TRANSITOIRE ? 'reessayer' : 'echouer';
}

const MS_PAR_HEURE = 60 * 60 * 1000;

/** Une relance en file depuis plus de `delaiMaxH` heures bascule sur le repli. */
export function relanceTropVieille(planifieMs: number, maintenantMs: number, delaiMaxH: number): boolean {
  return maintenantMs - planifieMs > delaiMaxH * MS_PAR_HEURE;
}
