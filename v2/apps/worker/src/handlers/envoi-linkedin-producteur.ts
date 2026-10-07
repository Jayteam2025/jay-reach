/**
 * Producteur de la file `linkedin.envoi` : il DATE les jobs d'envoi au lieu de les semer.
 *
 * Un minuteur qui enfilerait un job à chaque tick ferait ouvrir le navigateur et payer un
 * écho d'IP au proxy à chaque minute, pour que la réclamation réponde ensuite « pas encore ».
 * Ici, chaque organisation est jugée en base (`prochainEnvoiLinkedIn`, mêmes règles que la
 * réclamation, aucun navigateur) et ne reçoit un job que lorsqu'un envoi est possible, daté du
 * moment où il le devient : l'intervalle irrégulier de 1 à 20 minutes entre deux envois
 * devient un `startAfter`.
 *
 * Au plus un job en attente par organisation : la clé de singleton est l'organisation, et la
 * file est en politique `stately` (voir `queues.ts`). Un second `send` pendant qu'un job attend
 * rend `null`, ce qui n'est pas une erreur. Ce producteur n'est donc pas à protéger contre
 * lui-même : le rappeler toutes les minutes ne crée jamais de doublon.
 */
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { prochainEnvoiLinkedIn, type Executeur, type ProchainEnvoi } from '@jay-reach/core';

export type JugerProchainEnvoi = (ex: Executeur, organisationId: string, maintenant: Date) => Promise<ProchainEnvoi>;

export async function enqueueEnvoiLinkedIn(
  boss: PgBoss,
  pool: Pool,
  maintenant: Date = new Date(),
  juger: JugerProchainEnvoi = prochainEnvoiLinkedIn,
): Promise<void> {
  // Seules les organisations dont la session est active : les autres ne peuvent rien envoyer.
  const res = await pool.query<{ organization_id: string }>(
    `select organization_id from linkedin_server_sessions where status = 'active'`,
  );
  for (const { organization_id: organisationId } of res.rows) {
    try {
      const prochain = await juger(pool, organisationId, maintenant);
      if (prochain.quand === null) continue;
      await boss.send(
        'linkedin.envoi',
        { organizationId: organisationId },
        { singletonKey: organisationId, startAfter: prochain.quand },
      );
    } catch (err) {
      // Une organisation en échec ne retient pas les autres. Seul le type sort : le message
      // d'une erreur de base ou de pg-boss peut porter une chaîne de connexion.
      console.error(`[envoi-linkedin] enfilage impossible (${err instanceof Error ? err.name : 'Erreur'})`);
    }
  }
}

export const CADENCE_ENVOI_DEFAUT_MS = 60_000;
const CADENCE_ENVOI_MIN_MS = 10_000;
/** Cinq minutes : au-delà, le job daté arriverait trop souvent après son créneau (l'intervalle minimal est d'une minute). */
export const CADENCE_ENVOI_MAX_MS = 300_000;

/**
 * Cadence de l'évaluation, depuis `LINKEDIN_ENVOI_POLL_MS` brute. `??` ne retombe que sur
 * `undefined` : une clé laissée vide (cas courant dans `worker.env`, rempli à la main) donne
 * `Number('') === 0` et `60s` donne `NaN`, deux valeurs que Node ramène à 1 ms, soit mille
 * passages par seconde sur la base. Absente, illisible ou sous le plancher : le défaut.
 */
export function cadenceEnvoiLinkedIn(brut: string | undefined): number {
  const valeur = Number(brut ?? '');
  if (!Number.isFinite(valeur) || valeur < CADENCE_ENVOI_MIN_MS) return CADENCE_ENVOI_DEFAUT_MS;
  return Math.min(valeur, CADENCE_ENVOI_MAX_MS);
}
