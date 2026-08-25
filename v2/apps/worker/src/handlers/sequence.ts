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
import { composeTick, renderTemplate, type TickChannel, type TickStep } from '@jay-reach/core';
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
  readonly account_id: string | null;
  readonly approval_policy: unknown;
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

/** La politique d'approbation de la campagne exige-t-elle ce canal ? */
function policyRequiresApproval(policy: unknown, channel: TickChannel): boolean {
  if (!policy || typeof policy !== 'object') return false;
  const p = policy as { mode?: unknown; channels?: unknown };
  if (p.mode === 'all') return true;
  if (Array.isArray(p.channels) && p.channels.includes(channel)) return true;
  return false;
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
            c.linkedin_url, c.email, c.account_id, c.first_name, c.last_name,
            c.locale, c.job_title,
            camp.approval_policy,
            sc.campaign_id as smartlead_campaign_id,
            a.name as company_name, a.domain, a.city, a.headcount,
            p.angle as persona_angle,
            sig.title as signal_title, sig.occurred_at as signal_occurred_at, sig.location as signal_location,
            lst.context_note,
            ls.mode as lk_mode
       from enrollments e
       join contacts c on c.id = e.contact_id
       join campaigns camp on camp.id = e.campaign_id
       left join accounts a on a.id = c.account_id
       left join personas p on p.id = c.persona_id
       left join signals sig on sig.id = e.signal_id
       left join lists lst on lst.id = camp.list_id
       left join smartlead_campaigns sc
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

    // Insertion idempotente de l'action (si présente). L'avancement de
    // l'inscription n'a lieu QUE si l'action est réellement insérée (rejeu sûr).
    let inserted = true;
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
           (organization_id, enrollment_id, step_id, channel, status, block_reason, scheduled_for, payload, idempotency_key, template_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
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
          JSON.stringify(payload),
          a.idempotencyKey,
          templateId,
        ],
      );
      inserted = (ins.rowCount ?? 0) > 0;
    }

    if (!inserted) {
      continue; // déjà traité par un tick précédent
    }

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
        result.nextActionAtMs ? new Date(result.nextActionAtMs).toISOString() : null,
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
        linkedin: {
          linkedinUrl: row.linkedin_url as string,
          contactId: row.contact_id,
          signalId: row.signal_id,
          messageBody,
          method: 'extension_auto',
        },
      });
    }

    // Envoi email autorisé → job de dispatch Smartlead. La campagne est résolue
    // PAR PERSONA du contact (mapping `smartlead_campaigns` activé). Sans mapping
    // activé pour la persona, l'action reste planifiée mais n'est pas dispatchée :
    // on ne pousse jamais vers une campagne inconnue.
    if (result.dispatch && result.action && result.action.channel === 'email') {
      if (row.smartlead_campaign_id && row.email) {
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
