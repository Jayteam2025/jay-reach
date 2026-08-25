/**
 * Traitement d'un événement webhook Smartlead entrant (T27, volet réception).
 * Écrit via un pool `pg` (comme les handlers worker) → testable hermétiquement.
 *
 * Règles appliquées :
 *  - **Contact inconnu → RIEN n'est stocké** (docs/06 + CLAUDE.md) : on ne crée
 *    ni thread, ni message, ni suppression, ni notification.
 *  - Réponse humaine → fil + message entrant + arrêt d'inscription + **notification**
 *    (règle #9 : aucune réponse ne passe inaperçue).
 *  - Bounce / désinscription → **suppression** (l'adresse ne sera plus contactée) +
 *    inscription arrêtée (`bounced` / `stopped`).
 *  - Ouverture / clic / envoi → analytics (corrélation à une action requise) :
 *    non traités ici, laissés à un raffinement ultérieur.
 */
import type { Pool } from 'pg';
import { classifyReply, type SmartleadEvent } from '@jay-reach/core';

export type ProcessResult =
  | { readonly stored: false; readonly reason: 'no_email' | 'unknown_contact' | 'ignored' }
  | { readonly stored: true; readonly effect: 'reply' | 'bounce' | 'unsubscribe'; readonly classification?: string };

const LIVE_STATUSES = "('active','paused','paused_absence')";

async function addSuppression(
  pool: Pool,
  org: string,
  scope: string,
  value: string,
  origin: string,
  reason: string,
): Promise<void> {
  await pool.query(
    `insert into suppressions (organization_id, scope, value, reason, origin)
     select $1, $2, $3, $4, $5
     where not exists (
       select 1 from suppressions where organization_id = $1 and scope = $2 and value = $3
     )`,
    [org, scope, value, reason, origin],
  );
}

async function stopEnrollment(
  pool: Pool,
  org: string,
  contactId: string,
  status: 'bounced' | 'stopped',
  stopReason: string,
): Promise<void> {
  await pool.query(
    `update enrollments
        set status = $3, stop_reason = $4, ended_at = now()
      where organization_id = $1 and contact_id = $2 and status in ${LIVE_STATUSES}`,
    [org, contactId, status, stopReason],
  );
}

/** Crée/actualise le fil du contact et retourne son id. */
async function upsertThread(pool: Pool, org: string, contactId: string, classification: string): Promise<string> {
  const found = await pool.query<{ id: string }>(
    `select id from threads where organization_id = $1 and contact_id = $2 and channel = 'email' limit 1`,
    [org, contactId],
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
     values ($1, $2, 'email', $3, now(), false) returning id`,
    [org, contactId, classification],
  );
  return created.rows[0]!.id;
}

/** Notifie tous les membres de l'organisation (règle #9). */
async function notifyReply(pool: Pool, org: string, title: string, body: string): Promise<void> {
  await pool.query(
    `insert into notifications (organization_id, user_id, event, payload, channel, sent_at)
     select $1, m.user_id, 'contact.replied', $2::jsonb, 'push', now()
     from memberships m where m.organization_id = $1`,
    [org, JSON.stringify({ title, body })],
  );
}

export async function processSmartleadEvent(pool: Pool, org: string, event: SmartleadEvent): Promise<ProcessResult> {
  if (!event.email) return { stored: false, reason: 'no_email' };

  // Résolution du contact par (org, email). Inconnu → on ne stocke RIEN.
  const contactRes = await pool.query<{ id: string }>(
    `select id from contacts where organization_id = $1 and lower(email) = lower($2) limit 1`,
    [org, event.email],
  );
  const contact = contactRes.rows[0];
  if (!contact) return { stored: false, reason: 'unknown_contact' };

  if (event.type === 'bounced') {
    await addSuppression(pool, org, 'email', event.email, 'bounce', 'Bounce (Smartlead)');
    await stopEnrollment(pool, org, contact.id, 'bounced', 'bounce');
    return { stored: true, effect: 'bounce' };
  }

  if (event.type === 'unsubscribed') {
    await addSuppression(pool, org, 'email', event.email, 'unsubscribe', 'Désinscription (Smartlead)');
    await stopEnrollment(pool, org, contact.id, 'stopped', 'unsubscribe');
    return { stored: true, effect: 'unsubscribe' };
  }

  if (event.type === 'replied') {
    // L'événement EST une réponse du lead : si la détection auto (absence/départ)
    // ne matche pas, le défaut est `human_reply` (arrêt + notif) — jamais continuer
    // à écrire à quelqu'un qui a répondu. Le raffinement de sentiment (modèle) se
    // fera ensuite côté boîte de réception.
    const cls = classifyReply(event.replyText ?? '', event.headers) ?? { classification: 'human_reply' as const };
    const threadId = await upsertThread(pool, org, contact.id, cls.classification);
    await pool.query(
      `insert into thread_messages (thread_id, direction, body, provider_message_id, raw, sent_at)
       values ($1, 'in', $2, $3, $4::jsonb, now())`,
      [threadId, event.replyText ?? '', event.messageId, JSON.stringify(event.raw ?? {})],
    );

    // Effet sur l'inscription selon la classification (miroir de l'inbox).
    if (cls.classification === 'human_reply') {
      await pool.query(
        `update enrollments set status = 'replied', ended_at = now()
          where organization_id = $1 and contact_id = $2 and status in ${LIVE_STATUSES}`,
        [org, contact.id],
      );
    } else if (cls.classification === 'auto_absence') {
      const days = cls.resumeInDays ?? 7;
      await pool.query(
        `update enrollments
            set status = 'paused_absence',
                resume_at = now() + ($3 || ' days')::interval,
                next_action_at = now() + ($3 || ' days')::interval
          where organization_id = $1 and contact_id = $2 and status in ${LIVE_STATUSES}`,
        [org, contact.id, String(days)],
      );
    } else if (cls.classification === 'auto_left_company') {
      await pool.query(
        `update enrollments set status = 'stopped', stop_reason = 'contact_left', ended_at = now()
          where organization_id = $1 and contact_id = $2 and status in ${LIVE_STATUSES}`,
        [org, contact.id],
      );
    }
    // auto_other / unclassified → aucun effet sur l'inscription.

    // Notification (règle #9) — même pour une auto-réponse : le fil doit être vu.
    const excerpt = (event.replyText ?? '').slice(0, 140);
    await notifyReply(pool, org, 'Nouvelle réponse', excerpt || cls.classification);
    return { stored: true, effect: 'reply', classification: cls.classification };
  }

  return { stored: false, reason: 'ignored' };
}
