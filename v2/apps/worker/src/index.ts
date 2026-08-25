import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { QUEUES } from '@jay-reach/core';
import { createRuntime, registerQueues } from './runtime.js';
import { runDiscover, type DiscoverJob } from './handlers/discover.js';
import { runQualify, type QualifyJob } from './handlers/qualify.js';
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
import { createPool, insertSignals, upsertResolvedAccount, startSourceRun, finishSourceRun } from './db.js';
import { persistCompanyEnrichment, persistEnrichedContact } from './enrichment-persist.js';
import { resolveProviderCredentials } from './credentials.js';
import { enqueueDiscoverForActiveSources } from './producer.js';
import { deterministicUuid, currentBucket } from './ids.js';

const WIRED = new Set([
  'sources.discover',
  'signals.qualify',
  'actions.dispatch',
  'enrichment.company',
  'enrichment.contacts',
  'sequence.enroll',
  'sequence.tick',
]);
const SMARTLEAD_PROVIDER = 'smartlead';
const FULLENRICH_PROVIDER = 'fullenrich';
// Fréquence du producteur (met les sources actives en file). Défaut : 15 min.
const DISCOVER_INTERVAL_MS = Number(process.env.DISCOVER_INTERVAL_MS ?? 15 * 60 * 1000);
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
    const ref = job.linkedin?.contactId ?? job.linkedin?.linkedinUrl ?? 'x';
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
        const qualifyJob: QualifyJob = { organizationId: sig.organizationId, companyName: sig.companyName };
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
    });
    console.log(`[qualify] compte=${accountId ?? '—'} SIREN=${resolved?.siren ?? '—'} (${resolved?.name_match ?? 'n/a'})`);
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
    console.log(`[dispatch] ${result.added_count ?? 0} lead(s) poussé(s) vers Smartlead`);
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
    const resolved = await runResolveCompany(apiKey, data);
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
    let saved = 0;
    for (const c of contacts) {
      const id = await persistEnrichedContact(pool, data.organizationId, data.accountId, c);
      if (id) {
        saved += 1;
      }
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
    } catch (err) {
      console.error('[producer] échec', err);
    }
  };
  await produce();
  const producer = setInterval(() => void produce(), DISCOVER_INTERVAL_MS);
  producer.unref();

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
