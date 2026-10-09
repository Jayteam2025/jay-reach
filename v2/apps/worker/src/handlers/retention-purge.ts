/**
 * Rétention des personnes collectées sur LinkedIn (lot 4a, tâche 11).
 *
 * Un engageur jamais contacté s'efface au bout de `RETENTION_PERSONNES_NON_CONTACTEES_JOURS`
 * jours : la MÊME constante que la mention de base légale de Réglages › LinkedIn
 * affiche, pour que la phrase et le comportement ne puissent pas diverger.
 *
 * Ce passage est le filet de sûreté de la péremption ordinaire
 * (`ecarterSignauxTropAnciens`, bien plus courte) : il borne la durée même quand
 * SIGNAL_MAX_AGE_DAYS est relevé, et attrape ce que ses épargnes (email acheté,
 * contact importé) laisseraient vivre.
 *
 * Idempotent PAR LES DONNÉES : la sélection relit la base à chaque passage, ce qui
 * est effacé n'existe plus. Aucun identifiant de job ne porte la garantie
 * (pg-boss archive un job terminé au bout de 12 h et libère son identifiant).
 *
 * Deux garde-fous distincts : la sélection exclut les personnes contactées, ET la
 * fonction qui détruit (`ecarterSignalDePersonne`) les refuse elle-même. Le second est
 * celui qui compte ; le premier évite de le solliciter pour rien.
 */
import type { Pool } from 'pg';
import { INTERVALLE_PURGE_MAX_MS, RETENTION_PERSONNES_NON_CONTACTEES_JOURS, sqlEstSignalDePersonne} from '@jay-reach/core';
import { enregistrerPurge, identiteDepuisEnvironnement, type IdentiteMoteur } from '../battement.js';
import { ecarterSignalDePersonne, sqlPersonneContactee, type FragmentSql } from './post-engagement.js';

/**
 * Cadence de la purge, depuis la variable d'environnement brute. Absente ou illisible, ou sous une
 * minute : le maximum (une heure). Au-dessus du maximum : le maximum, car l'alerte « en retard »
 * de l'écran Moteur s'en déduit (`INTERVALLE_PURGE_MAX_MS`) et une cadence plus lente la
 * rendrait permanente. Sans identifiant de job : la purge est idempotente par les données.
 */
export function cadencePurge(brut: string | undefined): number {
  const valeur = Number(brut ?? '');
  return Number.isFinite(valeur) && valeur >= 60_000 ? Math.min(valeur, INTERVALLE_PURGE_MAX_MS) : INTERVALLE_PURGE_MAX_MS;
}

/** Taille d'un passage. Le reste attend le suivant : mieux vaut lent qu'une transaction géante. */
const LOT = 1000;

export interface BilanPurge {
  readonly candidats: number;
  readonly effaces: number;
  /** Candidats que la fonction qui détruit a refusés : doit rester à zéro, la sélection les exclut déjà. */
  readonly conserves: number;
  /** Candidats déjà partis entre la sélection et l'effacement (un autre passage) : rien n'a été fait. */
  readonly absents: number;
  /** Empreintes de la mémoire d'écart (`linkedin_engageurs_ecartes`) arrivées au terme de la même durée. */
  readonly memoiresEffacees: number;
}

export async function purgerEngageursPerimes(
  pool: Pool,
  jours: number = RETENTION_PERSONNES_NON_CONTACTEES_JOURS,
): Promise<BilanPurge> {
  // Une durée absurde n'efface rien : garder trop longtemps est réversible.
  if (!Number.isFinite(jours) || jours <= 0) return { candidats: 0, effaces: 0, conserves: 0, absents: 0, memoiresEffacees: 0 };
  const candidats = await pool.query<{ id: string; organization_id: string; juge: boolean }>(
    `select s.id, s.organization_id, (s.score is not null) as juge
       from signals s
      where ${sqlEstSignalDePersonne('s')}
        and s.occurred_at < now() - make_interval(days => $1)
        -- Jamais contactée à cause de cet engageur (même définition que la garde de
        -- la fonction qui détruit).
        and not ${sqlPersonneContactee('s.organization_id' as FragmentSql, 's.id' as FragmentSql, 's.occurred_at' as FragmentSql)}
      order by s.occurred_at
      limit $2`,
    [jours, LOT],
  );
  let effaces = 0;
  let conserves = 0;
  let absents = 0;
  for (const p of candidats.rows) {
    // `juge` : une personne déjà scorée garde sa mémoire d'écart (sinon le collecteur
    // la recréerait et la rescorerait, donc la repaierait). `compter: false` : le
    // passage qui l'a collectée est clos depuis des semaines.
    const issue = await ecarterSignalDePersonne(pool, p.organization_id, p.id, { juge: p.juge, compter: false });
    if (issue === 'efface') effaces += 1;
    else if (issue === 'conserve') conserves += 1;
    else absents += 1;
  }
  // La mémoire d'écart a la MÊME borne : la phrase affichée aux personnes promet que
  // rien ne subsiste au-delà. Le coût d'une empreinte expirée est connu : la personne,
  // si elle réagit de nouveau à un post, est rescorée une fois.
  const memoire = await pool.query(
    `delete from linkedin_engageurs_ecartes where scored_at < now() - make_interval(days => $1)`,
    [jours],
  );
  return { candidats: candidats.rows.length, effaces, conserves, absents, memoiresEffacees: memoire.rowCount ?? 0 };
}

/**
 * Job `retention.purge` : purge, puis écrit son passage (réussi ou non) dans `engine_status`,
 * où l'écran Moteur le lit. Un échec est enregistré PUIS relancé : pg-boss rejoue le job.
 * L'écriture du statut ne doit jamais masquer ni provoquer l'échec de la purge.
 */
export async function traiterRetentionPurge(pool: Pool, identite: IdentiteMoteur = identiteDepuisEnvironnement()): Promise<BilanPurge> {
  let bilan: BilanPurge;
  try {
    bilan = await purgerEngageursPerimes(pool);
  } catch (err) {
    await enregistrerPurge(pool, identite, err instanceof Error ? err.name : 'Erreur').catch(() => {
      console.error('[retention-purge] statut illisible pour l’écran (retention_purge_status)');
    });
    throw err;
  }
  await enregistrerPurge(pool, identite, null).catch(() => {
    console.error('[retention-purge] statut illisible pour l’écran (retention_purge_status)');
  });
  if (bilan.candidats > 0 || bilan.memoiresEffacees > 0) {
    console.log(
      `[retention-purge] ${bilan.effaces} effacé(s), ${bilan.conserves} conservé(s), ${bilan.absents} absent(s) sur ${bilan.candidats} candidat(s), ${bilan.memoiresEffacees} empreinte(s) expirée(s)`,
    );
  }
  return bilan;
}
