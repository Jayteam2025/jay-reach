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
import { composeTick, type TickChannel, type TickStep } from '@jay-reach/core';
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
            c.linkedin_url, c.email, c.account_id,
            camp.approval_policy,
            ls.mode as lk_mode
       from enrollments e
       join contacts c on c.id = e.contact_id
       join campaigns camp on camp.id = e.campaign_id
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
    if (step) {
      const ch = step.channel;
      requiresApproval =
        ch === 'letter' ||
        (isLinkedIn(ch) && row.lk_mode === 'manual') ||
        policyRequiresApproval(row.approval_policy, ch);
      if (isLinkedIn(ch)) sendable = Boolean(row.linkedin_url);
      else if (ch === 'email') sendable = Boolean(row.email);
      if (ch === 'linkedin_message' && step.template_parent_id) {
        const tpl = await pool.query<{ body: string }>(
          `select body from message_templates where id = $1 or parent_id = $1 order by version desc limit 1`,
          [step.template_parent_id],
        );
        messageBody = tpl.rows[0]?.body ?? null;
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
    });

    // Insertion idempotente de l'action (si présente). L'avancement de
    // l'inscription n'a lieu QUE si l'action est réellement insérée (rejeu sûr).
    let inserted = true;
    if (result.action) {
      const a = result.action;
      const payload = isLinkedIn(a.channel)
        ? { linkedinUrl: row.linkedin_url, messageBody }
        : { email: row.email };
      const ins = await pool.query<{ id: string }>(
        `insert into actions
           (organization_id, enrollment_id, step_id, channel, status, block_reason, scheduled_for, payload, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
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
