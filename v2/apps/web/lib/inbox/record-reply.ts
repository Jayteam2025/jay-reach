/**
 * Enregistrement d'une réponse entrante, quel que soit le canal.
 *
 * Extrait du traitement du webhook Smartlead, qui était le seul chemin par
 * lequel une réponse pouvait entrer. Une réponse LinkedIn suit exactement les
 * mêmes règles — classer, ouvrir le fil, arrêter l'inscription, notifier — et
 * les dupliquer aurait garanti qu'elles divergent.
 *
 * L'arrêt d'inscription ne filtre jamais par canal : il porte sur le contact.
 * C'est ce qui fait qu'une réponse reçue quelque part interrompt la séquence
 * partout, et cette table `enrollments` n'admet de toute façon qu'une seule
 * inscription vivante par contact.
 */
import type { Pool } from 'pg';
import { classifyReply } from '@jay-reach/core';

/** Statuts d'inscription qu'une réponse peut encore interrompre. */
export const LIVE_STATUSES = "('active','paused','paused_absence')";

export type ReplyChannel = 'email' | 'linkedin_invite' | 'linkedin_message' | 'letter' | 'call';

export interface InboundReply {
  readonly contactId: string;
  readonly channel: ReplyChannel;
  readonly body: string;
  /** Identifiant du message chez le provider, pour ne pas l'enregistrer deux fois. */
  readonly providerMessageId?: string | null;
  readonly headers?: Record<string, unknown> | null;
  readonly raw?: unknown;
  /** Date de réception. Par défaut maintenant. */
  readonly receivedAt?: Date;
}

export interface RecordedReply {
  readonly threadId: string;
  readonly classification: string;
  /** false quand le message était déjà connu : rien n'a été réécrit. */
  readonly isNew: boolean;
}

/** Crée ou actualise le fil du contact sur un canal donné. */
async function upsertThread(
  pool: Pool,
  org: string,
  contactId: string,
  channel: ReplyChannel,
  classification: string,
): Promise<string> {
  const found = await pool.query<{ id: string }>(
    `select id from threads where organization_id = $1 and contact_id = $2 and channel = $3 limit 1`,
    [org, contactId, channel],
  );
  const existing = found.rows[0];
  if (existing) {
    await pool.query(
      `update threads set classification = $2, last_message_at = now(), is_read = false where id = $1`,
      [existing.id, classification],
    );
    return existing.id;
  }
  const created = await pool.query<{ id: string }>(
    `insert into threads (organization_id, contact_id, channel, classification, last_message_at, is_read)
     values ($1, $2, $3, $4, now(), false) returning id`,
    [org, contactId, channel, classification],
  );
  return created.rows[0]!.id;
}

/** Notifie tous les membres de l'organisation (règle non négociable n° 9). */
export async function notifyReply(pool: Pool, org: string, title: string, body: string): Promise<void> {
  await pool.query(
    `insert into notifications (organization_id, user_id, event, payload, channel, sent_at)
     select $1, m.user_id, 'contact.replied', $2::jsonb, 'push', now()
     from memberships m where m.organization_id = $1`,
    [org, JSON.stringify({ title, body })],
  );
}

/**
 * Applique l'effet d'une réponse sur l'inscription du contact. Volontairement
 * sans filtre de canal : une réponse arrête la séquence entière.
 */
async function applyToEnrollment(
  pool: Pool,
  org: string,
  contactId: string,
  classification: string,
  resumeInDays: number | undefined,
): Promise<void> {
  if (classification === 'human_reply') {
    await pool.query(
      `update enrollments set status = 'replied', ended_at = now()
        where organization_id = $1 and contact_id = $2 and status in ${LIVE_STATUSES}`,
      [org, contactId],
    );
    return;
  }
  if (classification === 'auto_absence') {
    const days = resumeInDays ?? 7;
    await pool.query(
      `update enrollments
          set status = 'paused_absence',
              resume_at = now() + ($3 || ' days')::interval,
              next_action_at = now() + ($3 || ' days')::interval
        where organization_id = $1 and contact_id = $2 and status in ${LIVE_STATUSES}`,
      [org, contactId, String(days)],
    );
    return;
  }
  if (classification === 'auto_left_company') {
    await pool.query(
      `update enrollments set status = 'stopped', stop_reason = 'contact_left', ended_at = now()
        where organization_id = $1 and contact_id = $2 and status in ${LIVE_STATUSES}`,
      [org, contactId],
    );
  }
  // auto_other / non classée : le fil existe et l'opérateur est notifié, mais la
  // séquence continue — une signature automatique ne vaut pas une réponse.
}

/**
 * Rattache le résultat au dernier envoi reçu par le contact.
 *
 * `campaign_stats` compte les réponses depuis `outcomes`, pas depuis les fils :
 * sans cet enregistrement, le tableau de bord affichait « Réponses : 0 » tout en
 * listant les réponses juste en dessous, et les statistiques de campagne
 * restaient à zéro sur des échanges bien réels.
 *
 * On vise la dernière action partie, quel que soit son canal : une réponse
 * répond à ce qu'on a envoyé en dernier, et rien ne permet de dire mieux. Sans
 * action partie — un contact importé qui écrit de lui-même, une file alimentée
 * à la main — il n'y a rien à rattacher, et on ne fabrique pas.
 */
async function recordOutcome(
  pool: Pool,
  org: string,
  contactId: string,
  classification: string,
): Promise<void> {
  // Une auto-réponse n'est pas une réponse : la compter fausserait le seul
  // chiffre qui dit si la prospection marche.
  if (classification !== 'human_reply') return;

  await pool.query(
    `insert into outcomes (action_id, type)
     select a.id, 'replied'
       from actions a
       join enrollments e on e.id = a.enrollment_id
      where e.contact_id = $2
        and a.organization_id = $1
        and a.dispatched_at is not null
      order by a.dispatched_at desc
      limit 1
       on conflict (action_id, type) do nothing`,
    [org, contactId],
  );
}

/**
 * Enregistre une réponse entrante et en tire toutes les conséquences.
 *
 * Renvoie `isNew: false` si le message était déjà connu. La relève LinkedIn
 * repasse sur les mêmes conversations à chaque tour : sans cette garde, un seul
 * message rouvrirait le fil et renotifierait l'opérateur indéfiniment.
 */
export async function recordInboundReply(pool: Pool, org: string, reply: InboundReply): Promise<RecordedReply> {
  const cls = classifyReply(reply.body, reply.headers ?? null) ?? { classification: 'human_reply' as const };

  if (reply.providerMessageId) {
    const deja = await pool.query<{ id: string }>(
      `select m.id from thread_messages m
         join threads t on t.id = m.thread_id
        where t.organization_id = $1 and m.provider_message_id = $2 limit 1`,
      [org, reply.providerMessageId],
    );
    if (deja.rows[0]) {
      const fil = await pool.query<{ id: string }>(
        `select thread_id as id from thread_messages where id = $1`,
        [deja.rows[0].id],
      );
      return { threadId: fil.rows[0]!.id, classification: cls.classification, isNew: false };
    }
  }

  const threadId = await upsertThread(pool, org, reply.contactId, reply.channel, cls.classification);
  await pool.query(
    `insert into thread_messages (thread_id, direction, body, provider_message_id, raw, sent_at)
     values ($1, 'in', $2, $3, $4::jsonb, $5)`,
    [
      threadId,
      reply.body,
      reply.providerMessageId ?? null,
      JSON.stringify(reply.raw ?? {}),
      (reply.receivedAt ?? new Date()).toISOString(),
    ],
  );

  await applyToEnrollment(pool, org, reply.contactId, cls.classification, cls.resumeInDays);
  await recordOutcome(pool, org, reply.contactId, cls.classification);

  return { threadId, classification: cls.classification, isNew: true };
}
