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
      ...(queue.policy ? { policy: queue.policy } : {}),
    });
  }
}

/**
 * Vérifie que chaque file qui déclare une politique l'a RÉELLEMENT en base. `createQueue` est un
 * `ON CONFLICT DO NOTHING` : une file née sous une image antérieure (retour arrière, déploiement
 * d'un commit plus ancien) garde sa politique standard pour toujours, sans erreur ni trace, et la
 * propriété « au plus un job d'envoi en vol par organisation » disparaîtrait en silence : deux
 * navigateurs sur la même session LinkedIn. Le worker refuse alors de démarrer.
 *
 * Séparée de `registerQueues` : la route cron de Vercel l'appelle aussi, et une file de worker
 * mal déclarée ne doit pas arrêter tout le moteur qu'elle fait tourner.
 */
export async function verifierPolitiquesDeFiles(boss: PgBoss): Promise<void> {
  for (const queue of QUEUES) {
    if (!queue.policy) continue;
    const reelle = await boss.getQueue(queue.name);
    if (reelle?.policy === queue.policy) continue;
    throw new Error(
      `La file ${queue.name} doit avoir la politique « ${queue.policy} » et a « ${reelle?.policy ?? 'introuvable'} ». ` +
        `Sans elle, deux jobs de la même organisation peuvent tourner ensemble sur la même session LinkedIn. ` +
        `Arrêtez le worker, supprimez la file (boss.deleteQueue('${queue.name}') ou drop de ses jobs dans pgboss) ` +
        `puis redémarrez : elle sera recréée avec la bonne politique.`,
    );
  }
}
