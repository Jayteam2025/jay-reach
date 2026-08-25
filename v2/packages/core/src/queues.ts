/**
 * Les douze files de fond (docs/01-architecture.md). Nom + clé i18n + politique
 * de reprise. Partagé par le worker (qui les crée) et l'écran d'admin (qui les liste).
 */

export interface QueueRetryPolicy {
  /** Nombre de reprises avant échec définitif. */
  readonly retryLimit: number;
  /** Reprise avec temporisation exponentielle. */
  readonly retryBackoff: boolean;
}

export interface QueueDef {
  readonly name: string;
  readonly descriptionKey: string;
  readonly retry: QueueRetryPolicy;
}

const DEFAULT_RETRY: QueueRetryPolicy = { retryLimit: 5, retryBackoff: true };

export const QUEUES: readonly QueueDef[] = [
  { name: 'sources.discover', descriptionKey: 'jobs.q.sourcesDiscover', retry: DEFAULT_RETRY },
  { name: 'signals.qualify', descriptionKey: 'jobs.q.signalsQualify', retry: DEFAULT_RETRY },
  { name: 'imports.process', descriptionKey: 'jobs.q.importsProcess', retry: DEFAULT_RETRY },
  { name: 'enrichment.company', descriptionKey: 'jobs.q.enrichmentCompany', retry: DEFAULT_RETRY },
  { name: 'enrichment.contacts', descriptionKey: 'jobs.q.enrichmentContacts', retry: DEFAULT_RETRY },
  { name: 'sequence.enroll', descriptionKey: 'jobs.q.sequenceEnroll', retry: DEFAULT_RETRY },
  { name: 'sequence.tick', descriptionKey: 'jobs.q.sequenceTick', retry: DEFAULT_RETRY },
  { name: 'actions.dispatch', descriptionKey: 'jobs.q.actionsDispatch', retry: DEFAULT_RETRY },
  { name: 'outcomes.poll', descriptionKey: 'jobs.q.outcomesPoll', retry: DEFAULT_RETRY },
  { name: 'inbox.sync', descriptionKey: 'jobs.q.inboxSync', retry: DEFAULT_RETRY },
  { name: 'crm.push', descriptionKey: 'jobs.q.crmPush', retry: DEFAULT_RETRY },
  { name: 'retention.purge', descriptionKey: 'jobs.q.retentionPurge', retry: DEFAULT_RETRY },
] as const;

export const QUEUE_NAMES = QUEUES.map((q) => q.name);
