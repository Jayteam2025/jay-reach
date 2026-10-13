/**
 * Point d'entrée du CLI LinkedIn : `jay-reach linkedin <connecter|statut|deconnecter|ip>`.
 *
 * Toute la mécanique vit dans `../linkedin/pilotage.ts`. Ce fichier ne garde que
 * `main()` et son garde « lancé directement », seul effet de bord au chargement :
 * aucun module importé par le worker ne doit l'inclure, sinon esbuild l'inline
 * dans `dist/index.js` et le garde devient vrai au démarrage du worker.
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db.js';
import {
  executerCommande,
  LIBELLES,
  organisationCourante,
  pilotageReel,
  type Dependances,
} from '../linkedin/pilotage.js';
import { demander, demanderMasque } from './saisie.js';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const etat: { pool: ReturnType<typeof createPool> | null } = { pool: null };
  const d: Dependances = {
    env: process.env,
    ecrire: (l) => console.log(l),
    contexte: async () => {
      if (!connectionString) throw new Error('DATABASE_URL manquant');
      const pool = (etat.pool ??= createPool(connectionString));
      const organisationId = await organisationCourante(pool, process.env);
      return { ex: pool, organisationId, utilisateurId: null, role: null };
    },
    ...pilotageReel,
    demander: (i) => demander(LIBELLES[i]),
    demanderMasque: (i) => demanderMasque(LIBELLES[i]),
  };
  const code = await executerCommande(process.argv.slice(2), d);
  await etat.pool?.end();
  process.exit(code);
}

// Lancé directement (pas importé par les tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
