/**
 * Deux lectures partagées des étapes d'une séquence, en SQL, pour que chaque écran réponde pareil.
 *
 * Aucune importation : ce module est lu par `campagnes.ts`, `aujourdhui.ts`, `file-du-jour.ts` et
 * `sequence.ts`, et ne doit créer de cycle avec aucun.
 */

/** Les canaux qu'une étape de séquence peut porter (`channel_kind`, `20260817120000_init_schema.sql`). */
export type CanalEtapeSequence = 'email' | 'linkedin_invite' | 'linkedin_message' | 'letter' | 'call';

/**
 * Le RANG (0-based) d'une étape dans sa campagne : combien d'étapes la précèdent.
 *
 * `sequence_steps.position` n'est PAS un rang. Elle est posée à l'insertion (max + 1), et
 * `supprimerEtape` ne renumérote pas les étapes restantes : une campagne dont la première étape a
 * été supprimée garde une seule étape à la position 1. Afficher `position + 1` la numérotait « 2 »
 * (mesuré le 27/10 sur « Recette LinkedIn lot 4b »). Le séquenceur lit déjà l'étape courante par
 * rang (`order by position offset current_step`, jamais une égalité) : l'écran doit compter de la
 * même façon.
 *
 * @param alias alias SQL d'une ligne de `sequence_steps` (`st`), éventuellement issue d'une jointure à gauche
 */
export function sqlRangEtape(alias: string): string {
  // `null` quand la ligne n'existe pas (jointure à gauche sur une étape supprimée) : sans le `case`, le
  // décompte d'une jointure vide vaudrait 0, soit « étape 1 » pour une action dont l'étape n'existe plus.
  return `(case when ${alias}.id is null then null
            else (select count(*)::int from sequence_steps rang_etape where rang_etape.campaign_id = ${alias}.campaign_id and rang_etape.position < ${alias}.position)
          end)`;
}

/**
 * Les canaux des étapes d'une campagne, dans l'ordre de la séquence (`text[]`, jamais `null`).
 * Chaque écran en tire ce qu'il a le droit de dire : des boîtes et du vocabulaire d'email
 * seulement s'il existe au moins une étape email.
 *
 * @param campagneIdExpr expression SQL qui désigne l'id de la campagne (`$1`, `c.id`)
 */
export function sqlCanauxEtapes(campagneIdExpr: string): string {
  return `coalesce((select array_agg(ss_canaux.channel::text order by ss_canaux.position) from sequence_steps ss_canaux where ss_canaux.campaign_id = ${campagneIdExpr}), '{}'::text[])`;
}
