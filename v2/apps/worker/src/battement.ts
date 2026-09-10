import { writeFile } from 'node:fs/promises';
import { hostname as hostnameOs } from 'node:os';
import type { Pool } from 'pg';

export const CHEMIN_BATTEMENT_PAR_DEFAUT = '/tmp/jay-reach-battement';

/** Écrit l'heure courante dans le fichier de battement lu par le healthcheck Docker. */
export async function ecrireBattementFichier(chemin: string): Promise<void> {
  await writeFile(chemin, new Date().toISOString(), 'utf8');
}

export type IdentiteMoteur = {
  instanceId: string;
  hostname: string;
  version: string;
  startedAt: Date;
};

export function identiteDepuisEnvironnement(maintenant: Date = new Date()): IdentiteMoteur {
  const hote = process.env.HOSTNAME ?? hostnameOs();
  return {
    // Stable d'un déploiement à l'autre (contrairement au nom d'hôte, qui
    // change à chaque `--force-recreate` du conteneur) : sans ça,
    // `engine_status` accumule une ligne morte par recréation.
    instanceId: process.env.ENGINE_INSTANCE_ID ?? 'worker',
    hostname: hote,
    version: process.env.GIT_SHA ?? 'inconnu',
    startedAt: maintenant,
  };
}

const LONGUEUR_MAX_ERREUR = 500;

/**
 * Message prêt pour `last_error` : `null` si aucune erreur, sinon le message
 * borné à 500 caractères — un message Postgres peut citer l'hôte de la base,
 * et `last_error` est lisible par tout utilisateur authentifié.
 */
export function messageErreur(erreur: Error | null): string | null {
  if (erreur === null) return null;
  return erreur.message.slice(0, LONGUEUR_MAX_ERREUR);
}

/** Enregistre un tour reussi ou echoue. `erreur` vide le dernier echec quand elle vaut null. */
export async function enregistrerTour(
  pool: Pool,
  identite: IdentiteMoteur,
  tour: 'tick' | 'production',
  erreur: string | null,
): Promise<void> {
  const colonne = tour === 'tick' ? 'last_tick_at' : 'last_produce_at';
  await pool.query(
    `insert into public.engine_status (instance_id, hostname, version, started_at, ${colonne}, last_error, updated_at)
     values ($1, $2, $3, $4, now(), $5, now())
     on conflict (instance_id) do update
       set hostname = excluded.hostname,
           version = excluded.version,
           started_at = excluded.started_at,
           ${colonne} = now(),
           last_error = excluded.last_error,
           updated_at = now()`,
    [identite.instanceId, identite.hostname, identite.version, identite.startedAt, erreur],
  );
}
