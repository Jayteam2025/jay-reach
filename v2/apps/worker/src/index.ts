import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { QUEUES, resolveScoringModel } from '@jay-reach/core';
import { countRejected } from '@jay-reach/providers/outreach';
import { createRuntime, registerQueues } from './runtime.js';
import { runDiscover, type DiscoverJob } from './handlers/discover.js';
import { runQualify, type QualifyJob } from './handlers/qualify.js';
import { runScore } from './handlers/score.js';
import { createAnthropicScorer } from './scorer-anthropic.js';
import {
  runDispatch,
  runLinkedInDispatch,
  isLinkedInChannel,
  type DispatchJob,
} from './handlers/dispatch.js';
import {
  runResolveCompany,
  toCompanyEnrichment,
  runFindContacts,
  type EnrichCompanyJob,
  type EnrichContactsJob,
} from './handlers/enrich.js';
import { enrollContact, tickDueEnrollments, type EnrollJob } from './handlers/sequence.js';
import {
  createPool,
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
import { purgeExpiredCache } from './provider-cache.js';
import { verifyDeliverability, PLAFOND_REOON_PAR_DEFAUT } from './email-verification.js';
import { refreshDomainPatterns, domainOf } from './domain-patterns.js';
import { deterministicUuid, currentBucket } from './ids.js';

const WIRED = new Set([
  'sources.discover',
  'signals.qualify',
  'signals.score',
  'actions.dispatch',
  'enrichment.company',
  'enrichment.contacts',
  'sequence.enroll',
  'sequence.tick',
]);
const SMARTLEAD_PROVIDER = 'smartlead';
const FULLENRICH_PROVIDER = 'fullenrich';
const REOON_PROVIDER = 'reoon';
const ANTHROPIC_PROVIDER = 'anthropic';
// Fréquence du producteur (met les sources actives en file). Défaut : 15 min.
const DISCOVER_INTERVAL_MS = Number(process.env.DISCOVER_INTERVAL_MS ?? 15 * 60 * 1000);
// Relève des collectes demandées à la main. Court exprès : c'est le délai que
// ressent l'opérateur entre son clic et le départ de la collecte. La requête est
// un SELECT sur un index partiel, donc négligeable même à cette fréquence.
const REQUESTED_RUN_POLL_MS = Number(process.env.REQUESTED_RUN_POLL_MS ?? 10_000);
// Fréquence du tick de séquence (avance les inscriptions dues). Défaut : 1 min.
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 60 * 1000);

/**
 * Exécute un tick : avance les inscriptions dues et enfile les envois LinkedIn
 * autorisés vers `actions.dispatch` (id déterministe par action → pas de doublon
 * de job). Retourne le nombre de jobs d'envoi enfilés.
 */
async function runTick(pool: Pool, boss: PgBoss): Promise<number> {
  const jobs = await tickDueEnrollments(pool);
  for (const job of jobs) {
    // Réf de dédup par contact/lead : LinkedIn via contactId/url, email via l'adresse.
    const ref = job.linkedin?.contactId ?? job.linkedin?.linkedinUrl ?? job.leads?.[0]?.email ?? 'x';
    await boss.insert([
      { name: 'actions.dispatch', id: deterministicUuid('dispatch', ref, job.channel ?? 'email'), data: job },
    ]);
  }
  return jobs.length;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL manquant — voir .env.example');
  }
  // Clé du coffre à secrets (hors base). Absente → repli sur les variables
  // d'environnement des providers (fonctionnement mono-org sans écran Fournisseurs).
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.warn('[worker] ENCRYPTION_KEY absente — coffre ignoré, repli sur les variables d’environnement.');
  }

  const boss = createRuntime(connectionString);
  const pool = createPool(connectionString);
  await boss.start();
  await registerQueues(boss);

  // File `sources.discover` : branchée sur le connecteur de signaux réel
  // (code moteur repris du legacy). Les autres files reçoivent leur handler
  // au fil de leur ticket.
  await boss.work('sources.discover', async ([job]) => {
    const data = job.data as DiscoverJob;
    const credentials = await resolveProviderCredentials(pool, data.organizationId, data.provider, { encryptionKey });
    if (!credentials) {
      console.warn(`[discover] provider ${data.provider} non configuré pour l’org ${data.organizationId} — job ignoré`);
      return;
    }
    const runId = await startSourceRun(pool, data.sourceId);
    try {
      const result = await runDiscover(data, credentials);
      const inserted = await insertSignals(pool, data.organizationId, data.sourceId, data.provider, result.signals);
      // Chaînage : chaque NOUVEAU signal (avec une entreprise) part en qualification.
      // Id déterministe par signal => un signal ne se qualifie qu'une fois.
      for (const sig of inserted) {
        if (!sig.companyName) {
          continue;
        }
        const qualifyJob: QualifyJob = {
          organizationId: sig.organizationId,
          companyName: sig.companyName,
          signalId: sig.signalId,
        };
        await boss.insert([
          { name: 'signals.qualify', id: deterministicUuid('qualify', sig.signalId), data: qualifyJob },
        ]);
      }
      await finishSourceRun(pool, runId, { found: result.signals.length, added: inserted.length, status: 'success' });
      console.log(
        `[discover] ${result.signals.length} trouvés, ${inserted.length} nouveaux → qualif, ${result.errors.length} erreur(s) en ${result.duration_ms} ms`,
      );
    } catch (err) {
      await finishSourceRun(pool, runId, { found: 0, added: 0, status: 'error', error: String(err) });
      throw err; // laisse pg-boss appliquer le backoff/reprise
    }
  });

  await boss.work('signals.qualify', async ([job]) => {
    const data = job.data as QualifyJob;
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
  });

  // Scoring des signaux : pré-filtre cabinets (blacklist + NAF) + fraîcheur, puis
  // scoring LLM par persona, persistance et auto-apprentissage de la blacklist.
  // Le modèle passe par le provider `anthropic` (coffre + repli env). Sans clé,
  // le job est ignoré (aucun scoring, pas d'erreur).
  await boss.work('signals.score', async ([job]) => {
    const { organizationId } = job.data as { organizationId: string };
    const credentials = await resolveProviderCredentials(pool, organizationId, ANTHROPIC_PROVIDER, { encryptionKey });
    const apiKey = credentials?.api_key;
    if (!apiKey) {
      console.warn(`[score] Anthropic non configuré pour l’org ${organizationId} — job ignoré`);
      return;
    }
    // Niveau `smart` (Sonnet par défaut), surchargeable par org via la config du
    // provider (`model_smart`) — jamais par variable d'env.
    console.log(`[score] org ${organizationId} : modèle ${resolveScoringModel('smart', credentials)}`);
    const summary = await runScore({ pool, organizationId, scorer: createAnthropicScorer(apiKey, credentials) });
    if (summary.skippedNoPrompt) {
      console.log(`[score] org ${organizationId} : aucune source configurée avec prompt de scoring — ignoré`);
      return;
    }
    console.log(
      `[score] org ${organizationId} : ${summary.considered} examinés, ${summary.prefiltered} pré-filtrés, ` +
        `${summary.qualified} qualifiés, ${summary.discarded} écartés, ${summary.learned} appris`,
    );
  });

  await boss.work('actions.dispatch', async ([job]) => {
    const data = job.data as DispatchJob;
    // Canal LinkedIn : aucune API d'envoi. On enfile l'action ; l'extension
    // Chrome l'exécute (Voyager, session utilisateur ; pacing côté serveur).
    if (isLinkedInChannel(data.channel)) {
      const id = await runLinkedInDispatch(pool, data);
      console.log(`[dispatch] LinkedIn ${data.channel} → ${id ? `enfilé ${id}` : 'déjà en file (dédup)'}`);
      return;
    }
    // Canal email (défaut) : Smartlead.
    const credentials = await resolveProviderCredentials(pool, data.organizationId, SMARTLEAD_PROVIDER, { encryptionKey });
    const apiKey = credentials?.api_key;
    if (!apiKey) {
      console.warn(`[dispatch] Smartlead non configuré pour l’org ${data.organizationId} — job ignoré`);
      return;
    }
    const result = await runDispatch(data, apiKey);
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
      // Le detail vaut d'etre visible : un lead refuse parce qu'il est desinscrit
      // n'appelle pas la meme reaction qu'une adresse mal formee.
      console.warn(
        `[dispatch] refus — doublons ${result.duplicate_count ?? 0}, emails invalides ${result.invalid_email_count ?? 0}, ` +
          `désinscrits ${result.unsubscribed_leads?.length ?? 0}, bloqués ${result.block_count ?? 0}`,
      );
    }
    if (result.is_lead_limit_exhausted) {
      console.warn('[dispatch] plafond de leads Smartlead atteint — les prochains envois seront refusés');
    }
  });

  // Inscription d'un contact dans une campagne (dédup : une inscription active
  // par contact). Enfile un tick immédiat pour traiter la 1re étape.
  await boss.work('sequence.enroll', async ([job]) => {
    const data = job.data as EnrollJob;
    const id = await enrollContact(pool, data);
    if (!id) {
      console.log(`[enroll] contact ${data.contactId} déjà inscrit — ignoré`);
      return;
    }
    await boss.insert([{ name: 'sequence.tick', id: deterministicUuid('tick', id, currentBucket(TICK_INTERVAL_MS)), data: {} }]);
    console.log(`[enroll] inscription ${id} créée`);
  });

  // Tick de séquence : avance les inscriptions dues, émet les actions et enfile
  // les envois LinkedIn autorisés vers `actions.dispatch`.
  await boss.work('sequence.tick', async () => {
    const dispatchJobs = await runTick(pool, boss);
    if (dispatchJobs > 0) {
      console.log(`[tick] ${dispatchJobs} envoi(s) LinkedIn enfilé(s)`);
    }
  });

  // Enrichissement entreprise : résout l'identité canonique FullEnrich (domaine,
  // effectif) et l'écrit sur le compte. Chaîne vers la recherche de contacts si
  // des titres de poste sont fournis (persona).
  await boss.work('enrichment.company', async ([job]) => {
    const data = job.data as EnrichCompanyJob & { positionTitles?: string[]; seniorityLevels?: string[]; personaId?: string };
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
  });

  // Enrichissement contacts : recherche les personnes d'un persona dans
  // l'entreprise, obtient leur email vérifié, et persiste les contacts.
  await boss.work('enrichment.contacts', async ([job]) => {
    const data = job.data as EnrichContactsJob;
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
      const verifie = c.email
        ? await verifyDeliverability(pool, data.organizationId, c.email, reoonKey, plafond)
        : null;
      const id = await persistEnrichedContact(pool, data.organizationId, data.accountId, c, verifie);
      if (id) {
        saved += 1;
      }
    }

    // De nouvelles adresses viennent d'arriver : le pattern de leur domaine a pu
    // changer de tier. Sans ce recalcul, le gate n'a rien à lire et bloque tout
    // email qui n'est pas explicitement délivrable.
    // Le domaine du provider n'est pas toujours celui des courriels : on aligne
    // le compte sur ce qui a été réellement observé avant d'en déduire un pattern.
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
  });

  for (const queue of QUEUES) {
    if (WIRED.has(queue.name)) {
      continue;
    }
    await boss.work(queue.name, async () => {
      // TODO(ticket dédié) : traitement de la file `queue.name`.
    });
  }

  console.log(`[worker] pg-boss démarré — ${QUEUES.length} files déclarées.`);

  // Producteur : met les sources actives en file (au démarrage puis périodiquement).
  // Sans lui, aucune découverte ne démarre. Dédup par fenêtre temporelle.
  const produce = async (): Promise<void> => {
    try {
      const n = await enqueueDiscoverForActiveSources(boss, pool, { bucket: currentBucket(DISCOVER_INTERVAL_MS) });
      if (n > 0) {
        console.log(`[producer] ${n} source(s) active(s) mise(s) en file`);
      }
      // Enfile le scoring des organisations ayant des signaux non scorés.
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
      // Le cache provider n'a pas d'éviction propre : sans purge, la table
      // grossit indéfiniment de lignes que le moteur écarte déjà comme périmées.
      const purgees = await purgeExpiredCache(pool);
      if (purgees > 0) {
        console.log(`[producer] ${purgees} entrée(s) de cache périmée(s) purgée(s)`);
      }
      // Une exécution laissée `running` par un worker arrêté en plein travail ne
      // se referme jamais toute seule : l'écran Sources afficherait « en cours »
      // indéfiniment sur une collecte qui n'existe plus.
      const orphelines = await closeStaleSourceRuns(pool);
      if (orphelines > 0) {
        console.warn(`[producer] ${orphelines} collecte(s) interrompue(s) refermée(s)`);
      }
    } catch (err) {
      console.error('[producer] échec', err);
    }
  };
  await produce();
  const producer = setInterval(() => void produce(), DISCOVER_INTERVAL_MS);
  producer.unref();

  // Collectes demandées à la main : boucle courte et légère (un SELECT sur un
  // index partiel), pour que le bouton « lancer maintenant » de l'écran Sources
  // réagisse en quelques secondes plutôt qu'au prochain cycle du producteur.
  const releverDemandes = async (): Promise<void> => {
    try {
      const n = await enqueueRequestedRuns(boss, pool);
      if (n > 0) {
        console.log(`[producer] ${n} collecte(s) demandée(s) à la main enfilée(s)`);
      }
    } catch (err) {
      console.error('[producer] relève des demandes échouée', err);
    }
  };
  await releverDemandes();
  const demandes = setInterval(() => void releverDemandes(), REQUESTED_RUN_POLL_MS);
  demandes.unref();

  // Producteur de ticks : enfile un `sequence.tick` périodique (dédup par
  // fenêtre) pour avancer les inscriptions dues même sans événement déclencheur.
  const tickProduce = async (): Promise<void> => {
    try {
      await boss.insert([{ name: 'sequence.tick', id: deterministicUuid('tick-cron', currentBucket(TICK_INTERVAL_MS)), data: {} }]);
    } catch (err) {
      console.error('[tick-producer] échec', err);
    }
  };
  await tickProduce();
  const ticker = setInterval(() => void tickProduce(), TICK_INTERVAL_MS);
  ticker.unref();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} reçu, arrêt propre…`);
    clearInterval(producer);
    clearInterval(ticker);
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] échec au démarrage', err);
  process.exit(1);
});
