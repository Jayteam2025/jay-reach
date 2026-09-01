/**
 * Files `sequence.enroll` et `sequence.tick` : inscription d'un contact dans une
 * campagne, et avancement des inscriptions dues (émission d'actions idempotentes
 * + enfilement des envois). La décision par étape est pure (`composeTick` de
 * @jay-reach/core) ; ici on fait les I/O SQL et on renvoie les jobs d'envoi.
 *
 * Aucun envoi réel ici : les actions LinkedIn émises partent vers `actions.dispatch`,
 * qui les enfile dans `linkedin_action_queue` (exécutée par l'extension, pacing serveur).
 */
import type { Pool } from 'pg';
import {
  actionIdempotencyKey,
  composeTick,
  runGuards,
  renderTemplate,
  resolveSender,
  shiftIntoBusinessHours,
  applyLeadTime,
  jitterMs,
  type BusinessHours,
  type Binding,
  type SenderInfo,
  type TickChannel,
  type TickStep,
} from '@jay-reach/core';
import { shouldPushToSmartlead } from '@jay-reach/providers/email-validation';
import { loadDomainPatterns, domainOf, type DomainPattern } from '../domain-patterns.js';
import type { EmailStatus } from '../enrichment-persist.js';
import type { DispatchJob } from './dispatch.js';



export interface EnrollJob {
  readonly organizationId: string;
  readonly campaignId: string;
  readonly contactId: string;
  readonly signalId?: string | null;
}

/**
 * Inscrit un contact dans une campagne. Dédup par l'index partiel
 * `enrollments_one_active_uidx` (une seule inscription vivante par contact) :
 * `on conflict do nothing`. Première action due immédiatement (tick suivant).
 * Retourne l'id créé, ou null si le contact a déjà une inscription active.
 */
export async function enrollContact(pool: Pool, job: EnrollJob): Promise<string | null> {
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

interface DueRow {
  readonly id: string;
  readonly organization_id: string;
  readonly campaign_id: string;
  readonly contact_id: string;
  readonly signal_id: string | null;
  readonly current_step: number;
  readonly linkedin_url: string | null;
  readonly email: string | null;
  readonly email_status: EmailStatus | null;
  readonly account_id: string | null;
  readonly persona_id: string | null;
  readonly approval_policy: unknown;
  /** Arrêt global des envois de l'organisation (garde-fou prioritaire). */
  readonly sending_paused_at: string | null;
  readonly lk_mode: 'auto' | 'hybrid' | 'manual' | null;
  // Canal email (Smartlead) : id de campagne résolu PAR PERSONA (mapping activé),
  // + champs du lead.
  readonly smartlead_campaign_id: string | null;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly company_name: string | null;
  readonly domain: string | null;
  // Résolution des variables du message (T19) : langue du contact + données
  // source pour substituer {{prenom}}, {{entreprise}}, {{signal_titre}}, etc.
  readonly locale: string | null;
  readonly job_title: string | null;
  readonly city: string | null;
  readonly headcount: number | null;
  readonly persona_angle: string | null;
  readonly signal_title: string | null;
  readonly signal_occurred_at: string | null;
  readonly signal_location: string | null;
  readonly context_note: string | null;
}

/**
 * Table des valeurs pour le rendu des variables d'un message, assemblée depuis le
 * contact, son compte, sa persona, le signal et la liste. Une valeur absente reste
 * `undefined` → `renderTemplate` la remonte dans `missing` (→ blocage, jamais un
 * champ vide envoyé). Dates via `Intl` (spec §90).
 */
function buildMessageValues(row: DueRow): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {
    prenom: row.first_name ?? undefined,
    nom: row.last_name ?? undefined,
    poste: row.job_title ?? undefined,
    entreprise: row.company_name ?? undefined,
    ville: row.city ?? undefined,
    effectif: row.headcount != null ? String(row.headcount) : undefined,
    persona_angle: row.persona_angle ?? undefined,
    signal_titre: row.signal_title ?? undefined,
    signal_zone: row.signal_location ?? undefined,
    contexte: row.context_note ?? undefined,
  };
  if (row.signal_occurred_at) {
    const d = new Date(row.signal_occurred_at);
    values.signal_date = d.toLocaleDateString('fr-FR');
    values.signal_mois = d.toLocaleDateString('fr-FR', { month: 'long' });
  }
  return values;
}

/**
 * Résout la variante de template pour la langue du contact (T19). Choisit la
 * dernière version de la famille pour cette `locale`. Si la langue est connue mais
 * qu'aucune variante n'existe alors que la famille en a d'autres → `missingLocale`
 * (spec §84-88 : bloqué `missing_locale`). Sans locale connue, on prend la dernière
 * version (repli, pas de blocage de langue).
 */
async function resolveTemplate(
  pool: Pool,
  familyId: string,
  locale: string | null,
): Promise<{ id: string | null; body: string | null; missingLocale: boolean }> {
  if (locale) {
    // Version EN VIGUEUR (`is_active`) pour cette langue — permet le retour arrière
    // (une version antérieure réactivée prime sur une plus récente désactivée).
    const byLocale = await pool.query<{ id: string; body: string }>(
      `select id, body from message_templates
        where (id = $1 or parent_id = $1) and locale = $2 and is_active
        order by version desc limit 1`,
      [familyId, locale],
    );
    const found = byLocale.rows[0];
    if (found) return { id: found.id, body: found.body, missingLocale: false };
    const any = await pool.query(
      `select 1 from message_templates where id = $1 or parent_id = $1 limit 1`,
      [familyId],
    );
    return { id: null, body: null, missingLocale: (any.rowCount ?? 0) > 0 };
  }
  const latest = await pool.query<{ id: string; body: string }>(
    `select id, body from message_templates
      where (id = $1 or parent_id = $1) and is_active order by version desc limit 1`,
    [familyId],
  );
  const found = latest.rows[0];
  return { id: found?.id ?? null, body: found?.body ?? null, missingLocale: false };
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
 */
function senderKindFor(channel: TickChannel): 'email' | 'linkedin' | 'postal' | null {
  if (channel === 'email') return 'email';
  if (isLinkedIn(channel)) return 'linkedin';
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
                and act.created_at >= date_trunc('day', now())) as used_today,
            (select count(*)::int from actions act
              where act.sender_id = s.id
                and act.created_at >= date_trunc('hour', now())) as used_this_hour
       from senders s
      where s.organization_id = any($1::uuid[])`,
    [organizationIds],
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
interface ContraintesSender {
  readonly usedToday: number;
  readonly usedThisHour: number;
  readonly dailyQuota: number | null;
  readonly hourlyQuota: number | null;
  readonly timezone: string | null;
  readonly businessHours: unknown;
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

/** Espacement toléré autour de la date prévue : ±20 % (docs/04). */
const RATIO_JITTER = 0.2;

/**
 * Graine déterministe tirée d'un identifiant. Le jitter doit disperser les
 * envois sans être imprévisible : rejouer un tick doit redonner la même date,
 * sinon une reprise après incident déplacerait toutes les échéances.
 */
function graine(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

/**
 * Traite les inscriptions actives dont `next_action_at <= now`. Pour chacune :
 * charge l'étape courante, décide via `composeTick`, insère l'action (idempotente),
 * met à jour l'inscription, et — pour les envois LinkedIn autorisés — prépare un
 * job `actions.dispatch`. Renvoie ces jobs (l'appelant les enfile).
 */
export async function tickDueEnrollments(pool: Pool, now: Date = new Date(), limit = 200): Promise<DispatchJob[]> {
  const due = await pool.query<DueRow>(
    `select e.id, e.organization_id, e.campaign_id, e.contact_id, e.signal_id, e.current_step,
            c.linkedin_url, c.email, c.email_status, c.account_id, c.persona_id, c.first_name, c.last_name,
            c.locale, c.job_title,
            camp.approval_policy,
            org.sending_paused_at,
            sc.campaign_id as smartlead_campaign_id,
            a.name as company_name, a.domain, a.city, a.headcount,
            p.angle as persona_angle,
            sig.title as signal_title, sig.occurred_at as signal_occurred_at, sig.location as signal_location,
            lst.context_note,
            ls.mode as lk_mode
       from enrollments e
       join contacts c on c.id = e.contact_id
       join campaigns camp on camp.id = e.campaign_id
       join organizations org on org.id = e.organization_id
       left join accounts a on a.id = c.account_id
       left join personas p on p.id = c.persona_id
       left join signals sig on sig.id = e.signal_id
       left join lists lst on lst.id = camp.list_id
       left join smartlead_campaign_mappings sc
              on sc.organization_id = e.organization_id
             and sc.persona_id = c.persona_id
             and sc.enabled
       left join linkedin_settings ls on ls.organization_id = e.organization_id
      where e.status = 'active' and e.next_action_at is not null and e.next_action_at <= $1
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

  for (const row of due.rows) {
    const stepsRes = await pool.query<StepRow>(
      `select id, channel, delay_hours, template_parent_id
         from sequence_steps where campaign_id = $1 order by position asc`,
      [row.campaign_id],
    );
    const steps: TickStep[] = stepsRes.rows.map((s) => ({ id: s.id, channel: s.channel, delayHours: s.delay_hours }));
    const step = stepsRes.rows[row.current_step];

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
      if (isLinkedIn(ch)) sendable = Boolean(row.linkedin_url);
      else if (ch === 'email') sendable = Boolean(row.email);
      // Rendu local des variables pour les canaux dont Jay Reach possède le corps
      // (message LinkedIn, courrier). L'email est rendu par Smartlead (leads).
      if ((ch === 'linkedin_message' || ch === 'letter') && step.template_parent_id) {
        const resolved = await resolveTemplate(pool, step.template_parent_id, row.locale);
        if (resolved.missingLocale) {
          missingLocale = true;
        } else if (resolved.body !== null) {
          templateId = resolved.id;
          const rendered = renderTemplate(resolved.body, buildMessageValues(row));
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

        const restantJour = c.dailyQuota !== null ? Math.max(0, c.dailyQuota - c.usedToday) : Infinity;
        const restantHeure = c.hourlyQuota !== null ? Math.max(0, c.hourlyQuota - c.usedThisHour) : Infinity;
        const restant = Math.min(restantJour, restantHeure);
        if (Number.isFinite(restant)) {
          quotaRestant = restant;
          // Le quota horaire se libère à l'heure suivante, le journalier demain.
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
      continue; // déjà traité par un tick précédent
    }

    // Jitter sur la prochaine échéance : sans lui, les relances d'une même
    // campagne tombent toutes à la même minute, ce qui se voit. Déterministe,
    // pour qu'un rejeu ne déplace pas les échéances déjà calculées.
    const prochaineEcheance =
      result.nextActionAtMs !== null
        ? result.nextActionAtMs +
          jitterMs(Math.max(0, result.nextActionAtMs - now.getTime()), RATIO_JITTER, graine(row.id))
        : null;

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
          method: 'extension_auto',
        },
      });
    }

    // Envoi email autorisé → job de dispatch Smartlead. La campagne est résolue
    // PAR PERSONA du contact (mapping `smartlead_campaign_mappings` activé). Sans mapping
    // activé pour la persona, l'action reste planifiée mais n'est pas dispatchée :
    // on ne pousse jamais vers une campagne inconnue.
    if (result.dispatch && result.action && result.action.channel === 'email') {
      if (row.smartlead_campaign_id && row.email) {
        // Gate de délivrabilité : un email non vérifié `valid` n'est JAMAIS poussé
        // vers Smartlead (protection de la réputation du domaine). Le gate refuse
        // par défaut tout ce qui n'est pas explicitement délivrable.
        const gate = shouldPushToSmartlead({
          email: row.email,
          email_source: 'fullenrich',
          email_validation_status: row.email_status,
          deliverability_status: row.email_status ?? null,
          deliverability_reason: null,
          first_name: row.first_name ?? '',
          last_name: row.last_name ?? '',
          // Le pattern du domaine, quand on en a un. C'est lui qui permet au gate
          // de laisser passer un email `risky` — un CATCH_ALL, par exemple — sur
          // un domaine dont on connaît la convention d'adresse. Codé à `null`
          // jusqu'ici, ce qui condamnait ces contacts sans les compter.
          domain_pattern: patternsParOrg.get(row.organization_id)?.get(domainOf(row.email) ?? '') ?? null,
        });
        if (gate.allow) {
          jobs.push({
            organizationId: row.organization_id,
            channel: 'email',
            campaignId: row.smartlead_campaign_id,
            leads: [
              {
                email: row.email,
                ...(row.first_name ? { first_name: row.first_name } : {}),
                ...(row.last_name ? { last_name: row.last_name } : {}),
                ...(row.company_name ? { company_name: row.company_name } : {}),
                ...(row.domain ? { website: row.domain } : {}),
                ...(row.linkedin_url ? { linkedin_profile: row.linkedin_url } : {}),
              },
            ],
          });
        } else {
          // Email non délivrable → action bloquée, rien ne part vers Smartlead.
          await pool.query(
            `update actions set status = 'blocked', block_reason = $2 where idempotency_key = $1`,
            [result.action.idempotencyKey, `email_gate:${gate.reason}`],
          );
          console.warn(`[tick] email du contact ${row.contact_id} NON poussé (gate: ${gate.reason})`);
        }
      } else if (!row.smartlead_campaign_id) {
        console.warn(
          `[tick] étape email du contact ${row.contact_id} sans mapping Smartlead activé pour sa persona — action planifiée mais non dispatchée`,
        );
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
          (scope = 'linkedin' and value = $3) or
          (scope = 'account' and value = $4)
        )`,
    [row.organization_id, row.email, row.linkedin_url, row.account_id],
  );
  return (res.rows[0]?.n ?? 0) > 0;
}
