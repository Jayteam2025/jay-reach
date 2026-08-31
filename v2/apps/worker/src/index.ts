/**
 * Worker permanent : écoute les files pg-boss et fait tourner les producteurs.
 *
 * Les traitements eux-mêmes vivent dans `traitements.ts`, partagés avec les
 * routes planifiées de l'application. Ce fichier ne s'occupe que du mode
 * d'exécution : écouter en continu et déclencher les producteurs à intervalle.
 */
import { QUEUES } from '@jay-reach/core';
import { createRuntime, registerQueues } from './runtime.js';
import { createPool } from './db.js';
import {
  ecouterLesFiles,
  produire,
  produireTick,
  releverDemandes,
  DISCOVER_INTERVAL_MS,
  TICK_INTERVAL_MS,
  type Contexte,
} from './traitements.js';

// Relève des collectes demandées à la main. Court exprès : c'est le délai que
// ressent l'opérateur entre son clic et le départ de la collecte. La requête est
// un SELECT sur un index partiel, donc négligeable même à cette fréquence.
const REQUESTED_RUN_POLL_MS = Number(process.env.REQUESTED_RUN_POLL_MS ?? 10_000);

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL manquant — voir .env.example');
  }
  // Clé du coffre à secrets (hors base). Absente → repli sur les variables
  // d'environnement des providers (fonctionnement mono-org sans écran Fournisseurs).
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.warn('[worker] ENCRYPTION_KEY absente — coffre ignoré, repli sur les variables d’environnement.');
  }

  const boss = createRuntime(connectionString);
  const pool = createPool(connectionString);
  await boss.start();
  await registerQueues(boss);

  const ctx: Contexte = { boss, pool, encryptionKey };
  await ecouterLesFiles(ctx);
  console.log(`[worker] pg-boss démarré — ${QUEUES.length} files déclarées.`);

  await produire(ctx);
  const producer = setInterval(() => void produire(ctx), DISCOVER_INTERVAL_MS);
  producer.unref();

  await releverDemandes(ctx);
  const demandes = setInterval(() => void releverDemandes(ctx), REQUESTED_RUN_POLL_MS);
  demandes.unref();

  await produireTick(ctx);
  const ticker = setInterval(() => void produireTick(ctx), TICK_INTERVAL_MS);
  ticker.unref();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} reçu, arrêt propre…`);
    clearInterval(producer);
    clearInterval(demandes);
    clearInterval(ticker);
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] échec au démarrage', err);
  process.exit(1);
});
