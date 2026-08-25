/**
 * Pool `pg` partagé côté serveur Next (route handlers). Singleton porté par le
 * module (réutilisé entre invocations dans le même process runtime Node).
 * Accès service, filtrage explicite par organisation dans chaque requête.
 */
import { Pool } from 'pg';
import { requireEnv } from './env';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: requireEnv('DATABASE_URL'), max: 4 });
  }
  return pool;
}
