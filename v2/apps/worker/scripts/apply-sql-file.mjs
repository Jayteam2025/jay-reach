/**
 * Applique un fichier SQL sur la base pointée par DATABASE_URL.
 *
 * Sert à vérifier qu'une migration écrite à la main s'exécute réellement telle
 * qu'elle est livrée : recopier son contenu ailleurs pour l'appliquer laisse
 * toujours la possibilité que le fichier commité diffère de ce qui a été testé.
 *
 * Vit dans `apps/worker` parce que c'est le paquet qui dependant de `pg` :
 * la resolution ESM part de l'emplacement du script, pas du dossier courant.
 *
 * Usage : node --env-file=.env apps/worker/scripts/apply-sql-file.mjs <chemin>
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const chemin = process.argv[2];
if (!chemin) {
  console.error('Usage : node --env-file=.env apps/worker/scripts/apply-sql-file.mjs <fichier.sql>');
  process.exit(1);
}

const sql = readFileSync(chemin, 'utf8');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(sql);
  console.log(`[apply-sql-file] ${chemin} appliqué (${sql.length} caractères)`);
} catch (err) {
  console.error(`[apply-sql-file] échec : ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
