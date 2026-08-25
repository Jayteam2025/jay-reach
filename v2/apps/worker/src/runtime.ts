import PgBoss from 'pg-boss';
import { QUEUES } from '@jay-reach/core';

/** Crée l'instance pg-boss (sans la démarrer). */
export function createRuntime(connectionString: string): PgBoss {
  const boss = new PgBoss({ connectionString });
  boss.on('error', (err) => console.error('[pg-boss]', err));
  return boss;
}

/** Déclare les douze files avec leur politique de reprise (backoff exponentiel). */
export async function registerQueues(boss: PgBoss): Promise<void> {
  for (const queue of QUEUES) {
    await boss.createQueue(queue.name, {
      name: queue.name,
      retryLimit: queue.retry.retryLimit,
      retryBackoff: queue.retry.retryBackoff,
    });
  }
}
