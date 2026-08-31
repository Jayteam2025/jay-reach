/**
 * Fait tourner une fois la releve des ajouts en masse de l'annuaire, sans
 * demarrer le worker complet. Sert a la recette : le worker permanent fait la
 * meme chose a chaque tour.
 *
 * Usage : node --env-file=.env apps/worker/scripts/relever-annuaire.mjs
 */
import { Pool } from 'pg';
import { traiterImportsAnnuaire } from '../dist/annuaire-masse.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const n = await traiterImportsAnnuaire(pool);
  console.log('imports traites :', n);
} finally {
  await pool.end();
}
