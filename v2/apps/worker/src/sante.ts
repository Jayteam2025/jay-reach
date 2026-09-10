import { stat } from 'node:fs/promises';
import { CHEMIN_BATTEMENT_PAR_DEFAUT } from './battement.js';

const AGE_MAX_MS = 5 * 60_000;

const chemin = process.env.HEARTBEAT_FILE ?? CHEMIN_BATTEMENT_PAR_DEFAUT;
try {
  const { mtimeMs } = await stat(chemin);
  const age = Date.now() - mtimeMs;
  if (age > AGE_MAX_MS) {
    console.error(`[sante] battement trop ancien : ${Math.round(age / 1000)} s`);
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error('[sante] fichier de battement absent', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
