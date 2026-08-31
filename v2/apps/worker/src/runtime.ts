import PgBoss from 'pg-boss';
import { QUEUES } from '@jay-reach/core';

export interface OptionsRuntime {
  /**
   * Mode sans surveillance, pour une exécution qui ne vit que le temps d'une
   * requête. pg-boss lance sinon des tâches d'entretien en arrière-plan —
   * archivage, surveillance d'état, planification — qui n'ont aucun sens dans
   * une fonction serverless : elles démarrent, consomment une connexion, puis
   * sont coupées net à la fin de l'invocation.
   *
   * L'entretien reste assuré par le worker permanent, ou par la route planifiée
   * qui l'appelle explicitement.
   */
  readonly ephemere?: boolean;
}

/** Crée l'instance pg-boss (sans la démarrer). */
export function createRuntime(connectionString: string, options: OptionsRuntime = {}): PgBoss {
  const boss = options.ephemere
    ? new PgBoss({ connectionString, supervise: false, schedule: false, max: 2 })
    : new PgBoss({ connectionString });
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
