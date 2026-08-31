/**
 * Traitements du moteur, indépendants du mode d'exécution.
 *
 * Le worker les branche sur des écouteurs pg-boss et tourne en permanence. Les
 * routes planifiées de l'application les appellent en lot, sans écouteur. Une
 * seule définition pour les deux : deux copies auraient fini par diverger, et
 * cette divergence-là se paie par des envois qui partent d'un côté et pas de
 * l'autre.
 *
 * Chaque fonction reçoit le contexte plutôt que de le capturer, ce qui la rend
 * appelable depuis n'importe où — y compris depuis une fonction serverless qui
 * ne vit que le temps d'une requête.
 */
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { QUEUES, resolveScoringModel } from '@jay-reach/core';
import { countRejected } from '@jay-reach/providers/outreach';
import { runDiscover, type DiscoverJob } from './handlers/discover.js';
import { runQualify, type QualifyJob } from './handlers/qualify.js';
import { runScore } from './handlers/score.js';
import { createAnthropicScorer } from './scorer-anthropic.js';
import { runDispatch, runLinkedInDispatch, isLinkedInChannel, type DispatchJob } from './handlers/dispatch.js';
import {
  runResolveCompany,
  toCompanyEnrichment,
  runFindContacts,
  type EnrichCompanyJob,
  type EnrichContactsJob,
} from './handlers/enrich.js';
import { enrollContact, tickDueEnrollments, type EnrollJob } from './handlers/sequence.js';
import {
  insertSignals,
  upsertResolvedAccount,
  attachSignalsToAccount,
  startSourceRun,
  finishSourceRun,
  closeStaleSourceRuns,
} from './db.js';
import {
  persistCompanyEnrichment,
  persistEnrichedContact,
  alignAccountDomainOnContacts,
} from './enrichment-persist.js';
import { resolveProviderCredentials } from './credentials.js';
import {
  enqueueDiscoverForActiveSources,
  enqueueScoringForOrgs,
  enqueueEnrichmentForQualified,
  enqueueRequestedRuns,
} from './producer.js';
import { traiterImportsAnnuaire } from './handlers/annuaire-masse.js';
import { purgeExpiredCache } from './provider-cache.js';
import { verifyDeliverability, PLAFOND_REOON_PAR_DEFAUT } from './email-verification.js';
import { refreshDomainPatterns, domainOf } from './domain-patterns.js';
import { deterministicUuid, currentBucket } from './ids.js';

export interface Contexte {
  readonly boss: PgBoss;
  readonly pool: Pool;
  /** Clé du coffre. Absente : repli sur les variables d'environnement. */
  readonly encryptionKey?: string | undefined;
  /**
   * Temps qu'une collecte a le droit de prendre. Absent en mode permanent, où
   * rien ne coupe le worker ; renseigné par la route planifiée, dont la
   * fonction est tuée au plafond d'exécution — et la collecte perdue avec.
   */
  readonly budgetCollecteMs?: number | undefined;
}

/** Files qui ont un traitement. Les autres sont déclarées mais inertes. */
export const FILES_BRANCHEES = [
  'sources.discover',
  'signals.qualify',
  'signals.score',
  'actions.dispatch',
  'enrichment.company',
  'enrichment.contacts',
  'sequence.enroll',
  'sequence.tick',
] as const;

const SMARTLEAD_PROVIDER = 'smartlead';
const FULLENRICH_PROVIDER = 'fullenrich';
const REOON_PROVIDER = 'reoon';
const ANTHROPIC_PROVIDER = 'anthropic';

/** Fréquence du producteur. Sert aussi de fenêtre de déduplication des jobs. */
export const DISCOVER_INTERVAL_MS = Number(process.env.DISCOVER_INTERVAL_MS ?? 15 * 60 * 1000);
/** Fréquence du tick de séquence. Même rôle de fenêtre. */
export const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 60 * 1000);

/**
 * URL publique de l'instance, telle qu'un provider doit la joindre.
 *
 * `APP_URL` d'abord, la variable documentée. À défaut, l'URL de production
 * Vercel — jamais `VERCEL_URL`, qui désigne le déploiement courant et change à
 * chaque envoi : un webhook branché avec elle cesserait de recevoir au
 * déploiement suivant, sans que rien ne le signale.
 */
function deduireUrlPublique(): string | undefined {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return production ? `https://${production}` : undefined;
}

// ---------------------------------------------------------------- collecte

export async function traiterDiscover(ctx: Contexte, data: DiscoverJob): Promise<void> {
  const { pool, boss, encryptionKey } = ctx;
  const credentials = await resolveProviderCredentials(pool, data.organizationId, data.provider, { encryptionKey });
  if (!credentials) {
    console.warn(`[discover] provider ${data.provider} non configuré pour l’org ${data.organizationId} — job ignoré`);
    return;
  }
  const runId = await startSourceRun(pool, data.sourceId, data.sourceProviderId);
  try {
    const result = await runDiscover(
      ctx.budgetCollecteMs !== undefined ? { ...data, budgetMs: ctx.budgetCollecteMs } : data,
      credentials,
    );
    const inserted = await insertSignals(pool, data.organizationId, data.sourceId, data.provider, result.signals);
    // Chaînage : chaque NOUVEAU signal (avec une entreprise) part en qualification.
    // Id déterministe par signal => un signal ne se qualifie qu'une fois.
    //
    // Tous en une insertion : un appel par signal coûtait un aller-retour
    // réseau chacun, et une collecte de plusieurs centaines d'offres dépassait
    // à elle seule le plafond d'exécution d'une fonction serverless.
    const aQualifier = inserted.flatMap((sig) =>
      sig.companyName
        ? [
            {
              name: 'signals.qualify',
              id: deterministicUuid('qualify', sig.signalId),
              data: {
                organizationId: sig.organizationId,
                companyName: sig.companyName,
                signalId: sig.signalId,
              } satisfies QualifyJob,
            },
          ]
        : [],
    );
    if (aQualifier.length > 0) {
      await boss.insert(aQualifier);
    }
    await finishSourceRun(pool, runId, { found: result.signals.length, added: inserted.length, status: 'success' });
    console.log(
      `[discover] ${result.signals.length} trouvés, ${inserted.length} nouveaux → qualif, ${result.errors.length} erreur(s) en ${result.duration_ms} ms`,
    );
  } catch (err) {
    await finishSourceRun(pool, runId, { found: 0, added: 0, status: 'error', error: String(err) });
    throw err; // laisse pg-boss appliquer le backoff/reprise
  }
}

// ----------------------------------------------------------- qualification

export async function traiterQualify(ctx: Contexte, data: QualifyJob): Promise<void> {
  const { pool } = ctx;
  const resolved = await runQualify(data);
  const accountId = await upsertResolvedAccount(pool, {
    organizationId: data.organizationId,
    name: data.companyName,
    siren: resolved?.siren ?? null,
    nafCode: resolved?.naf_code ?? null,
    trusted: resolved?.trusted ?? false,
    opposition: resolved?.opposition ?? false,
  });
  // Rattachement du signal au compte. C'est ce lien qui rend effectifs le
  // pré-filtre des cabinets par code NAF et le filtre d'opposition au
  // démarchage : le scoring les lit via `signals.account_id`. Sans lui, les
  // deux garde-fous existent dans le code mais ne s'appliquent jamais.
  //
  // On rattache aussi les autres signaux de la MÊME entreprise encore sans
  // compte : une entreprise qui publie dix offres n'a pas à être résolue dix
  // fois auprès de l'annuaire, et les signaux déjà collectés se rattrapent.
  if (accountId) {
    const lies = await attachSignalsToAccount(pool, data.organizationId, data.companyName, accountId);
    console.log(
      `[qualify] compte=${accountId} SIREN=${resolved?.siren ?? '—'} (${resolved?.name_match ?? 'n/a'})` +
        `${resolved?.opposition ? ' [opposition démarchage]' : ''} — ${lies} signal(aux) rattaché(s)`,
    );
  } else {
    console.warn(`[qualify] ${data.companyName} : aucun compte résolu, signal non rattaché`);
  }
}

// ------------------------------------------------------------------ scoring

export async function traiterScore(ctx: Contexte, data: { organizationId: string }): Promise<void> {
  const { pool, encryptionKey } = ctx;
  const credentials = await resolveProviderCredentials(pool, data.organizationId, ANTHROPIC_PROVIDER, { encryptionKey });
  const apiKey = credentials?.api_key;
  if (!apiKey) {
    console.warn(`[score] Anthropic non configuré pour l’org ${data.organizationId} — job ignoré`);
    return;
  }
  // Niveau `smart` (Sonnet par défaut), surchargeable par org via la config du
  // provider (`model_smart`) — jamais par variable d'env.
  console.log(`[score] org ${data.organizationId} : modèle ${resolveScoringModel('smart', credentials)}`);
  const summary = await runScore({ pool, organizationId: data.organizationId, scorer: createAnthropicScorer(apiKey, credentials) });
  if (summary.skippedNoPrompt) {
    console.log(`[score] org ${data.organizationId} : aucune source configurée avec prompt de scoring — ignoré`);
    return;
  }
  console.log(
    `[score] org ${data.organizationId} : ${summary.considered} examinés, ${summary.prefiltered} pré-filtrés, ` +
      `${summary.qualified} qualifiés, ${summary.discarded} écartés, ${summary.learned} appris`,
  );
}

// -------------------------------------------------------------------- envoi

export async function traiterDispatch(ctx: Contexte, data: DispatchJob): Promise<void> {
  const { pool, encryptionKey } = ctx;
  // Canal LinkedIn : aucune API d'envoi. On enfile l'action ; l'extension
  // Chrome l'exécute (Voyager, session utilisateur ; pacing côté serveur).
  if (isLinkedInChannel(data.channel)) {
    const id = await runLinkedInDispatch(pool, data);
    console.log(`[dispatch] LinkedIn ${data.channel} → ${id ? `enfilé ${id}` : 'déjà en file (dédup)'}`);
    return;
  }
  const credentials = await resolveProviderCredentials(pool, data.organizationId, SMARTLEAD_PROVIDER, { encryptionKey });
  const apiKey = credentials?.api_key;
  if (!apiKey) {
    console.warn(`[dispatch] Smartlead non configuré pour l’org ${data.organizationId} — job ignoré`);
    return;
  }
  const result = await runDispatch(data, apiKey, pool, process.env.APP_URL ?? deduireUrlPublique());
  // Le chiffre qui interesse l'operateur est le nombre de leads AJOUTES, que
  // Smartlead nomme `total_leads`. `upload_count` compte les lignes traitees,
  // deja-presents compris : l'annoncer comme un ajout gonflait le compte rendu.
  const ajoutes = result.total_leads ?? 0;
  const dejaLa = result.already_added_to_campaign ?? 0;
  const refuses = countRejected(result);
  console.log(
    `[dispatch] ${ajoutes} lead(s) ajouté(s) à la campagne Smartlead` +
      (dejaLa > 0 ? `, ${dejaLa} déjà présent(s)` : '') +
      (refuses > 0 ? `, ${refuses} refusé(s)` : ''),
  );
  if (refuses > 0) {
    console.warn(
      `[dispatch] refus — doublons ${result.duplicate_count ?? 0}, emails invalides ${result.invalid_email_count ?? 0}, ` +
        `désinscrits ${result.unsubscribed_leads?.length ?? 0}, bloqués ${result.block_count ?? 0}`,
    );
  }
  if (result.is_lead_limit_exhausted) {
    console.warn('[dispatch] plafond de leads Smartlead atteint — les prochains envois seront refusés');
  }
  // Le lead est chez Smartlead : l'action est partie. Sans ce marquage, elle
  // restait au statut d'émission et n'apparaissait dans aucune statistique.
  if (ajoutes > 0 && data.actionId) {
    await pool.query('select app.mark_action_dispatched($1)', [data.actionId]);
  }
}

// -------------------------------------------------------------- séquenceur

export async function traiterEnroll(ctx: Contexte, data: EnrollJob): Promise<void> {
  const { pool, boss } = ctx;
  const id = await enrollContact(pool, data);
  if (!id) {
    console.log(`[enroll] contact ${data.contactId} déjà inscrit — ignoré`);
    return;
  }
  await boss.insert([
    { name: 'sequence.tick', id: deterministicUuid('tick', id, currentBucket(TICK_INTERVAL_MS)), data: {} },
  ]);
  console.log(`[enroll] inscription ${id} créée`);
}

/**
 * Avance les inscriptions dues et enfile les envois autorisés vers
 * `actions.dispatch` (id déterministe par action → pas de doublon de job).
 */
export async function traiterTick(ctx: Contexte): Promise<number> {
  const { pool, boss } = ctx;
  const jobs = await tickDueEnrollments(pool);
  for (const job of jobs) {
    // Réf de dédup par contact/lead : LinkedIn via contactId/url, email via l'adresse.
    const ref = job.linkedin?.contactId ?? job.linkedin?.linkedinUrl ?? job.leads?.[0]?.email ?? 'x';
    await boss.insert([
      { name: 'actions.dispatch', id: deterministicUuid('dispatch', ref, job.channel ?? 'email'), data: job },
    ]);
  }
  if (jobs.length > 0) {
    console.log(`[tick] ${jobs.length} envoi(s) enfilé(s)`);
  }
  return jobs.length;
}

// ------------------------------------------------------------ enrichissement

export async function traiterEnrichCompany(
  ctx: Contexte,
  data: EnrichCompanyJob & { positionTitles?: string[]; seniorityLevels?: string[]; personaId?: string },
): Promise<void> {
  const { pool, boss, encryptionKey } = ctx;
  const credentials = await resolveProviderCredentials(pool, data.organizationId, FULLENRICH_PROVIDER, { encryptionKey });
  const apiKey = credentials?.api_key;
  if (!apiKey) {
    console.warn(`[enrich-company] FullEnrich non configuré pour l’org ${data.organizationId} — job ignoré`);
    return;
  }
  const resolved = await runResolveCompany(pool, apiKey, data);
  if (!resolved) {
    console.warn(`[enrich-company] entreprise non résolue : ${data.companyName}`);
    return;
  }
  await persistCompanyEnrichment(pool, data.organizationId, data.accountId, toCompanyEnrichment(resolved));
  console.log(`[enrich-company] ${data.companyName} → domaine=${resolved.domain ?? '—'} effectif=${resolved.headcount ?? '—'}`);
  if (data.positionTitles && data.positionTitles.length > 0) {
    const next: EnrichContactsJob = {
      organizationId: data.organizationId,
      accountId: data.accountId,
      companyName: data.companyName,
      ...(resolved.id ? { companyId: resolved.id } : {}),
      ...(resolved.domain ? { domain: resolved.domain } : {}),
      positionTitles: data.positionTitles,
      ...(data.seniorityLevels ? { seniorityLevels: data.seniorityLevels } : {}),
      ...(data.personaId ? { personaId: data.personaId } : {}),
    };
    await boss.insert([
      { name: 'enrichment.contacts', id: deterministicUuid('enrich-contacts', data.accountId, data.personaId ?? '*'), data: next },
    ]);
  }
}

export async function traiterEnrichContacts(ctx: Contexte, data: EnrichContactsJob): Promise<void> {
  const { pool, encryptionKey } = ctx;
  const credentials = await resolveProviderCredentials(pool, data.organizationId, FULLENRICH_PROVIDER, { encryptionKey });
  const apiKey = credentials?.api_key;
  if (!apiKey) {
    console.warn(`[enrich-contacts] FullEnrich non configuré pour l’org ${data.organizationId} — job ignoré`);
    return;
  }
  const contacts = await runFindContacts(apiKey, data);

  // Vérification de délivrabilité : sans elle, `email_status` ne vient que du
  // statut déclaré par FullEnrich, et le gate — qui n'accepte qu'un `valid`
  // explicite — bloque tout le reste. Absence de clé, plafond atteint ou panne
  // donnent `unknown`, jamais une exception.
  const reoon = await resolveProviderCredentials(pool, data.organizationId, REOON_PROVIDER, { encryptionKey });
  const reoonKey = reoon?.api_key ?? null;
  const capConfigure = Number(reoon?.daily_cap);
  const plafond = Number.isFinite(capConfigure) && capConfigure > 0 ? capConfigure : PLAFOND_REOON_PAR_DEFAUT;
  if (!reoonKey) {
    console.warn(`[enrich-contacts] Reoon non configuré pour l’org ${data.organizationId} — emails non vérifiés`);
  }

  let saved = 0;
  for (const c of contacts) {
    const verifie = c.email ? await verifyDeliverability(pool, data.organizationId, c.email, reoonKey, plafond) : null;
    const id = await persistEnrichedContact(pool, data.organizationId, data.accountId, c, verifie);
    if (id) {
      saved += 1;
    }
  }

  // De nouvelles adresses viennent d'arriver : le pattern de leur domaine a pu
  // changer de tier. Le domaine du provider n'est pas toujours celui des
  // courriels : on aligne le compte sur ce qui a été réellement observé avant
  // d'en déduire un pattern.
  const aligne = await alignAccountDomainOnContacts(pool, data.organizationId, data.accountId);
  if (aligne) {
    console.log(`[enrich-contacts] domaine du compte aligné sur les courriels : ${aligne}`);
  }
  const domaines = contacts.map((c) => domainOf(c.email));
  const patterns = await refreshDomainPatterns(pool, data.organizationId, domaines);
  if (patterns > 0) {
    console.log(`[enrich-contacts] ${patterns} pattern(s) de domaine recalculé(s)`);
  }
  console.log(`[enrich-contacts] ${data.companyName} → ${saved} contact(s) avec email persisté(s)`);
}

// ------------------------------------------------------------- production

/** Met en file le travail périodique : collectes, scoring, enrichissement, entretien. */
export async function produire(ctx: Contexte): Promise<void> {
  const { pool, boss } = ctx;
  try {
    const n = await enqueueDiscoverForActiveSources(boss, pool, { bucket: currentBucket(DISCOVER_INTERVAL_MS) });
    if (n > 0) {
      console.log(`[producer] ${n} source(s) active(s) mise(s) en file`);
    }
    const s = await enqueueScoringForOrgs(boss, pool, { bucket: currentBucket(DISCOVER_INTERVAL_MS) });
    if (s > 0) {
      console.log(`[producer] scoring enfilé pour ${s} organisation(s)`);
    }
    // Enrichissement des comptes qualifiés : le maillon entre le scoring et
    // FullEnrich. Sans lui, un signal qualifié n'a aucune suite.
    const e = await enqueueEnrichmentForQualified(boss, pool);
    if (e > 0) {
      console.log(`[producer] enrichissement enfilé pour ${e} couple(s) compte/persona`);
    }
    // Le cache provider n'a pas d'éviction propre : sans purge, la table grossit
    // indéfiniment de lignes que le moteur écarte déjà comme périmées.
    const purgees = await purgeExpiredCache(pool);
    if (purgees > 0) {
      console.log(`[producer] ${purgees} entrée(s) de cache périmée(s) purgée(s)`);
    }
    // Une exécution laissée `running` par un worker arrêté en plein travail ne se
    // referme jamais toute seule : l'écran Sources afficherait « en cours »
    // indéfiniment sur une collecte qui n'existe plus.
    const orphelines = await closeStaleSourceRuns(pool);
    if (orphelines > 0) {
      console.warn(`[producer] ${orphelines} collecte(s) interrompue(s) refermée(s)`);
    }
  } catch (err) {
    console.error('[producer] échec', err);
  }
}

/** Relève les collectes demandées à la main depuis l'écran Sources. */
export async function releverDemandes(ctx: Contexte): Promise<void> {
  try {
    const n = await enqueueRequestedRuns(ctx.boss, ctx.pool);
    if (n > 0) {
      console.log(`[producer] ${n} collecte(s) demandée(s) à la main enfilée(s)`);
    }
  } catch (err) {
    console.error('[producer] relève des demandes échouée', err);
  }

  // Ajouts en masse depuis l'annuaire. Traités ici plutôt que par une file :
  // ce sont des appels à une API publique, pas un travail à répartir, et
  // l'écran suit leur avancement en relisant la ligne.
  try {
    await traiterImportsAnnuaire(ctx.pool);
  } catch (err) {
    console.error('[annuaire] relève des ajouts en masse échouée', err);
  }
}

/** Enfile un tick périodique, dédupliqué par fenêtre. */
export async function produireTick(ctx: Contexte): Promise<void> {
  try {
    await ctx.boss.insert([
      { name: 'sequence.tick', id: deterministicUuid('tick-cron', currentBucket(TICK_INTERVAL_MS)), data: {} },
    ]);
  } catch (err) {
    console.error('[tick-producer] échec', err);
  }
}

// ------------------------------------------------- aiguillage d'un job

/** Exécute un job selon sa file. Partagé par l'écoute continue et la relève en lot. */
export async function traiterJob(ctx: Contexte, file: string, donnees: unknown): Promise<void> {
  switch (file) {
    case 'sources.discover':
      return traiterDiscover(ctx, donnees as DiscoverJob);
    case 'signals.qualify':
      return traiterQualify(ctx, donnees as QualifyJob);
    case 'signals.score':
      return traiterScore(ctx, donnees as { organizationId: string });
    case 'actions.dispatch':
      return traiterDispatch(ctx, donnees as DispatchJob);
    case 'sequence.enroll':
      return traiterEnroll(ctx, donnees as EnrollJob);
    case 'sequence.tick':
      await traiterTick(ctx);
      return;
    case 'enrichment.company':
      return traiterEnrichCompany(ctx, donnees as EnrichCompanyJob);
    case 'enrichment.contacts':
      return traiterEnrichContacts(ctx, donnees as EnrichContactsJob);
    default:
      // File déclarée mais sans traitement : on ne la laisse pas s'accumuler.
      return;
  }
}

/** Branche les écouteurs permanents. Mode worker uniquement. */
export async function ecouterLesFiles(ctx: Contexte): Promise<void> {
  for (const file of FILES_BRANCHEES) {
    // pg-boss remet un tableau : sous `noUncheckedIndexedAccess`, son premier
    // element est potentiellement absent, et un lot vide ne doit rien declencher.
    await ctx.boss.work(file, async ([job]) => {
      if (!job) return;
      await traiterJob(ctx, file, job.data);
    });
  }
  for (const queue of QUEUES) {
    if ((FILES_BRANCHEES as readonly string[]).includes(queue.name)) {
      continue;
    }
    await ctx.boss.work(queue.name, async () => {
      // File déclarée sans traitement — voir le backlog du ticket concerné.
    });
  }
}

export interface BilanConsommation {
  readonly traites: number;
  readonly echecs: number;
  readonly parFile: Record<string, number>;
}

/**
 * Relève et traite un lot de jobs, puis rend la main. C'est le mode des routes
 * planifiées : une fonction serverless ne peut pas écouter en continu.
 *
 * Le budget de temps est vérifié entre chaque job, jamais au milieu : une
 * fonction interrompue en plein traitement laisserait un job pris mais non
 * terminé, que pg-boss ne rendrait qu'après expiration.
 */
export async function consommerLesFiles(
  ctx: Contexte,
  options: { readonly parFile?: number; readonly budgetMs?: number } = {},
): Promise<BilanConsommation> {
  const parFile = options.parFile ?? 5;
  const budgetMs = options.budgetMs ?? 45_000;
  const debut = Date.now();
  const bilan: BilanConsommation = { traites: 0, echecs: 0, parFile: {} };
  let traites = 0;
  let echecs = 0;
  const compte: Record<string, number> = {};

  for (const file of FILES_BRANCHEES) {
    if (Date.now() - debut > budgetMs) {
      break;
    }
    const jobs = await ctx.boss.fetch(file, { batchSize: parFile });
    for (const job of jobs) {
      if (Date.now() - debut > budgetMs) {
        // Rendu explicite : le job repart en file plutôt que d'expirer.
        await ctx.boss.fail(file, job.id, { raison: 'budget de temps epuise' });
        continue;
      }
      try {
        await traiterJob(ctx, file, job.data);
        await ctx.boss.complete(file, job.id);
        traites += 1;
        compte[file] = (compte[file] ?? 0) + 1;
      } catch (err) {
        await ctx.boss.fail(file, job.id, { message: String(err) });
        echecs += 1;
        console.error(`[cron] ${file} : échec`, err);
      }
    }
  }
  return { ...bilan, traites, echecs, parFile: compte };
}
