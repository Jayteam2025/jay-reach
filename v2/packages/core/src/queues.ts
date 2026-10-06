/**
 * Les files de fond (docs/01-architecture.md). Nom + clé i18n + politique de
 * reprise. Partagé par le worker (qui les crée) et l'écran d'admin (qui les liste).
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
  { name: 'signals.score', descriptionKey: 'jobs.q.signalsScore', retry: DEFAULT_RETRY },
  { name: 'imports.process', descriptionKey: 'jobs.q.importsProcess', retry: DEFAULT_RETRY },
  { name: 'enrichment.company', descriptionKey: 'jobs.q.enrichmentCompany', retry: DEFAULT_RETRY },
  { name: 'enrichment.contacts', descriptionKey: 'jobs.q.enrichmentContacts', retry: DEFAULT_RETRY },
  // `contact_connu` et non `contact` : à un caractère de `enrichment.contacts`
  // ci-dessus, une faute de frappe ferait écouter la mauvaise file sans que rien
  // ne le signale. Les deux achètent des adresses, mais pas au même point du
  // chemin — celle-ci part d'une PERSONNE déjà identifiée (un engageur de post),
  // l'autre d'une entreprise où il faut encore trouver qui contacter.
  { name: 'enrichment.contact_connu', descriptionKey: 'jobs.q.enrichmentContactConnu', retry: DEFAULT_RETRY },
  { name: 'sequence.enroll', descriptionKey: 'jobs.q.sequenceEnroll', retry: DEFAULT_RETRY },
  { name: 'sequence.tick', descriptionKey: 'jobs.q.sequenceTick', retry: DEFAULT_RETRY },
  { name: 'actions.dispatch', descriptionKey: 'jobs.q.actionsDispatch', retry: DEFAULT_RETRY },
  { name: 'outcomes.poll', descriptionKey: 'jobs.q.outcomesPoll', retry: DEFAULT_RETRY },
  { name: 'inbox.sync', descriptionKey: 'jobs.q.inboxSync', retry: DEFAULT_RETRY },
  { name: 'inbox.sync_graph', descriptionKey: 'jobs.q.inboxSyncGraph', retry: DEFAULT_RETRY },
  { name: 'crm.push', descriptionKey: 'jobs.q.crmPush', retry: DEFAULT_RETRY },
  { name: 'retention.purge', descriptionKey: 'jobs.q.retentionPurge', retry: DEFAULT_RETRY },
  // Collecte LinkedIn : JAMAIS de reprise. Un passage qui a échoué a souvent
  // échoué parce que LinkedIn n'était pas content ; le rejouer automatiquement
  // ajoute du trafic suspect sur une session déjà fragile, et un passage arrêté
  // au plafond serait rejoué pour redépasser le même plafond. L'opérateur
  // relance à la main depuis l'écran Sources.
  { name: 'linkedin.collecte', descriptionKey: 'jobs.q.linkedinCollecte', retry: { retryLimit: 0, retryBackoff: false } },
] as const;

export const QUEUE_NAMES = QUEUES.map((q) => q.name);
