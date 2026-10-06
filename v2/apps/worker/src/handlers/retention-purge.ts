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
 * fonction qui détruit (`ecarterEngageur`) les refuse elle-même. Le second est
 * celui qui compte ; le premier évite de le solliciter pour rien.
 */
import type { Pool } from 'pg';
import { RETENTION_PERSONNES_NON_CONTACTEES_JOURS } from '@jay-reach/core';
import { ecarterEngageur, sqlPersonneContactee } from './post-engagement.js';

/** Taille d'un passage. Le reste attend le suivant : mieux vaut lent qu'une transaction géante. */
const LOT = 1000;

export interface BilanPurge {
  readonly candidats: number;
  readonly effaces: number;
  /** Candidats que la fonction qui détruit a refusés : doit rester à zéro, la sélection les exclut déjà. */
  readonly conserves: number;
}

export async function purgerEngageursPerimes(
  pool: Pool,
  jours: number = RETENTION_PERSONNES_NON_CONTACTEES_JOURS,
): Promise<BilanPurge> {
  // Une durée absurde n'efface rien : garder trop longtemps est réversible.
  if (!Number.isFinite(jours) || jours <= 0) return { candidats: 0, effaces: 0, conserves: 0 };
  const candidats = await pool.query<{ id: string; organization_id: string; juge: boolean }>(
    `select s.id, s.organization_id, (s.score is not null) as juge
       from signals s
      where s.kind = 'post_engagement'
        and s.occurred_at < now() - make_interval(days => $1)
        -- Jamais contactée à cause de cet engageur (même définition que la garde de
        -- la fonction qui détruit).
        and not ${sqlPersonneContactee('s.organization_id', 's.id', 's.occurred_at')}
      order by s.occurred_at
      limit $2`,
    [jours, LOT],
  );
  let effaces = 0;
  let conserves = 0;
  for (const p of candidats.rows) {
    // `juge` : une personne déjà scorée garde sa mémoire d'écart (sinon le collecteur
    // la recréerait et la rescorerait, donc la repaierait). `compter: false` : le
    // passage qui l'a collectée est clos depuis des semaines.
    const issue = await ecarterEngageur(pool, p.organization_id, p.id, { juge: p.juge, compter: false });
    if (issue === 'efface') effaces += 1;
    else conserves += 1;
  }
  return { candidats: candidats.rows.length, effaces, conserves };
}

/** Job `retention.purge` : consigne le bilan, jamais d'identité de personne. */
export async function traiterRetentionPurge(pool: Pool): Promise<BilanPurge> {
  const bilan = await purgerEngageursPerimes(pool);
  if (bilan.candidats > 0) {
    console.log(`[retention-purge] ${bilan.effaces} effacé(s), ${bilan.conserves} conservé(s) sur ${bilan.candidats} candidat(s)`);
  }
  return bilan;
}
