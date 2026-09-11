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
import { QUEUES, resolveScoringModel, placesRestantes, reduireLotAuReste } from '@jay-reach/core';
import { runDiscover, type DiscoverJob } from './handlers/discover.js';
import { runQualify, type QualifyJob } from './handlers/qualify.js';
import { runScore, DEFAULT_BATCH, compterSignauxScorables } from './handlers/score.js';
import { createAnthropicScorer } from './scorer-anthropic.js';
import { runLinkedInDispatch, isLinkedInChannel, type DispatchJob } from './handlers/dispatch.js';
import { envoyerEmailSalesBlink } from './handlers/email-salesblink.js';
import { releverSalesBlink } from './handlers/releve-salesblink.js';
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
  AGE_MAX_SIGNAL_JOURS,
  ecarterSignauxTropAnciens,
  enqueueDiscoverForActiveSources,
  enqueueScoringForOrgs,
  enqueueEnrichmentForQualified,
  enqueueEnrollments,
  enqueueRequestedRuns,
  lirePlafondFournisseur,
  PLAFOND_SCORING_PAR_DEFAUT,
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
  'inbox.sync',
] as const;

const FULLENRICH_PROVIDER = 'fullenrich';
const REOON_PROVIDER = 'reoon';
const ANTHROPIC_PROVIDER = 'anthropic';

/** Fréquence du producteur. Sert aussi de fenêtre de déduplication des jobs. */
export const DISCOVER_INTERVAL_MS = Number(process.env.DISCOVER_INTERVAL_MS ?? 15 * 60 * 1000);
/** Fréquence du tick de séquence. Même rôle de fenêtre. */
export const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 60 * 1000);

/**
 * Fenêtre de rejeu des actions email laissées `scheduled` (expéditeur
 * désactivé, plafond fournisseur atteint, erreur transitoire sous le seuil de
 * retry) : au plus un rejeu par action toutes les cinq minutes. Constante
 * fixe, pas lue dans l'environnement — contrairement aux plafonds et cadences
 * de l'écran Fournisseurs, ce n'est pas un réglage que l'opérateur ajuste.
 */
export const REJEU_ACTIONS_EMAIL_MS = 5 * 60 * 1000;

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
  const plafond = await lirePlafondFournisseur(pool, data.organizationId, ANTHROPIC_PROVIDER, PLAFOND_SCORING_PAR_DEFAUT);
  const usage = await pool.query<{ used: number }>(
    `select used from provider_daily_usage
      where organization_id = $1 and provider_id = $2 and usage_date = current_date`,
    [data.organizationId, ANTHROPIC_PROVIDER],
  );
  // Compte exactement ce que runScore sélectionnera ET scorera (même source
  // avec un prompt exploitable) : un signal dont la source n'a pas de prompt
  // reste `new` indéfiniment, et le compter ici viderait le plafond du jour
  // sans qu'aucun appel au modèle n'ait lieu (I1, revue du 10/09/2026).
  const nbEnAttente = await compterSignauxScorables(pool, data.organizationId);
  if (nbEnAttente === 0) {
    console.log(`[score] org ${data.organizationId} : aucun signal scorable — ignoré`);
    return;
  }
  const reste = placesRestantes(plafond, usage.rows[0]?.used ?? 0);
  const lot = reduireLotAuReste(Math.min(DEFAULT_BATCH, nbEnAttente), reste);
  if (lot === 0) {
    if (plafond === 0) {
      console.warn(`[score] org ${data.organizationId} : scoring en pause (plafond 0)`);
    } else {
      console.warn(`[score] org ${data.organizationId} : plafond quotidien de scoring atteint (${plafond}/jour), ${nbEnAttente} signaux en attente`);
    }
    return;
  }
  const credit = await pool.query<{ ok: boolean }>(
    `select app.consume_provider_credit($1, $2, $3, $4) as ok`,
    [data.organizationId, ANTHROPIC_PROVIDER, plafond, lot],
  );
  if (credit.rows[0]?.ok !== true) {
    console.warn(`[score] org ${data.organizationId} : credit de scoring refuse (plafond ${plafond}/jour)`);
    return;
  }
  const summary = await runScore({ pool, organizationId: data.organizationId, scorer: createAnthropicScorer(apiKey, credentials), batchSize: lot });
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
  // Canal email : SalesBlink. Résolution de la clé, de l'expéditeur, du
  // plafond, du rendu et du mode d'envoi — tout se passe dans le handler.
  await envoyerEmailSalesBlink({ pool, encryptionKey }, data);
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

interface ActionEnAttenteRow {
  readonly action_id: string;
  readonly organization_id: string;
  readonly enrollment_id: string;
  readonly step_id: string;
  readonly sender_id: string | null;
  readonly contact_id: string;
  readonly campaign_id: string;
  readonly template_parent_id: string | null;
  readonly locale: string | null;
}

/**
 * Relance les actions email laissées `scheduled` par un envoi précédent qui
 * n'a ni échoué ni réussi — `envoyerEmailSalesBlink` les laisse intactes
 * plutôt que de les bloquer (expéditeur désactivé, plafond fournisseur
 * atteint, erreur transitoire sous le seuil de retry), et rien d'autre ne les
 * relance : l'id du job de dispatch initial est déterministe par action, une
 * réinsertion identique serait donc dédupliquée par pg-boss sans jamais
 * réessayer.
 *
 * Fenêtre de deux minutes avant de considérer une action bloquée : le temps
 * qu'un envoi en cours se termine. Fenêtre de rejeu de cinq minutes
 * (`REJEU_ACTIONS_EMAIL_MS`) : un id de job différent par seau temporel, pour
 * qu'un rejeu ne s'accumule pas à chaque tour du tick (60 s) tant que l'action
 * reste en attente. `envoyerEmailSalesBlink` relit l'état de l'action à
 * l'exécution : une action déjà partie ou bloquée entre-temps est ignorée.
 *
 * `e.status in ('active', 'completed')` et l'absence de suppression active
 * sur l'adresse (C1, revue finale du 11/09 ; élargi à `completed` par le
 * hotfix du 11/09) : sans ce filtre, une inscription arrêtée pendant qu'une
 * action reste `scheduled` — l'expéditeur coupé par la vérification IMAP, un
 * prospect qui répond ou rebondit entre-temps — voyait son email repartir
 * dès l'expéditeur rétabli, vers quelqu'un qui avait déjà répondu ou une
 * adresse désinscrite. `completed` est inclus au même titre que `active` :
 * le tick y bascule l'inscription dès la dernière étape planifiée, avant même
 * que l'action ne soit envoyée — un email de dernière étape resterait sinon
 * `scheduled` sans jamais être repris. Même garde que `hasActiveSuppression`
 * (`sequence.ts`), portée sur l'adresse du contact déjà jointe ici.
 */
export async function rejouerActionsEmailEnAttente(ctx: Contexte): Promise<number> {
  const { pool, boss } = ctx;
  const res = await pool.query<ActionEnAttenteRow>(
    `select a.id as action_id, a.organization_id, a.enrollment_id, a.step_id, a.sender_id,
            e.contact_id, e.campaign_id, s.template_parent_id, c.locale
       from actions a
       join enrollments e on e.id = a.enrollment_id
       join contacts c on c.id = e.contact_id
       join sequence_steps s on s.id = a.step_id
       join organizations org on org.id = a.organization_id
      where a.channel = 'email'
        and a.status = 'scheduled'
        and a.dispatched_at is null
        and a.created_at < now() - interval '2 minutes'
        and org.sending_paused_at is null
        and e.status in ('active', 'completed')
        and not exists (
          select 1 from suppressions sup
           where sup.organization_id = a.organization_id
             and sup.scope = 'email'
             and sup.value = c.email
             and (sup.expires_at is null or sup.expires_at > now())
        )
      order by a.created_at asc
      limit 200`,
  );
  const bucket = currentBucket(REJEU_ACTIONS_EMAIL_MS);
  let rejouees = 0;
  for (const row of res.rows) {
    const job: DispatchJob = {
      organizationId: row.organization_id,
      channel: 'email',
      actionId: row.action_id,
      email: {
        enrollmentId: row.enrollment_id,
        contactId: row.contact_id,
        stepId: row.step_id,
        campaignId: row.campaign_id,
        templateParentId: row.template_parent_id,
        senderId: row.sender_id,
        locale: row.locale,
      },
    };
    await boss.insert([
      { name: 'actions.dispatch', id: deterministicUuid('dispatch-rejeu', row.action_id, bucket), data: job },
    ]);
    rejouees += 1;
  }
  return rejouees;
}

/**
 * Avance les inscriptions dues et enfile les envois autorisés vers
 * `actions.dispatch` (id déterministe par action → pas de doublon de job),
 * puis relance les actions email restées en attente d'un tour précédent.
 */
export async function traiterTick(ctx: Contexte): Promise<number> {
  const { pool, boss } = ctx;
  const jobs = await tickDueEnrollments(pool);
  for (const job of jobs) {
    // Réf de dédup par contact/action : LinkedIn via contactId/url, email via l'action du séquenceur.
    const ref = job.linkedin?.contactId ?? job.linkedin?.linkedinUrl ?? job.actionId ?? 'x';
    await boss.insert([
      { name: 'actions.dispatch', id: deterministicUuid('dispatch', ref, job.channel ?? 'email'), data: job },
    ]);
  }
  if (jobs.length > 0) {
    console.log(`[tick] ${jobs.length} envoi(s) enfilé(s)`);
  }
  const rejouees = await rejouerActionsEmailEnAttente(ctx);
  if (rejouees > 0) {
    console.log(`[tick] ${rejouees} action(s) email en attente rejouée(s)`);
  }
  return jobs.length + rejouees;
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
      // Sans ce report, le contact créé plus loin naît sans origine : on ne
      // sait plus quelle offre a motivé la prise de contact.
      ...(data.sourceSignalId ? { sourceSignalId: data.sourceSignalId } : {}),
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

/**
 * Met en file le travail périodique : collectes, scoring, enrichissement,
 * entretien. Retourne `null` en succès, ou l'erreur rencontrée : l'appelant
 * (`index.ts`, route `api/cron/moteur`) la consigne dans
 * `engine_status.last_error`, seule trace d'un échec de CYCLE — les échecs de
 * jobs individuels (par exemple un appel Anthropic refusé) restent dans
 * `pgboss.job.output`.
 */
export async function produire(ctx: Contexte): Promise<Error | null> {
  const { pool, boss } = ctx;
  try {
    const ecartes = await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
    if (ecartes.nouveaux > 0 || ecartes.qualifies > 0) {
      console.log(`[produire] signaux ecartes pour anciennete (> ${AGE_MAX_SIGNAL_JOURS} j) : ${ecartes.nouveaux} non scores, ${ecartes.qualifies} qualifies non enrichis`);
    }
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
    // Entrée en campagne : le maillon entre l'enrichissement et la séquence.
    // Sans lui, un contact enrichi n'était jamais inscrit nulle part.
    const i = await enqueueEnrollments(boss, pool);
    if (i > 0) {
      console.log(`[producer] ${i} contact(s) inscrit(s) en campagne`);
    }
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
    return null;
  } catch (err) {
    console.error('[producer] échec', err);
    return err instanceof Error ? err : new Error(String(err));
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

/**
 * Enfile un tick périodique, dédupliqué par fenêtre. Retourne `null` en
 * succès, ou l'erreur rencontrée — même contrat que `produire`.
 */
export async function produireTick(ctx: Contexte): Promise<Error | null> {
  try {
    await ctx.boss.insert([
      { name: 'sequence.tick', id: deterministicUuid('tick-cron', currentBucket(TICK_INTERVAL_MS)), data: {} },
    ]);
    return null;
  } catch (err) {
    console.error('[tick-producer] échec', err);
    return err instanceof Error ? err : new Error(String(err));
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
    case 'inbox.sync':
      return releverSalesBlink(ctx, donnees as { organizationId: string });
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
