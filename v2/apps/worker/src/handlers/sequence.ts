/**
 * Files `sequence.enroll` et `sequence.tick` : inscription d'un contact dans une
 * campagne, et avancement des inscriptions dues (émission d'actions idempotentes
 * + enfilement des envois). La décision par étape est pure (`composeTick` de
 * @jay-reach/core) ; ici on fait les I/O SQL et on renvoie les jobs d'envoi.
 *
 * Aucun envoi réel ici : les actions LinkedIn émises partent vers `actions.dispatch`,
 * qui les enfile dans `linkedin_action_queue`. Le worker les exécute ensuite depuis la
 * session LinkedIn du serveur (IP résidentielle dédiée), sous plafonds réglables ; le
 * pacing est jugé côté serveur avant chaque envoi.
 */
import type { Pool } from 'pg';
import {
  actionIdempotencyKey,
  composeTick,
  ecrireEvenement,
  placesRestantes,
  runGuards,
  renderTemplate,
  resolveSender,
  shiftIntoBusinessHours,
  applyLeadTime,
  poserEcheanceDepuisDispatch,
  echeanceEtapeSuivante,
  plafondDuJour,
  relectureRequise,
  fuseauDeLOrganisation,
  type BusinessHours,
  type Binding,
  type SenderInfo,
  type TickChannel,
  type TickStep,
} from '@jay-reach/core';
import { emailGateAllows } from '@jay-reach/providers/email-validation';
import { loadDomainPatterns, domainOf, type DomainPattern } from '../domain-patterns.js';
import type { DispatchJob } from './dispatch.js';
import {
  REQUETE_LIGNE_INSCRIPTION,
  buildMessageValues,
  construireEntreeGate,
  resolveTemplate,
  loadSnippets,
  type DueRow,
} from './message-values.js';



export interface EnrollJob {
  readonly organizationId: string;
  readonly campaignId: string;
  readonly contactId: string;
  readonly signalId?: string | null;
}

/**
 * Plafond quotidien d'une campagne (`campaigns.daily_cap`), ou `null` si
 * aucun n'est réglé. Gouverne les ENTRÉES en séquence (`enrollContact`
 * ci-dessous), pas les envois : l'envoi d'un email (`email-salesblink.ts`) ne
 * le revérifie pas, seuls le quota d'expéditeur et le plafond fournisseur
 * bornent à ce moment-là (fix round 2, 11/09 — retiré d'`email-salesblink.ts`
 * où il avait été ajouté par erreur lors de la revue finale).
 */
async function chargerPlafondCampagne(pool: Pool, campaignId: string): Promise<number | null> {
  const res = await pool.query<{ daily_cap: number | null }>(`select daily_cap from campaigns where id = $1`, [
    campaignId,
  ]);
  return res.rows[0]?.daily_cap ?? null;
}

/**
 * Nombre d'entrées déjà comptabilisées aujourd'hui — jour de l'ORGANISATION
 * (revue F5, point 1, tour de correction 2), pas celui du serveur : même
 * fonction et même repli que `loadSenders`/`chargerContraintesSender`
 * ci-dessous. C'est le plafond d'entrées en séquence par campagne, un chiffre
 * que l'écran montre lui aussi.
 */
export async function compterEntreesDuJour(pool: Pool, campaignId: string, organizationId: string): Promise<number> {
  const fuseau = await fuseauDeLOrganisation(pool, organizationId);
  const res = await pool.query<{ n: string }>(
    `select count(*)::text as n from enrollments
      where campaign_id = $1 and started_at >= date_trunc('day', now() at time zone $2) at time zone $2`,
    [campaignId, fuseau],
  );
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * Inscrit un contact dans une campagne. Dédup par l'index partiel
 * `enrollments_one_active_uidx` (une seule inscription vivante par contact) :
 * `on conflict do nothing`. Première action due immédiatement (tick suivant).
 * Retourne l'id créé, ou null si le contact a déjà une inscription active
 * ou si le plafond quotidien de la campagne est atteint (contrôle autoritaire :
 * le pré-filtre du producteur peut avoir laissé passer un contact entre-temps
 * comptabilisé). Dans ce dernier cas, le contact est repris le lendemain :
 * l'identifiant du job d'inscription porte le jour UTC (`enqueueEnrollments`),
 * donc un nouveau job est créé chaque jour tant que l'inscription n'a pas eu
 * lieu ; la déduplication réelle reste l'index `enrollments_one_active_uidx`
 * et le `on conflict do nothing` ci-dessus.
 */
export async function enrollContact(pool: Pool, job: EnrollJob): Promise<string | null> {
  // Compter puis insérer n'est pas atomique, mais ça suffit ici : le moteur ne
  // tourne qu'en une seule instance (deploy/vps/README.md), et pg-boss traite
  // cette file un job à la fois dans ce process sans `batchSize`. Si le worker
  // est un jour répliqué, remplacer par une transaction avec
  // `select ... from campaigns where id = $1 for update`, sous peine de
  // dépasser le plafond d'une entrée par job concurrent sur la campagne.
  const plafond = await chargerPlafondCampagne(pool, job.campaignId);
  if (plafond !== null) {
    const reste = placesRestantes(plafond, await compterEntreesDuJour(pool, job.campaignId, job.organizationId));
    if (reste === 0) {
      console.warn(`[enroll] plafond du jour atteint pour la campagne ${job.campaignId} (${plafond}/jour), contact ${job.contactId} reporte`);
      return null;
    }
  }
  const res = await pool.query<{ id: string }>(
    `insert into enrollments
       (organization_id, campaign_id, contact_id, signal_id, status, current_step, next_action_at, started_at)
     values ($1, $2, $3, $4, 'active', 0, now(), now())
     on conflict (contact_id) where status in ('active','paused','paused_absence')
     do nothing
     returning id`,
    [job.organizationId, job.campaignId, job.contactId, job.signalId ?? null],
  );
  return res.rows[0]?.id ?? null;
}

interface StepRow {
  readonly id: string;
  readonly channel: TickChannel;
  readonly delay_hours: number;
  readonly template_parent_id: string | null;
}

function isLinkedIn(channel: TickChannel): boolean {
  return channel === 'linkedin_invite' || channel === 'linkedin_message';
}

/**
 * Type d'expéditeur requis par un canal, ou null quand le canal n'en consomme
 * aucun. Une étape `call` n'envoie rien (CLAUDE.md #8) : ni expéditeur, ni quota.
 *
 * LinkedIn n'en consomme pas non plus : l'expéditeur y est la session du serveur
 * (`linkedin_server_sessions`), pas une ligne de `senders`, et ses plafonds vivent
 * dans `linkedin_settings`, appliqués plus loin par le canal d'envoi. Exiger ici une
 * ligne `senders` de type `linkedin` mettait chaque inscription en pause
 * (`sender_unavailable:linkedin`) sans jamais créer d'action : le canal serveur n'en
 * crée aucune, seule l'extension gelée le faisait.
 */
function senderKindFor(channel: TickChannel): 'email' | 'postal' | null {
  if (channel === 'email') return 'email';
  if (channel === 'letter') return 'postal';
  return null;
}

/**
 * Expéditeurs actifs d'un ensemble d'organisations, avec leur consommation du
 * jour — celle qui départage à la première attribution (docs/04 : « le sender
 * actif du bon type ayant la plus faible consommation de quota du jour »).
 *
 * Chargé en une requête pour tout le lot : le tick traite jusqu'à 200
 * inscriptions, une requête par inscription serait 200 allers-retours.
 */
async function loadSenders(
  pool: Pool,
  organizationIds: string[],
): Promise<{ parOrg: Map<string, SenderInfo[]>; contraintes: Map<string, ContraintesSender> }> {
  const parOrg = new Map<string, SenderInfo[]>();
  const contraintes = new Map<string, ContraintesSender>();
  if (organizationIds.length === 0) return { parOrg, contraintes };

  // Revue F5, point 2 : le jour compté (used_today) doit être celui de CHAQUE
  // organisation, pas celui du serveur (`date_trunc('day', now())`, avant ce
  // correctif) — même fonction et même repli (organization_settings.fuseau
  // absent -> Europe/Paris) que le crédit de scoring/enrichissement (#118).
  // `organizationIds` peut mélanger plusieurs organisations dans un même lot
  // de tick ; la carte {orgId -> fuseau} part en un seul paramètre jsonb pour
  // garder une requête unique sur `senders` (le commentaire de la fonction :
  // « une requête par inscription serait 200 allers-retours » vaut aussi
  // pour une requête par organisation).
  const fuseauParOrg: Record<string, string> = {};
  await Promise.all(
    organizationIds.map(async (id) => {
      fuseauParOrg[id] = await fuseauDeLOrganisation(pool, id);
    }),
  );

  const res = await pool.query<{
    organization_id: string;
    id: string;
    kind: string;
    is_active: boolean;
    used_today: number;
    used_this_hour: number;
    daily_quota: number | null;
    hourly_quota: number | null;
    timezone: string | null;
    business_hours: unknown;
  }>(
    `select s.id, s.organization_id, s.kind, s.is_active,
            s.daily_quota, s.hourly_quota, s.timezone, s.business_hours,
            (select count(*)::int from actions act
              where act.sender_id = s.id
                and act.created_at >= date_trunc('day', now() at time zone ($2::jsonb ->> s.organization_id::text))
                                      at time zone ($2::jsonb ->> s.organization_id::text)) as used_today,
            -- Revue F5 (relecture) : même fuseau que used_today ci-dessus, pas
            -- l'heure du serveur — un décalage non entier (Inde +5:30, Népal
            -- +5:45) faisait sinon tomber le plafond horaire hors de l'heure
            -- murale de l'organisation alors que le plafond journalier, lui,
            -- la respectait déjà.
            (select count(*)::int from actions act
              where act.sender_id = s.id
                and act.created_at >= date_trunc('hour', now() at time zone ($2::jsonb ->> s.organization_id::text))
                                       at time zone ($2::jsonb ->> s.organization_id::text)) as used_this_hour
       from senders s
      where s.organization_id = any($1::uuid[])`,
    [organizationIds, JSON.stringify(fuseauParOrg)],
  );
  for (const r of res.rows) {
    const liste = parOrg.get(r.organization_id) ?? [];
    // `SenderInfo` reste le contrat minimal de l'attribution ; les contraintes
    // d'envoi vivent à côté plutôt que d'alourdir un type que `resolveSender`
    // n'a aucune raison de connaître.
    liste.push({ id: r.id, kind: r.kind, isActive: r.is_active, usedToday: r.used_today });
    parOrg.set(r.organization_id, liste);
    contraintes.set(r.id, {
      usedThisHour: r.used_this_hour,
      dailyQuota: r.daily_quota,
      hourlyQuota: r.hourly_quota,
      timezone: r.timezone,
      businessHours: r.business_hours,
      usedToday: r.used_today,
    });
  }
  return { parOrg, contraintes };
}

/**
 * Contraintes d'envoi portées par l'expéditeur, au-delà de ce que
 * `SenderInfo` transporte pour l'attribution.
 */
export interface ContraintesSender {
  readonly usedToday: number;
  readonly usedThisHour: number;
  readonly dailyQuota: number | null;
  readonly hourlyQuota: number | null;
  readonly timezone: string | null;
  readonly businessHours: unknown;
}

/**
 * Places encore disponibles pour un expéditeur, quota horaire et journalier
 * confondus (le plus contraignant des deux) — `Infinity` quand aucun des
 * deux n'est réglé. Extrait du tick pour que l'envoi (`email-salesblink.ts`,
 * I5, revue finale du 11/09) le revérifie sans dupliquer le calcul.
 */
export function quotaSenderRestant(c: ContraintesSender): number {
  const restantJour = c.dailyQuota !== null ? Math.max(0, c.dailyQuota - c.usedToday) : Infinity;
  const restantHeure = c.hourlyQuota !== null ? Math.max(0, c.hourlyQuota - c.usedThisHour) : Infinity;
  return Math.min(restantJour, restantHeure);
}

/**
 * Contraintes d'UN expéditeur, chargées pour lui seul — pour le lot, voir
 * `loadSenders` : l'envoi (contrairement au tick) ne connaît qu'un
 * expéditeur à la fois.
 *
 * Compte les envois réellement partis (`status in ('dispatched','delivered')`,
 * `dispatched_at`), pas les créations (`loadSenders` compte par `created_at`,
 * sans filtre de statut) : le tick planifie l'avenir, l'envoi vérifie ce qui
 * est effectivement sorti par cet expéditeur (fix round 2, 11/09).
 *
 * `organizationId` (revue F5, point 2) : le jour compté (used_today) doit
 * être celui de CETTE organisation, pas celui du serveur — même fonction et
 * même repli que `loadSenders` ci-dessus. Le seul appelant
 * (`email-salesblink.ts`) l'a déjà à portée de main (`job.organizationId`).
 */
export async function chargerContraintesSender(
  pool: Pool,
  senderId: string,
  organizationId: string,
): Promise<ContraintesSender | null> {
  const fuseau = await fuseauDeLOrganisation(pool, organizationId);
  const res = await pool.query<{
    daily_quota: number | null;
    hourly_quota: number | null;
    timezone: string | null;
    business_hours: unknown;
    used_today: number;
    used_this_hour: number;
  }>(
    `select s.daily_quota, s.hourly_quota, s.timezone, s.business_hours,
            (select count(*)::int from actions act
              where act.sender_id = s.id
                and act.status in ('dispatched', 'delivered')
                and act.dispatched_at >= date_trunc('day', now() at time zone $2) at time zone $2) as used_today,
            -- Revue F5 (relecture) : même fuseau que used_today ci-dessus, pas
            -- l'heure du serveur — un décalage non entier (Inde +5:30, Népal
            -- +5:45) faisait sinon tomber le plafond horaire hors de l'heure
            -- murale de l'organisation.
            (select count(*)::int from actions act
              where act.sender_id = s.id
                and act.status in ('dispatched', 'delivered')
                and act.dispatched_at >= date_trunc('hour', now() at time zone $2) at time zone $2) as used_this_hour
       from senders s where s.id = $1`,
    [senderId, fuseau],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    usedToday: r.used_today,
    usedThisHour: r.used_this_hour,
    dailyQuota: r.daily_quota,
    hourlyQuota: r.hourly_quota,
    timezone: r.timezone,
    businessHours: r.business_hours,
  };
}

/**
 * Décalage du fuseau d'un expéditeur, en minutes, à l'instant considéré.
 *
 * Calculé pour CET instant et non une fois pour toutes : l'écart change avec
 * l'heure d'été, et une fenêtre « 9 h - 18 h » figée sur l'hiver enverrait une
 * heure trop tôt tout l'été.
 */
function decalageFuseau(timezone: string | null, instant: Date): number {
  if (!timezone) return 0;
  try {
    const local = new Date(instant.toLocaleString('en-US', { timeZone: timezone }));
    const utc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
    return Math.round((local.getTime() - utc.getTime()) / 60000);
  } catch {
    // Fuseau inconnu : on reste en UTC plutôt que d'inventer un décalage.
    console.warn(`[tick] fuseau inconnu « ${timezone} » — UTC utilisé`);
    return 0;
  }
}

/** Heures ouvrées de l'expéditeur, ou la valeur par défaut de la spec (9-18, lun-ven). */
function heuresOuvrees(brut: unknown): BusinessHours {
  const h = brut as { startHour?: unknown; endHour?: unknown; days?: unknown } | null;
  const start = typeof h?.startHour === 'number' ? h.startHour : 9;
  const end = typeof h?.endHour === 'number' ? h.endHour : 18;
  const days = Array.isArray(h?.days) && h.days.length > 0
    ? (h.days as unknown[]).map(Number).filter((d) => d >= 1 && d <= 7)
    : [1, 2, 3, 4, 5];
  return { startHour: start, endHour: end, days };
}

/** Liens contact ↔ expéditeur déjà établis, pour les contacts de ce lot. */
async function loadBindings(pool: Pool, contactIds: string[]): Promise<Binding[]> {
  if (contactIds.length === 0) return [];
  const res = await pool.query<{ contact_id: string; sender_id: string; sender_kind: string }>(
    `select contact_id, sender_id, sender_kind
       from contact_sender_bindings where contact_id = any($1::uuid[])`,
    [contactIds],
  );
  return res.rows.map((r) => ({ contactId: r.contact_id, senderId: r.sender_id, kind: r.sender_kind }));
}

/** La politique d'approbation de la campagne exige-t-elle ce canal ? */
function policyRequiresApproval(policy: unknown, channel: TickChannel): boolean {
  if (!policy || typeof policy !== 'object') return false;
  const p = policy as { mode?: unknown; channels?: unknown };
  if (p.mode === 'all') return true;
  if (Array.isArray(p.channels) && p.channels.includes(channel)) return true;
  return false;
}

/**
 * L'étape doit-elle passer en relecture au titre du réglage « Relecture des
 * premiers envois » (I2, revue finale du 17/09) ? Seuil : `entry_rules.
 * relecturePremiersEnvois` de la campagne si posé, sinon le défaut
 * d'organisation `relecture_premiers_envois_defaut` (`plafondDuJour`, même
 * chaîne de repli que les autres réglages, R83). Le nombre déjà parti compte
 * les actions de CETTE étape en `dispatched`/`delivered` — step_id identifie
 * déjà la campagne, une seule requête par étape et par passage (mise en cache
 * par l'appelant).
 */
async function relecturePremiersEnvoisRequise(
  pool: Pool,
  row: DueRow,
  stepId: string,
  seuilDefautParOrg: Map<string, number>,
  dejaPartisParEtape: Map<string, number>,
): Promise<boolean> {
  const entryRules = (row.entry_rules ?? {}) as { relecturePremiersEnvois?: unknown };
  let seuil: number;
  if (typeof entryRules.relecturePremiersEnvois === 'number') {
    seuil = entryRules.relecturePremiersEnvois;
  } else {
    let defaut = seuilDefautParOrg.get(row.organization_id);
    if (defaut === undefined) {
      defaut = await plafondDuJour(pool, row.organization_id, 'relecture_premiers_envois_defaut');
      seuilDefautParOrg.set(row.organization_id, defaut);
    }
    seuil = defaut;
  }
  // 0 = tout part sans relecture (libellé des trois écrans) : inutile de
  // compter les envois déjà partis pour le dire.
  if (seuil <= 0) return false;

  let dejaPartis = dejaPartisParEtape.get(stepId);
  if (dejaPartis === undefined) {
    const res = await pool.query<{ n: number }>(
      `select count(*)::int as n from actions where step_id = $1 and status in ('dispatched', 'delivered')`,
      [stepId],
    );
    dejaPartis = res.rows[0]?.n ?? 0;
    dejaPartisParEtape.set(stepId, dejaPartis);
  }
  return relectureRequise({ seuil, dejaPartis });
}

/** Ce qu'on a déjà envoyé aujourd'hui chez un compte donné. */
interface ToucheAujourdhui {
  /** Personnes distinctes touchées, toutes personas confondues. */
  readonly personnes: number;
  /** Personas déjà servies chez ce compte. */
  readonly personas: ReadonlySet<string>;
  /** Instant où le compte redevient joignable. */
  readonly prochainCreneau: number;
}

/**
 * Personnes touchées aujourd'hui, par compte, avec le détail des personas.
 *
 * La règle d'origine était « un contact par compte et par jour » — elle
 * regardait le compte sans distinguer la personne. Elle protégeait bien contre
 * le cas réel qui l'a motivée (une entreprise publiant huit offres recevait
 * huit messages), mais elle interdisait aussi ce que deux campagnes par métier
 * demandent : écrire au directeur commercial ET à un commercial de la même
 * entreprise. Comme la première campagne touche son compte presque chaque jour
 * pendant deux semaines, la seconde glissait indéfiniment sans jamais partir.
 *
 * On mesure donc deux choses : quelles personas ont déjà été servies chez ce
 * compte, et combien de personnes distinctes en tout. La première empêche de
 * réécrire au même profil, la seconde conserve la protection d'origine.
 *
 * Compté sur les actions RÉELLEMENT parties ou planifiées du jour, pas sur les
 * actions bloquées : un contact qu'on n'a pas touché ne consomme pas la place
 * de son entreprise.
 */
async function loadAccountsContactedToday(
  pool: Pool,
  organizationIds: string[],
): Promise<Map<string, ToucheAujourdhui>> {
  const parCompte = new Map<string, ToucheAujourdhui>();
  if (organizationIds.length === 0) return parCompte;
  const res = await pool.query<{
    account_id: string;
    prochain_creneau: string;
    personnes: string;
    personas: (string | null)[];
  }>(
    `select c.account_id,
            (date_trunc('day', min(a.created_at)) + interval '1 day') as prochain_creneau,
            count(distinct c.id) as personnes,
            array_agg(distinct c.persona_id) filter (where c.persona_id is not null) as personas
       from actions a
       join enrollments e on e.id = a.enrollment_id
       join contacts c on c.id = e.contact_id
      where a.organization_id = any($1::uuid[])
        and c.account_id is not null
        and a.status <> 'blocked'
        and a.created_at >= date_trunc('day', now())
      group by c.account_id`,
    [organizationIds],
  );
  for (const row of res.rows) {
    parCompte.set(row.account_id, {
      personnes: Number(row.personnes),
      personas: new Set((row.personas ?? []).filter((p): p is string => p !== null)),
      prochainCreneau: new Date(row.prochain_creneau).getTime(),
    });
  }
  return parCompte;
}

/**
 * Personnes qu'on accepte de toucher dans une même entreprise le même jour.
 *
 * Deux, parce que deux campagnes par métier tournent en parallèle. Au-delà, on
 * ne prospecte plus une entreprise, on la démarche — ce que le produit annonce
 * ne pas faire.
 */
const PERSONNES_PAR_ENTREPRISE_ET_PAR_JOUR = Number(process.env.ACCOUNT_PEOPLE_PER_DAY ?? 2);

/**
 * Délai entre la remise au provider et l'arrivée chez le destinataire, en
 * heures. Le courrier manuscrit doit partir plusieurs jours avant la date
 * voulue ; l'email et LinkedIn arrivent dans la seconde.
 *
 * La valeur du courrier vient de la spec (72 h). Elle appartiendra au
 * `ChannelProvider` quand le canal sera implémenté (T23) ; en attendant, la
 * poser ici vaut mieux que d'écrire un `dispatch_after` égal au `scheduled_for`,
 * qui ferait partir un courrier le jour où il devrait arriver.
 */
const LEAD_TIME_HEURES: Record<string, number> = { letter: 72 };

/**
 * Rang ORDINAL d'une étape dans sa campagne (0 pour la première), c'est-à-dire ce que
 * `enrollments.current_step` désigne partout : le tick lit `steps[current_step]` et
 * `reprendreInscription` fait `order by position offset current_step`. Les positions, elles,
 * ne sont pas contiguës (`supprimerEtape` ne renumérote pas, `enregistrerEtape` crée à
 * `max(position) + 1`) : passer `sequence_steps.position` à `mettreInscriptionEnPause` écrivait
 * un rang faux dès qu'une étape avait été supprimée, et la reprise ne retrouvait plus l'étape.
 * Rend undefined quand l'étape n'existe plus (suppression entre-temps).
 */
export async function rangDeLEtape(pool: Pick<Pool, 'query'>, stepId: string): Promise<number | undefined> {
  const res = await pool.query<{ rang: number }>(
    `select (select count(*)::int from sequence_steps o /* jr:rang_etape */
              where o.campaign_id = s.campaign_id and o.position < s.position) as rang
       from sequence_steps s
      where s.id = $1`,
    [stepId],
  );
  return res.rows[0]?.rang;
}

/**
 * Met en pause une inscription active : plus rien ne part tant qu'un
 * opérateur ne l'a pas reprise. `currentStep` ramène l'inscription à
 * l'étape qui vient d'échouer (gate de délivrabilité, échec d'envoi
 * définitif) — elle n'a pas été jouée, une reprise doit la rejouer, pas la
 * sauter. `stopReason` ne remplace jamais un motif déjà posé (`coalesce`) :
 * la première cause d'arrêt est celle qui compte. Une inscription déjà
 * `replied`, `stopped` ou `completed` n'est jamais modifiée par cet appel
 * (`where … and status = 'active'`) : la garde vit dans le SQL lui-même,
 * sans lecture préalable.
 *
 * Journalise `enrollment_paused` (tour de correction 5, point 3, fil
 * d'activité) — symétrique de `enrollment_resumed`
 * (`fonctions/sequence.ts::reprendreInscription`), jusqu'ici jamais écrit
 * côté pause, ce qui laissait le fil muet sur les inscriptions mises en pause
 * par le moteur. `returning` porte directement de quoi journaliser (organisation,
 * contact, campagne) sans requête supplémentaire ; `rows[0]` absent (garde déjà
 * hors `'active'`) : rien n'a changé, rien à journaliser (idempotent, comme
 * `basculerPauseEnvoi`). Jamais d'échec de CE handler pour le journal — l'inscription
 * est déjà en pause, un journal qui ne s'écrit pas ne doit pas faire retenter pg-boss.
 */
export async function mettreInscriptionEnPause(
  pool: Pool,
  enrollmentId: string,
  currentStep: number,
  stopReason: string,
): Promise<void> {
  const res = await pool.query<{ organization_id: string; contact_id: string; campaign_id: string }>(
    `update enrollments
        set status = 'paused',
            next_action_at = null,
            stop_reason = coalesce(stop_reason, $3),
            current_step = $2
      where id = $1 and status = 'active'
      returning organization_id, contact_id, campaign_id`,
    [enrollmentId, currentStep, stopReason],
  );
  const ligne = res.rows[0];
  if (!ligne) return;

  try {
    await ecrireEvenement(pool, {
      organisationId: ligne.organization_id,
      entityType: 'contact',
      entityId: ligne.contact_id,
      action: 'enrollment_paused',
      diff: { libelle: 'Inscription mise en pause.', campagneId: ligne.campaign_id, motif: stopReason },
    });
  } catch (err) {
    console.warn('[journal] enrollment_paused', err);
  }
}

/**
 * Rattrapage borné (issue #111) : une inscription `active` dont l'action de
 * l'étape PRÉCÉDENTE est bien partie (`dispatched`/`delivered`,
 * `dispatched_at` connu) mais dont `next_action_at` est resté `null`. Ce cas
 * se produit quand `mark_action_dispatched` réussit puis que la pose de
 * l'échéance échoue juste après (panne base, redémarrage du worker) : sans ce
 * rattrapage, le tick ne sélectionne plus jamais cette inscription
 * (`next_action_at is not null` est la condition d'entrée de la requête `due`
 * ci-dessous), et son étape suivante n'arrive jamais.
 *
 * Sélection en UNE requête (tour de correction 2, revue du 17/09) : `status =
 * 'active' and next_action_at is null` n'est PAS un cas rare — c'est l'état
 * normal de CHAQUE inscription entre la création de son action et son départ
 * réel. Sur une campagne de plusieurs milliers de contacts étalée sur
 * plusieurs jours d'envoi, des milliers de lignes le sont à tout instant.
 * Une première version sélectionnait ces lignes SANS filtrer sur l'action
 * précédente, puis interrogeait chaque ligne une par une pour écarter celles
 * encore `scheduled` : jusqu'à 200 requêtes par tick pour ne rien rattraper,
 * et surtout un `limit 200` SANS ordre — les mêmes lignes « scheduled »
 * revenaient à chaque tick, et une inscription réellement bloquée au-delà des
 * 200 premières n'était jamais examinée.
 *
 * La jointure latérale sur l'étape de rang `current_step - 1` (`offset`/
 * `limit`, jamais une égalité sur `position` — issue #115) puis sur `actions`
 * filtrant `status in ('dispatched', 'delivered') and dispatched_at is not
 * null` ne renvoie QUE les vrais candidats : plus aucune requête par ligne
 * inutile. `order by dispatched_at asc` traite les plus anciennes d'abord, de
 * sorte qu'un `limit 200` fait toujours progresser le rattrapage au lieu de
 * ressasser les mêmes lignes non concernées.
 *
 * Pose l'échéance à partir du DÉPART RÉEL déjà connu (`dispatched_at`),
 * jamais `now` — le résultat doit être identique à celui qu'aurait posé le
 * gestionnaire d'envoi s'il avait réussi du premier coup. `dispatched_at` est
 * un `timestamptz` renvoyé en objet `Date` par `pg` : `poserEcheanceDepuisDispatch`
 * (`@jay-reach/core`) l'accepte indifféremment en `Date` ou en chaîne
 * (`versInstant`, interne au cœur — cette fonction-ci suffit, rien d'autre à
 * importer).
 */
export async function rattraperEcheancesManquantes(pool: Pool, limit = 200): Promise<void> {
  const candidats = await pool.query<{
    id: string;
    campaign_id: string;
    current_step: number;
    dispatched_at: string | Date | null;
  }>(
    `select e.id, e.campaign_id, e.current_step, a.dispatched_at
       from enrollments e
       join lateral (
         select id
           from sequence_steps
          where campaign_id = e.campaign_id
          order by position asc
          offset e.current_step - 1
          limit 1
       ) s on true
       join actions a
         on a.step_id = s.id
        and a.enrollment_id = e.id
        and a.status in ('dispatched', 'delivered')
        and a.dispatched_at is not null
      where e.status = 'active'
        and e.next_action_at is null
        and e.current_step > 0
      order by a.dispatched_at asc
      limit $1`,
    [limit],
  );
  let rattrapees = 0;
  for (const candidat of candidats.rows) {
    const ecrit = await poserEcheanceDepuisDispatch(
      pool,
      { enrollmentId: candidat.id, campaignId: candidat.campaign_id, currentStep: candidat.current_step },
      candidat.dispatched_at,
    );
    if (ecrit) rattrapees += 1;
  }
  if (rattrapees > 0) {
    console.warn(`[tick] ${rattrapees} inscription(s) rattrapée(s) : échéance posée après coup (issue #111)`);
  }
}

interface AbsenceEchueRow {
  id: string;
  organization_id: string;
  contact_id: string | null;
  campaign_id: string;
  current_step: number;
  resume_at: string | Date;
}

/**
 * Reprend les inscriptions `paused_absence` dont le retour (`resume_at`) est
 * atteint (F10) : rien d'autre ne les reprend jamais — ni le tick (`due` ne
 * sélectionne que `status = 'active'`), ni un événement `resume` de la
 * machine à états (`applyEvent`, `sequencer/state-machine.ts`), qu'aucun code
 * n'émet. Sans ce traitement, une inscription en pause pour absence le reste
 * pour toujours une fois son retour dépassé.
 *
 * Règle produit : le délai d'attente entre deux mails ne court pas pendant
 * l'absence, il repart entièrement au retour — jamais « tout de suite »,
 * le pire moment (une boîte pleine le jour du retour de vacances).
 * `poserEcheanceDepuisDispatch` (@jay-reach/core, partagée avec le rattrapage
 * ci-dessus) porte déjà exactement ce calcul : poser l'échéance depuis un
 * instant CONNU plutôt que `now` — ce n'est pas un dispatch ici, mais la même
 * mécanique s'applique à l'identique, `resume_at` jouant le rôle de l'instant
 * de départ.
 *
 * **`next_action_at = null` dans l'activation est OBLIGATOIRE** (trouvé à la
 * relecture) : `record-reply.ts` pose `next_action_at = now() + N jours` au
 * MÊME instant que `resume_at`, à la mise en pause. `poserEcheanceApresDepart`
 * (`sequencer/echeance.ts`) exige `next_action_at is null` dans son `where` —
 * sans le remettre à null ici, sa garde échoue toujours, l'échéance posée par
 * ce traitement n'est jamais écrite, et l'inscription repart `active` avec
 * l'échéance du JOUR DU RETOUR déjà posée par la pause : exactement le
 * comportement que ce traitement doit supprimer.
 *
 * `current_step` d'une inscription `paused_absence` pointe déjà l'étape EN
 * ATTENTE, jamais celle qui vient d'être envoyée : une réponse d'absence
 * arrive après un envoi RÉUSSI, et `composeTick` (`sequencer/tick.ts`) avance
 * `current_step` dès la CRÉATION de l'action de l'étape courante, avant même
 * son départ réel (`nextStep = currentStep + 1`, écrit en base par le même
 * appel qui insère l'action `scheduled`) — au moment de la pause,
 * `current_step` vaut donc déjà le rang de l'étape suivante. C'est
 * exactement le rang qu'attend `poserEcheanceApresDepart` (`offset
 * current_step`).
 *
 * **Exception** (trouvé à la relecture) : une inscription `paused` (blocage
 * opérateur — gate, expéditeur indisponible…) peut basculer directement en
 * `paused_absence` SANS jamais repasser par `active` (`LIVE_STATUSES` de
 * `record-reply.ts` accepte `paused`). Son `current_step` pointe alors
 * l'étape DÉJÀ TENTÉE — restée bloquée/non partie, action déjà en base — et
 * pas une étape en attente de composition. Même traitement que
 * `reprendreInscription` (pause MANUELLE, `fonctions/sequence.ts`) dans ce
 * cas : l'action `blocked`/`failed` de cette étape est remise `scheduled`,
 * sauf si elle porte déjà une preuve d'envoi (`payload->>'message_id'`, même
 * garde M3). Sans ça, `composeTick` refuserait de recréer une action dont la
 * clé d'idempotence est déjà prise, et l'inscription resterait active sans
 * jamais avancer.
 *
 * **L'échéance et le rejeu ne visent JAMAIS la même étape** (revue
 * transversale, lot 2 — le défaut le plus grave qu'elle ait trouvé) : quand
 * une action bloquée existe pour `current_step` et doit être rejouée, cette
 * fonction NE pose PAS `next_action_at` — elle laisse le `null` de
 * l'activation ci-dessus. Poser les deux à la fois faisait boucler
 * l'inscription indéfiniment : au départ réel de l'action rejouée,
 * `poserEcheanceApresDepart` (`sequencer/echeance.ts`) refuse d'écrire
 * l'échéance suivante — sa garde exige `next_action_at is null`, déjà pris
 * par la pose d'ici — puis le tick suivant tente de recomposer la MÊME étape,
 * bute sur la clé d'idempotence déjà prise (`on conflict … do nothing`) et
 * saute son avancement (`tickDueEnrollments`, plus bas) : l'inscription
 * revient en tête du tri par `next_action_at` à chaque passage, sans plus
 * jamais progresser, et rien ne le signale. Le rejeu pose donc lui-même le
 * délai complet sur `scheduled_for` de l'action (même calcul,
 * `echeanceEtapeSuivante` depuis `resume_at` — jamais `now()`, voir plus bas)
 * et laisse le départ réel de cette action poser l'échéance suivante en toute
 * sécurité, sa garde étant encore libre.
 *
 * Le passage `paused_absence -> active` est journalisé (`enrollment_resumed`,
 * même action que la reprise manuelle) : sans trace, personne ne peut
 * comprendre après coup pourquoi un message est reparti à telle date.
 *
 * Sélection puis activation individuelle (pas un `update ... returning`
 * global) : l'activation sert aussi de garde d'idempotence — `and status =
 * 'paused_absence'` dans son `where` ne matche plus rien pour une ligne déjà
 * reprise par un passage précédent ou concurrent, et on n'écrit alors aucune
 * échéance. Supporte un retard quelconque : l'échéance se calcule TOUJOURS
 * depuis `resume_at`, jamais `now`, qu'il soit dépassé d'une minute ou de
 * plusieurs jours (worker resté arrêté).
 */
export async function reprendreAbsencesEchues(pool: Pool, now: Date = new Date(), limit = 200): Promise<void> {
  // `camp.status = 'active'` (F14, mineur relevé à la revue) : sans ce filtre,
  // une campagne mise en pause ou archivée PENDANT l'absence d'un contact
  // faisait quand même repasser son inscription `active` au retour — aucun
  // envoi ne suivait (le tick, désormais gardé lui aussi, l'aurait de toute
  // façon ignorée), mais l'entonnoir comptait à tort un contact « en
  // séquence » sur une campagne qui ne tourne plus. L'inscription reste
  // `paused_absence` tant que la campagne n'est pas active : rien à perdre,
  // le prochain passage la reconsidère telle quelle dès qu'elle le redevient.
  const candidats = await pool.query<AbsenceEchueRow>(
    `select e.id, e.organization_id, e.contact_id, e.campaign_id, e.current_step, e.resume_at
       from enrollments e
       join campaigns camp on camp.id = e.campaign_id
      where e.status = 'paused_absence'
        and e.resume_at is not null
        and e.resume_at <= $1
        and camp.status = 'active'
      order by e.resume_at asc
      limit $2`,
    [now.toISOString(), limit],
  );
  let reprises = 0;
  for (const candidat of candidats.rows) {
    const activee = await pool.query(
      `update enrollments
          set status = 'active', resume_at = null, next_action_at = null, stop_reason = null
        where id = $1 and status = 'paused_absence'`,
      [candidat.id],
    );
    if ((activee.rowCount ?? 0) === 0) continue; // déjà reprise entre-temps (idempotence)

    // Étape EN ATTENTE (cas normal) OU étape DÉJÀ TENTÉE, bloquée (exception,
    // voir docstring) : même requête pour les deux, `current_step` désigne
    // l'une ou l'autre selon l'historique de l'inscription. `delay_hours` sert
    // aux DEUX issues possibles ci-dessous (poser l'échéance, ou calculer le
    // `scheduled_for` du rejeu) : même formule, seule sa cible change.
    const etape = await pool.query<{ id: string; delay_hours: number }>(
      `select id, delay_hours from sequence_steps
        where campaign_id = $1
        order by position asc
        offset $2
        limit 1`,
      [candidat.campaign_id, candidat.current_step],
    );
    const etapeId = etape.rows[0]?.id;
    const delayHeures = etape.rows[0]?.delay_hours;

    // Existe-t-il une action bloquée/en échec à rejouer pour cette étape ?
    // Décidé AVANT d'écrire quoi que ce soit (voir docstring, « L'échéance et
    // le rejeu ne visent JAMAIS la même étape ») : une inscription
    // `paused_absence` « normale » n'a ici aucune action bloquée à trouver.
    let ligneBloquee: { id: string; deja_envoyee: boolean } | undefined;
    if (etapeId) {
      const cle = actionIdempotencyKey(candidat.id, etapeId);
      const bloquee = await pool.query<{ id: string; deja_envoyee: boolean }>(
        `select id, (payload ->> 'message_id') is not null as deja_envoyee
           from actions
          where idempotency_key = $1 and organization_id = $2 and status in ('blocked', 'failed')`,
        [cle, candidat.organization_id],
      );
      ligneBloquee = bloquee.rows[0];
    }

    let ecrit = false;
    let etapeRejouee = false;
    if (etapeId && ligneBloquee && !ligneBloquee.deja_envoyee) {
      // Rejeu de l'étape bloquée (paused -> paused_absence direct) : le délai
      // repart entièrement depuis le retour (règle produit, F10) — jamais
      // `now()`, qui ferait partir le message le jour même, exactement ce que
      // l'absence devait empêcher (voir docstring, défaut 2 de la revue).
      // L'échéance de l'inscription n'est PAS posée ici (défaut 1) : le
      // départ réel de cette action, une fois `scheduled_for` atteint, la
      // posera lui-même via `poserEcheanceApresDepart`.
      const echeanceRejeu =
        echeanceEtapeSuivante(new Date(candidat.resume_at).getTime(), candidat.id, delayHeures ?? 0) ??
        new Date(candidat.resume_at).getTime();
      const cle = actionIdempotencyKey(candidat.id, etapeId);
      const rejeu = await pool.query(
        `update actions
            set status = 'scheduled', scheduled_for = $3, error = null, block_reason = null
          where idempotency_key = $1 and organization_id = $2 and status in ('blocked', 'failed')`,
        [cle, candidat.organization_id, new Date(echeanceRejeu).toISOString()],
      );
      etapeRejouee = (rejeu.rowCount ?? 0) > 0;
    } else if (etapeId) {
      // Cas normal (aucune action bloquée à cette étape), ou l'action
      // bloquée porte déjà une preuve d'envoi (garde M3) : rien à rejouer,
      // l'échéance de l'inscription se pose comme avant.
      ecrit = await poserEcheanceDepuisDispatch(
        pool,
        { enrollmentId: candidat.id, campaignId: candidat.campaign_id, currentStep: candidat.current_step },
        candidat.resume_at,
      );
    }

    try {
      await ecrireEvenement(pool, {
        organisationId: candidat.organization_id,
        entityType: 'contact',
        entityId: candidat.contact_id,
        action: 'enrollment_resumed',
        diff: { libelle: 'Inscription reprise après absence.', campagneId: candidat.campaign_id },
      });
    } catch (err) {
      console.warn('[journal] enrollment_resumed', err);
    }

    if (ecrit || etapeRejouee) {
      reprises += 1;
    } else {
      // Repli (trouvé à la relecture) : la séquence a perdu l'étape attendue
      // pendant la pause (étape supprimée de la campagne) — ni
      // `poserEcheanceDepuisDispatch` (aucun `delay_hours` à lire) ni le
      // rejeu ci-dessus (aucune action bloquée à cette étape) n'ont pu agir.
      // Sans repli, l'inscription resterait `active` avec `next_action_at =
      // null` : invisible du tick (`next_action_at <= now` exclut NULL en
      // SQL) ET de `rattraperEcheancesManquantes` (qui bute sur le même
      // problème en silence) — pire qu'en retard, elle disparaîtrait pour de
      // bon. Même repli que `reprendreInscription` (`?? Date.now()`,
      // `fonctions/sequence.ts`) : `next_action_at = now()` la rend à
      // nouveau due, et le tick suivant la referme proprement via la borne
      // déjà gérée par `composeTick` (`currentStep >= steps.length` ->
      // `completed`) — aucun nouveau cas à traiter côté tick.
      await pool.query(
        `update enrollments
            set next_action_at = now()
          where id = $1 and status = 'active' and next_action_at is null`,
        [candidat.id],
      );
      reprises += 1;
      console.warn(
        `[tick] absence ${candidat.id} réactivée sans échéance ni étape en attente (étape supprimée pendant la pause ?) — reprise immédiate pour rester rattrapable`,
      );
    }
  }
  if (reprises > 0) {
    console.log(`[tick] ${reprises} inscription(s) reprise(s) après absence : échéance recalculée depuis le retour`);
  }
}

/**
 * Traite les inscriptions actives dont `next_action_at <= now`. Pour chacune :
 * charge l'étape courante, décide via `composeTick`, insère l'action (idempotente),
 * met à jour l'inscription, et — pour les envois LinkedIn autorisés — prépare un
 * job `actions.dispatch`. Renvoie ces jobs (l'appelant les enfile).
 *
 * `camp.status = 'active'` (F14) : seule porte d'entrée du moteur — une
 * inscription peut exister (import CSV, liste, annuaire, producteur de
 * signaux) sans que sa campagne ait jamais été lancée, ou après qu'elle a été
 * mise en pause ou archivée (`mettreEnPause`/`archiver`, `fonctions/campagnes.ts`,
 * ne touchent QUE `campaigns.status` — jamais les inscriptions elles-mêmes).
 * Avant ce filtre, une campagne brouillon dont l'import venait de créer une
 * inscription `active` avec `next_action_at = now()` (`sources.ts`) partait
 * réellement dès le tick suivant, et une campagne mise en pause continuait
 * d'avancer ses inscriptions déjà en cours. `camp` est déjà joint par
 * `REQUETE_LIGNE_INSCRIPTION` : aucune jointure supplémentaire nécessaire.
 * Les deux traitements ci-dessus (reprise d'absence, rattrapage) ne sont pas
 * concernés : ils ne font que POSER une échéance, jamais envoyer — c'est
 * cette sélection, juste en dessous, qui décide de ce qui part réellement.
 */
export async function tickDueEnrollments(pool: Pool, now: Date = new Date(), limit = 200): Promise<DispatchJob[]> {
  // Reprise des absences échues (F10) AVANT la sélection des inscriptions
  // dues, pour la même raison que le rattrapage juste en dessous : une
  // inscription tout juste réactivée peut devenir due dans CE MÊME passage
  // si son échéance (posée depuis `resume_at`, pas `now`) tombe déjà dans le
  // passé — cas d'un worker resté arrêté pendant tout le retour d'absence.
  await reprendreAbsencesEchues(pool, now);

  // Rattrapage (issue #111) AVANT la sélection des inscriptions dues : une
  // inscription qu'il vient de réactiver peut devenir due dans ce même
  // passage si son échéance rattrapée tombe déjà dans le passé.
  await rattraperEcheancesManquantes(pool);

  const due = await pool.query<DueRow>(
    `${REQUETE_LIGNE_INSCRIPTION}
      where e.status = 'active' and camp.status = 'active'
        and e.next_action_at is not null and e.next_action_at <= $1
      order by e.next_action_at asc
      limit $2`,
    [now.toISOString(), limit],
  );

  const jobs: DispatchJob[] = [];

  // Expéditeurs et liens déjà établis, chargés une fois pour tout le lot.
  const { parOrg: sendersParOrg, contraintes: contraintesSender } = await loadSenders(
    pool,
    [...new Set(due.rows.map((r) => r.organization_id))],
  );
  const bindings = await loadBindings(pool, [...new Set(due.rows.map((r) => r.contact_id))]);
  const extraitsParOrg = await loadSnippets(pool, [...new Set(due.rows.map((r) => r.organization_id))]);
  const comptesTouches = await loadAccountsContactedToday(
    pool,
    [...new Set(due.rows.map((r) => r.organization_id))],
  );

  // Patterns de domaine, pour que le gate puisse juger un email non explicitement
  // délivrable. Chargés par organisation : un pattern déduit chez l'une ne dit
  // rien des envois de l'autre.
  const patternsParOrg = new Map<string, Map<string, DomainPattern>>();
  for (const org of new Set(due.rows.map((r) => r.organization_id))) {
    const domaines = due.rows
      .filter((r) => r.organization_id === org)
      .map((r) => domainOf(r.email))
      .filter((d): d is string => d !== null);
    patternsParOrg.set(org, await loadDomainPatterns(pool, org, domaines));
  }

  // I2 (revue finale du 17/09) : le défaut d'organisation de la relecture des
  // premiers envois ne change pas pendant un passage — une lecture par
  // organisation suffit pour tout le lot. Le nombre déjà parti, lui, est par
  // étape : plusieurs inscriptions dues partagent souvent la même étape.
  const seuilDefautRelectureParOrg = new Map<string, number>();
  const dejaPartisParEtape = new Map<string, number>();

  for (const row of due.rows) {
    const stepsRes = await pool.query<StepRow>(
      `select id, channel, delay_hours, template_parent_id
         from sequence_steps where campaign_id = $1 order by position asc`,
      [row.campaign_id],
    );
    const steps: TickStep[] = stepsRes.rows.map((s) => ({ id: s.id, channel: s.channel, delayHours: s.delay_hours }));
    const step = stepsRes.rows[row.current_step];

    // Garde (issue #111) : une inscription due dont l'action de l'étape
    // PRÉCÉDENTE n'est encore ni `dispatched` ni `delivered` (encore
    // `scheduled`, ou `failed`/`blocked`) n'avance pas. Ne doit plus se
    // produire une fois l'échéance posée au départ réel (1 et 2 ci-dessus),
    // mais protège les inscriptions déjà en base au déploiement (échéance
    // posée à la création, avant ce correctif) et les rejeux — jamais
    // d'exception, l'inscription est laissée telle quelle pour le prochain tick.
    if (row.current_step > 0) {
      const etapePrecedente = stepsRes.rows[row.current_step - 1];
      if (etapePrecedente) {
        const precedente = await pool.query<{ status: string }>(
          `select status from actions where enrollment_id = $1 and step_id = $2`,
          [row.id, etapePrecedente.id],
        );
        const statutPrecedent = precedente.rows[0]?.status;
        if (statutPrecedent !== 'dispatched' && statutPrecedent !== 'delivered') {
          console.warn(
            `[tick] inscription ${row.id} due mais l'action de l'étape précédente n'est pas partie (statut ${statutPrecedent ?? 'introuvable'}) — ignorée`,
          );
          continue;
        }
      }
    }

    // Envoyabilité + validation + suppression, selon le canal de l'étape courante.
    let sendable = true;
    let requiresApproval = false;
    let messageBody: string | null = null;
    let templateId: string | null = null;
    let unresolvedVariables: string[] = [];
    let missingLocale = false;
    if (step) {
      const ch = step.channel;
      requiresApproval =
        ch === 'letter' ||
        (isLinkedIn(ch) && row.lk_mode === 'manual') ||
        policyRequiresApproval(row.approval_policy, ch);
      // I2 (revue finale du 17/09) : les deux mécanismes se cumulent — l'un OU
      // l'autre suffit à mettre l'action en attente. Court-circuité si une
      // approbation est déjà requise, pour ne pas compter les envois déjà
      // partis en pure perte.
      if (!requiresApproval) {
        const parRelecture = await relecturePremiersEnvoisRequise(
          pool,
          row,
          step.id,
          seuilDefautRelectureParOrg,
          dejaPartisParEtape,
        );
        requiresApproval = parRelecture;
        // Important (tour de correction 1, revue du 17/09) : CETTE inscription
        // vient de consommer un des N premiers envois de l'étape (elle passe
        // en relecture) — il faut le compter tout de suite pour les
        // inscriptions SUIVANTES du même passage sur la même étape, sans
        // attendre qu'un humain l'approuve et qu'elle atteigne réellement
        // `dispatched`/`delivered` en base (qui n'arrive qu'au dispatch, plus
        // tard — cf. `chargerContraintesSender` ci-dessus, même distinction
        // pour un cache voisin). Sans cet incrément, un lancement de campagne
        // où plusieurs inscriptions dues partagent la même étape ferait
        // TOUTES passer en relecture, pas seulement les N premières. Jamais
        // incrémenté pour une autre raison (lettre, LinkedIn manuel,
        // politique d'approbation) : ces actions-là ne consomment pas le
        // quota de relecture — la fonction n'est même pas appelée pour elles
        // (court-circuitée juste au-dessus). Jamais incrémenté non plus
        // quand l'étape est déjà au-delà du seuil (`parRelecture` faux) :
        // le compteur est déjà à son maximum utile, l'incrémenter encore ne
        // changerait aucune décision suivante.
        if (parRelecture) {
          dejaPartisParEtape.set(step.id, (dejaPartisParEtape.get(step.id) ?? 0) + 1);
        }
      }
      if (isLinkedIn(ch)) sendable = Boolean(row.linkedin_url);
      else if (ch === 'email') sendable = Boolean(row.email);
      // Rendu local des variables pour les canaux dont Jay Reach possède le corps
      // ici, dans le tick (invitation LinkedIn, message LinkedIn, courrier). L'invitation y
      // figure : sans rendu sa note était jetée en silence et l'invitation partait nue, alors
      // que l'écran promet qu'une note non portée ne part pas (« un message altéré ne part
      // pas »). Rendue, la note arrive au handler d'envoi, qui la refuse (`note_non_supportee`). L'email est aussi rendu
      // par Jay Reach (`jr_subject`/`jr_body`), mais au moment de l'envoi
      // (`envoyerEmailSalesBlink`), pas ici : voir `message-values.ts`.
      if ((ch === 'linkedin_invite' || ch === 'linkedin_message' || ch === 'letter') && step.template_parent_id) {
        const resolved = await resolveTemplate(pool, step.template_parent_id, row.locale);
        if (resolved.missingLocale) {
          missingLocale = true;
        } else if (resolved.body !== null) {
          templateId = resolved.id;
          const rendered = renderTemplate(
            resolved.body,
            buildMessageValues(row, extraitsParOrg.get(row.organization_id)),
          );
          messageBody = rendered.text;
          unresolvedVariables = rendered.missing;
        }
      }
    }
    const suppressed = await hasActiveSuppression(pool, row);

    // Garde-fous d'envoi (T18). Interrogés AVANT `composeTick` : un report ne
    // doit pas faire avancer l'inscription, alors que composer l'avance.
    if (step) {
      const dejaTouche = row.account_id ? comptesTouches.get(row.account_id) : undefined;
      const prochainCreneauCompte = dejaTouche?.prochainCreneau;

      // Contraintes portées par l'expéditeur qui sera retenu : fenêtre horaire et
      // quotas. On résout ici — avant d'émettre — parce que ce sont ses horaires
      // et son quota qui décident si l'envoi peut avoir lieu maintenant.
      const kindPrevu = senderKindFor(step.channel);
      const senderPrevu = kindPrevu
        ? resolveSender(row.contact_id, kindPrevu, sendersParOrg.get(row.organization_id) ?? [], bindings)
        : null;
      const c = senderPrevu?.senderId ? contraintesSender.get(senderPrevu.senderId) : undefined;

      let creneauOuvre: number | null = null;
      let quotaRestant: number | undefined;
      let quotaResetAt: number | undefined;
      if (c) {
        const decale = shiftIntoBusinessHours(
          now.getTime(),
          heuresOuvrees(c.businessHours),
          decalageFuseau(c.timezone, now),
        );
        // `shiftIntoBusinessHours` rend l'instant inchangé quand il est déjà dans
        // la fenêtre : une différence signifie donc « hors créneau ».
        if (decale > now.getTime()) creneauOuvre = decale;

        const restant = quotaSenderRestant(c);
        if (Number.isFinite(restant)) {
          quotaRestant = restant;
          // Le quota horaire se libère à l'heure suivante, le journalier demain.
          const restantHeure = c.hourlyQuota !== null ? Math.max(0, c.hourlyQuota - c.usedThisHour) : Infinity;
          const restantJour = c.dailyQuota !== null ? Math.max(0, c.dailyQuota - c.usedToday) : Infinity;
          quotaResetAt =
            restantHeure <= restantJour
              ? new Date(now).setMinutes(60, 0, 0)
              : new Date(now).setHours(24, 0, 0, 0);
        }
      }

      const decision = runGuards({
        channel: step.channel,
        now: now.getTime(),
        killSwitch: row.sending_paused_at !== null,
        personaContactedToday: row.persona_id !== null && dejaTouche?.personas.has(row.persona_id) === true,
        accountPeopleToday: dejaTouche?.personnes ?? 0,
        accountPeopleCap: PERSONNES_PAR_ENTREPRISE_ET_PAR_JOUR,
        ...(prochainCreneauCompte !== undefined ? { nextAccountSlot: prochainCreneauCompte } : {}),
        ...(quotaRestant !== undefined ? { quotaRemaining: quotaRestant } : {}),
        ...(quotaResetAt !== undefined ? { quotaResetAt } : {}),
        businessHoursNextSlot: creneauOuvre,
      });

      if (decision.kind === 'defer') {
        // Rien n'est émis : on repousse la date due. L'inscription reprendra
        // d'elle-même au créneau indiqué, sans perdre son étape.
        await pool.query(`update enrollments set next_action_at = $2 where id = $1`, [
          row.id,
          new Date(decision.until).toISOString(),
        ]);
        console.log(`[tick] inscription ${row.id} reportée — ${decision.reason}`);
        continue;
      }

      if (decision.kind === 'block') {
        // L'action est bloquée mais l'inscription reste vivante : lever l'arrêt
        // global ou corriger la cause suffit à la voir repartir.
        await pool.query(
          `insert into actions (organization_id, enrollment_id, step_id, channel, status, block_reason, idempotency_key)
           values ($1, $2, $3, $4, 'blocked', $5, $6)
           on conflict (idempotency_key) do nothing`,
          [
            row.organization_id,
            row.id,
            step.id,
            step.channel,
            decision.reason,
            actionIdempotencyKey(row.id, step.id),
          ],
        );
        console.warn(`[tick] inscription ${row.id} bloquée — ${decision.reason}`);
        continue;
      }
    }

    const result = composeTick({
      now: now.getTime(),
      enrollmentId: row.id,
      currentStep: row.current_step,
      steps,
      suppressed,
      requiresApproval,
      sendable,
      unresolvedVariables,
      missingLocale,
    });

    // Attribution de l'expéditeur (docs/04), UNIQUEMENT quand un envoi va vraiment
    // avoir lieu. Une action bloquée (suppression, variable manquante) ou en attente
    // d'approbation ne consomme pas d'expéditeur : exiger un expéditeur pour elle
    // mettrait l'inscription en pause au lieu de produire le blocage attendu.
    // Le lien est à vie par canal — sinon la relance arrive d'un inconnu et le fil
    // de discussion est cassé.
    let senderId: string | null = null;
    let nouveauLien = false;
    const kind = result.dispatch && result.action ? senderKindFor(result.action.channel) : null;
    if (kind) {
      const resolution = resolveSender(
        row.contact_id,
        kind,
        sendersParOrg.get(row.organization_id) ?? [],
        bindings,
      );
      if (resolution.paused) {
        // Expéditeur lié devenu inactif, ou aucun disponible : pause avec un motif
        // lisible, jamais de réattribution silencieuse. L'inscription reprendra
        // quand un expéditeur du bon type sera de nouveau actif.
        await pool.query(
          `update enrollments set status = 'paused', next_action_at = null,
                                  stop_reason = coalesce(stop_reason, $2)
            where id = $1 and status = 'active'`,
          [row.id, `sender_unavailable:${kind}`],
        );
        console.warn(`[tick] inscription ${row.id} en pause : aucun expéditeur ${kind} disponible`);
        continue;
      }
      senderId = resolution.senderId;
      nouveauLien = resolution.newBinding;
    }

    // Insertion idempotente de l'action (si présente). L'avancement de
    // l'inscription n'a lieu QUE si l'action est réellement insérée (rejeu sûr).
    let inserted = true;
    // Identifiant de l'action emise, transmis au dispatch pour qu'il puisse la
    // marquer partie et enregistrer son resultat.
    let actionId: string | null = null;
    if (result.action) {
      const a = result.action;
      const payload: Record<string, unknown> = isLinkedIn(a.channel)
        ? { linkedinUrl: row.linkedin_url, messageBody }
        : a.channel === 'email'
          ? { email: row.email }
          : { messageBody }; // courrier : corps rendu localement
      // Blocage variable : on nomme les champs manquants (UI : regroupement).
      if (a.blockReason === 'missing_variable') payload.missingVariables = unresolvedVariables;
      const ins = await pool.query<{ id: string }>(
        `insert into actions
           (organization_id, enrollment_id, step_id, channel, status, block_reason, scheduled_for, dispatch_after, payload, idempotency_key, template_id, sender_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
         on conflict (idempotency_key) do nothing
         returning id`,
        [
          row.organization_id,
          row.id,
          a.stepId,
          a.channel,
          a.status,
          a.blockReason ?? null,
          new Date(a.scheduledForMs).toISOString(),
          // `dispatch_after` recule la remise au provider sans toucher à
          // `scheduled_for` : un courrier qui doit arriver mardi part vendredi,
          // mais la date promise au destinataire reste mardi.
          new Date(applyLeadTime(a.scheduledForMs, LEAD_TIME_HEURES[a.channel] ?? 0)).toISOString(),
          JSON.stringify(payload),
          a.idempotencyKey,
          templateId,
          senderId,
        ],
      );
      inserted = (ins.rowCount ?? 0) > 0;
      actionId = ins.rows[0]?.id ?? null;

      // Le lien n'est écrit qu'une fois l'action réellement insérée : sur un rejeu,
      // l'action existe déjà et il ne faut surtout pas relier le contact à un autre
      // expéditeur. `on conflict do nothing` rend l'écriture idempotente et laisse
      // gagner le premier lien en cas de tick concurrent.
      if (inserted && nouveauLien && senderId && kind) {
        await pool.query(
          `insert into contact_sender_bindings (contact_id, sender_id, sender_kind)
           values ($1, $2, $3)
           on conflict (contact_id, sender_kind) do nothing`,
          [row.contact_id, senderId, kind],
        );
      }
    }

    if (!inserted) {
      // Garde-fou (revue transversale, lot 2) : une clé d'idempotence déjà
      // prise pour `current_step` est normalement un rejeu bénin (tick
      // concurrent). Mais c'est EXACTEMENT la signature d'une inscription
      // restée bloquée sans progression (défaut 1 : `next_action_at` posé en
      // double avec le rejeu d'une action) — sans trace, elle revenait ici en
      // boucle, indéfiniment, sans qu'aucun journal ne le dise.
      console.warn(
        `[tick] inscription ${row.id} due mais l'action de l'étape ${row.current_step} existe déjà — ignorée (rejeu concurrent, ou inscription bloquée sans progression)`,
      );
      continue; // déjà traité par un tick précédent
    }

    // L'échéance de l'étape suivante n'est plus calculée ici (issue #111) :
    // `composeTick` renvoie toujours `null` pour une action tout juste créée
    // `scheduled` (branches `blocked`/`pending_approval`/dernière étape le
    // valaient déjà) — elle attend le départ réel de CETTE action, posé par
    // `poserEcheanceApresDepart` depuis le gestionnaire d'envoi concerné.
    const prochaineEcheance = result.nextActionAtMs;

    // Avancement de l'inscription.
    const terminal = result.nextStatus === 'completed' || result.nextStatus === 'stopped';
    await pool.query(
      `update enrollments
          set current_step = $2,
              status = $3,
              next_action_at = $4,
              stop_reason = coalesce($5, stop_reason),
              ended_at = case when $6 then now() else ended_at end
        where id = $1`,
      [
        row.id,
        result.nextStep,
        result.nextStatus,
        prochaineEcheance !== null ? new Date(prochaineEcheance).toISOString() : null,
        result.stopReason,
        terminal,
      ],
    );

    // Envoi LinkedIn autorisé → job de dispatch (l'appelant l'enfile).
    if (result.dispatch && result.action && isLinkedIn(result.action.channel)) {
      const channel = result.action.channel as 'linkedin_invite' | 'linkedin_message';
      jobs.push({
        organizationId: row.organization_id,
        channel,
        actionId,
        linkedin: {
          linkedinUrl: row.linkedin_url as string,
          actionId,
          contactId: row.contact_id,
          signalId: row.signal_id,
          messageBody,
        },
      });
    }

    // Envoi email autorisé → job de dispatch SalesBlink. Le tick ne fait que
    // décider l'éligibilité (gate de délivrabilité) et transmettre des
    // références : le rendu (gabarit, variables) et la résolution des objets
    // SalesBlink (séquence, liste) ont lieu à l'envoi (`envoyerEmailSalesBlink`),
    // pas ici — sans quoi un corps rendu attendrait dans la file pendant que
    // la langue ou les variables auraient pu changer entre-temps.
    if (result.dispatch && result.action && result.action.channel === 'email') {
      if (row.email) {
        // Gate de délivrabilité : un email non vérifié `valid` n'est JAMAIS poussé
        // (protection de la réputation du domaine). Le gate refuse par défaut
        // tout ce qui n'est pas explicitement délivrable. `construireEntreeGate`
        // (`message-values.ts`) est partagée avec l'envoi (`email-salesblink.ts`,
        // B2, revue finale du 14/09) : les deux appelants ne peuvent plus
        // diverger sur la construction de l'entrée du gate, seul le pattern de
        // domaine change de source (ici, déjà chargé en lot pour tout le
        // passage — pas de requête par ligne dans cette boucle).
        const gate = emailGateAllows(
          construireEntreeGate(
            {
              organizationId: row.organization_id,
              email: row.email,
              emailStatus: row.email_status,
              firstName: row.first_name,
              lastName: row.last_name,
            },
            // Le pattern du domaine, quand on en a un. C'est lui qui permet au gate
            // de laisser passer un email `risky` — un CATCH_ALL, par exemple — sur
            // un domaine dont on connaît la convention d'adresse. Codé à `null`
            // jusqu'ici, ce qui condamnait ces contacts sans les compter.
            patternsParOrg.get(row.organization_id)?.get(domainOf(row.email) ?? '') ?? null,
          ),
        );
        if (gate.allow) {
          jobs.push({
            organizationId: row.organization_id,
            channel: 'email',
            actionId,
            email: {
              enrollmentId: row.id,
              contactId: row.contact_id,
              stepId: step!.id,
              campaignId: row.campaign_id,
              templateParentId: step!.template_parent_id,
              senderId,
              locale: row.locale,
            },
          });
        } else {
          // Email non délivrable → action bloquée, rien ne part. L'inscription
          // est mise en pause SUR L'ÉTAPE BLOQUÉE (`row.current_step`, pas
          // `result.nextStep` déjà écrit ci-dessus) : sans ça, le tick suivant
          // tente l'étape suivante, bloquée à son tour, et ainsi de suite
          // jusqu'à `completed` sans qu'un seul email ne parte jamais.
          const motif = `email_gate:${gate.reason}`;
          await pool.query(
            `update actions set status = 'blocked', block_reason = $2 where idempotency_key = $1`,
            [result.action.idempotencyKey, motif],
          );
          await mettreInscriptionEnPause(pool, row.id, row.current_step, motif);
          console.warn(
            `[tick] email du contact ${row.contact_id} NON poussé (gate: ${gate.reason}) — inscription ${row.id} en pause`,
          );
        }
      }
    }
  }

  return jobs;
}

/** Une suppression active couvre-t-elle ce contact ? (email / linkedin / compte) */
async function hasActiveSuppression(pool: Pool, row: DueRow): Promise<boolean> {
  const res = await pool.query<{ n: number }>(
    `select count(*)::int as n from suppressions
      where organization_id = $1
        and (expires_at is null or expires_at > now())
        and (
          (scope = 'email' and value = $2) or
          (scope = 'linkedin' and lower(value) = lower($3)) or
          (scope = 'account' and value = $4)
        )`,
    [row.organization_id, row.email, row.linkedin_url, row.account_id],
  );
  return (res.rows[0]?.n ?? 0) > 0;
}
