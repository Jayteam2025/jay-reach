/**
 * Comparaison d'instants lus par `pg` (tour de correction F4, lot 2).
 *
 * Une colonne `timestamptz`/`timestamp` lue via `ctx.ex.query` revient comme
 * un objet `Date` depuis le pilote `pg` — jamais une chaîne, malgré ce que
 * déclarent souvent les types des lignes brutes (`string | null`, hérités des
 * fixtures de test qui, elles, portent des chaînes ISO). Un tri qui appelle
 * `.localeCompare()` sur cette valeur explose dès qu'il y a au moins deux
 * lignes (`TypeError: ... .localeCompare is not a function`) : `.localeCompare`
 * n'existe que sur `String.prototype`, pas sur `Date.prototype`.
 *
 * Les deux fonctions ci-dessous acceptent indifféremment une chaîne ou un
 * `Date` (les deux formes réellement rencontrées) et comparent des instants
 * numériquement, jamais lexicographiquement.
 */

/** Un instant tel que peut le renvoyer une ligne `pg` : chaîne ISO, `Date`, ou absent. */
export type InstantPg = string | Date | null | undefined;

/**
 * Convertit un instant `pg` en epoch ms. `null` pour absent, ou pour une
 * valeur qui ne représente pas un instant valide (chaîne non parseable,
 * `Date` invalide) — jamais `NaN` qui propagerait silencieusement dans une
 * comparaison.
 */
export function versInstant(valeur: InstantPg): number | null {
  if (valeur == null) return null;
  const ms = valeur instanceof Date ? valeur.getTime() : new Date(valeur).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Compare deux instants du plus récent au plus ancien — même ordre que
 * `order by ... desc nulls last` en SQL, `null`/invalide toujours en
 * dernier. Ne départage pas deux instants égaux (ou deux absents) : c'est à
 * l'appelant d'ajouter son propre critère de départage déterministe
 * (typiquement un identifiant), comme la requête SQL départage par
 * `contact_id desc`.
 */
export function comparerInstantsDesc(a: InstantPg, b: InstantPg): number {
  const ta = versInstant(a);
  const tb = versInstant(b);
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return tb - ta;
}
