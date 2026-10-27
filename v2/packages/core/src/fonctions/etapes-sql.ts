/**
 * Deux lectures partagées des étapes d'une séquence, en SQL, pour que chaque écran réponde pareil.
 *
 * Aucune importation : ce module est lu par `campagnes.ts`, `aujourdhui.ts`, `file-du-jour.ts` et
 * `sequence.ts`, et ne doit créer de cycle avec aucun.
 */

/** Les canaux qu'une étape de séquence peut porter (`channel_kind`, `20260817120000_init_schema.sql`). */
export const CANAUX_ETAPE_SEQUENCE = ['email', 'linkedin_invite', 'linkedin_message', 'letter', 'call'] as const;
export type CanalEtapeSequence = (typeof CANAUX_ETAPE_SEQUENCE)[number];

/**
 * Les canaux que l'onglet Séquence MONTRE (R19) : courrier et appel n'y figurent jamais. C'est aussi l'ensemble que
 * `sqlRangEtape` numérote : « étape 2 » dit la même chose dans la file du jour, le fil d'activité, le tiroir et
 * l'onglet Séquence. Une définition, deux lecteurs (`lireSequence` ET `sqlRangEtape`) : un seul des deux qui compterait
 * une étape courrier décalerait la file par rapport à l'onglet.
 */
export const CANAUX_ETAPE_AFFICHES = ['email', 'linkedin_invite', 'linkedin_message'] as const;

const SQL_CANAUX_AFFICHES = CANAUX_ETAPE_AFFICHES.map((c) => `'${c}'`).join(', ');

/** Garde de type : une valeur lue en base est-elle un canal connu ? */
export function estCanalEtapeSequence(brut: string): brut is CanalEtapeSequence {
  return CANAUX_ETAPE_SEQUENCE.some((canal) => canal === brut);
}

/**
 * Un canal lu en base : connu, ou `autre` quand la base rend une valeur que ce code ne connaît pas encore.
 * Il n'est atteignable que si une migration ajoute une valeur à `channel_kind` sans mettre à jour
 * `CANAUX_ETAPE_SEQUENCE` (un test compare les deux). Les écrans le disent « autre » : ni email, ni LinkedIn.
 */
export type CanalEtapeLu = CanalEtapeSequence | 'autre';

const canauxInconnusSignales = new Set<string>();

/**
 * Lit UN canal rendu par la base. Un canal inconnu DÉGRADE en `autre` : il ne se replie jamais sur « email »
 * (boîtes et « email tel qu'il partira » seraient faux) et il ne fait pas tomber le layout de campagne, l'accueil
 * ou le tiroir pour une étape qu'ils savent à peine nommer. La dérive laisse une trace console côté serveur,
 * une fois par valeur.
 */
export function lireCanalEtape(brut: string): CanalEtapeLu {
  if (estCanalEtapeSequence(brut)) return brut;
  if (!canauxInconnusSignales.has(brut)) {
    canauxInconnusSignales.add(brut);
    console.error(`[etapes] canal d'étape inconnu « ${brut} » : affiché « autre » (channel_kind a évolué sans CANAUX_ETAPE_SEQUENCE)`);
  }
  return 'autre';
}

/** Lit la liste rendue par `sqlCanauxEtapes`, avec la même règle pour un canal inconnu. */
export function lireCanauxEtapes(brut: readonly string[]): CanalEtapeLu[] {
  return brut.map(lireCanalEtape);
}

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
  // `null` aussi pour une étape que l'onglet Séquence ne montre pas (courrier, appel) : elle n'a pas de numéro à lui.
  // Les étapes comptées sont celles de l'onglet (`CANAUX_ETAPE_AFFICHES`), sinon une étape courrier avant un email
  // le numéroterait « 2 » ici et « 1 » dans l'onglet.
  return `(case when ${alias}.id is null or ${alias}.channel::text not in (${SQL_CANAUX_AFFICHES}) then null
            else (select count(*)::int from sequence_steps rang_etape where rang_etape.campaign_id = ${alias}.campaign_id and rang_etape.channel::text in (${SQL_CANAUX_AFFICHES}) and rang_etape.position < ${alias}.position)
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
