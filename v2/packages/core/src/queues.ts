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
  /**
   * Politique de file de pg-boss. Absente : `standard`. `stately` n'admet, par clé
   * de singleton, qu'un job en attente et qu'un job actif.
   */
  readonly policy?: 'stately';
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
  // AUCUNE reprise, à la différence de sa voisine : ce traitement ACHÈTE. Le
  // crédit FullEnrich est consommé avant l'appel, et la réponse n'est conservée
  // nulle part ; un job rejoué après une coupure entre le décompte et l'écriture
  // rachèterait donc la même adresse, jusqu'à cinq fois. Le producteur redépose
  // le contact le lendemain sous un identifiant neuf : un échec transitoire
  // coûte un jour de retard, là où une reprise coûterait cinq achats.
  { name: 'enrichment.contact_connu', descriptionKey: 'jobs.q.enrichmentContactConnu', retry: { retryLimit: 0, retryBackoff: false } },
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
  // Envoi LinkedIn : JAMAIS de reprise, pour la même raison que l'achat ci-dessus mais
  // en pire : un envoi rejoué est une seconde invitation à la même personne, que rien
  // ne rattrape. `stately` + clé de singleton = organisation : au plus UN job en attente
  // et UN job actif par organisation. Le verrou du handler a pour propriétaire
  // `envoi-<organisation>` et se renouvelle pour son propre propriétaire : sans cette
  // politique, deux jobs de la même organisation le prendraient tous les deux, deux
  // navigateurs partageraient la session et l'intervalle de 1 à 20 minutes entre deux
  // envois serait contourné, soit la signature de machine qu'il existe pour éviter.
  { name: 'linkedin.envoi', descriptionKey: 'jobs.q.linkedinEnvoi', retry: { retryLimit: 0, retryBackoff: false }, policy: 'stately' },
] as const;

export const QUEUE_NAMES = QUEUES.map((q) => q.name);
