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
import type { SmartleadEvent } from '@jay-reach/core';
import { LIVE_STATUSES, notifyReply, recordInboundReply } from '../inbox/record-reply';

export type ProcessResult =
  | { readonly stored: false; readonly reason: 'no_email' | 'unknown_contact' | 'ignored' }
  | { readonly stored: true; readonly effect: 'reply' | 'bounce' | 'unsubscribe'; readonly classification?: string };

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
    // Le traitement est commun à tous les canaux : classer, ouvrir le fil,
    // arrêter la séquence, notifier. Voir `lib/inbox/record-reply`.
    const enregistre = await recordInboundReply(pool, org, {
      contactId: contact.id,
      channel: 'email',
      body: event.replyText ?? '',
      providerMessageId: event.messageId,
      headers: event.headers,
      raw: event.raw,
    });
    if (enregistre.isNew) {
      // Notification même pour une auto-réponse : le fil doit être vu (règle n° 9).
      const excerpt = (event.replyText ?? '').slice(0, 140);
      await notifyReply(pool, org, 'Nouvelle réponse', excerpt || enregistre.classification);
    }
    return { stored: true, effect: 'reply', classification: enregistre.classification };
  }

  return { stored: false, reason: 'ignored' };
}
