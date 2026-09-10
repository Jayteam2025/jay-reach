import { writeFile } from 'node:fs/promises';

export const CHEMIN_BATTEMENT_PAR_DEFAUT = '/tmp/jay-reach-battement';

/** Écrit l'heure courante dans le fichier de battement lu par le healthcheck Docker. */
export async function ecrireBattementFichier(chemin: string): Promise<void> {
  await writeFile(chemin, new Date().toISOString(), 'utf8');
}
