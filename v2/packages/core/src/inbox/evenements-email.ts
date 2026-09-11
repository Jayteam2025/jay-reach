/**
 * Effets en base d'un `EvenementEmail` (rendu neutre, indépendant du
 * provider). Reprise de `addSuppression`, `stopEnrollment` et de la logique
 * de l'ancien `processSmartleadEvent` (webhook Smartlead), généralisée à
 * n'importe quelle source d'événements email — SalesBlink comme, hier,
 * Smartlead.
 *
 * Règles inchangées :
 *  - **Contact inconnu → RIEN n'est stocké** : ni thread, ni message, ni
 *    suppression, ni notification.
 *  - Réponse humaine ou automatique → `recordInboundReply` (fil, message,
 *    arrêt d'inscription selon la classification) + notification si nouveau
 *    (règle n° 9 : aucune réponse ne passe inaperçue).
 *  - Rebond / désinscription → suppression (l'adresse ne sera plus
 *    contactée) + inscription arrêtée (`bounced` / `stopped`).
 *  - Envoi / erreur → laissés à la relève (le sequenceur), pas traités ici.
 */
import type { Executeur } from '../executeur.js';
import type { EvenementEmail } from '../email-transport/rapports.js';
import { LIVE_STATUSES, notifyReply, recordInboundReply } from './record-reply.js';

export type ResultatEvenement =
  | { readonly stored: false; readonly reason: 'no_email' | 'unknown_contact' | 'ignored' }
  | { readonly stored: true; readonly effect: 'reply' | 'bounce' | 'unsubscribe'; readonly classification?: string };

async function addSuppression(
  ex: Executeur,
  org: string,
  scope: string,
  value: string,
  origin: string,
  reason: string,
): Promise<void> {
  await ex.query(
    `insert into suppressions (organization_id, scope, value, reason, origin)
     select $1, $2, $3, $4, $5
     where not exists (
       select 1 from suppressions where organization_id = $1 and scope = $2 and value = $3
     )`,
    [org, scope, value, reason, origin],
  );
}

async function stopEnrollment(
  ex: Executeur,
  org: string,
  contactId: string,
  status: 'bounced' | 'stopped',
  stopReason: string,
): Promise<void> {
  await ex.query(
    `update enrollments
        set status = $3, stop_reason = $4, ended_at = now()
      where organization_id = $1 and contact_id = $2 and status in ${LIVE_STATUSES}`,
    [org, contactId, status, stopReason],
  );
}

/**
 * Applique l'effet d'un `EvenementEmail` sur la base. `origine` nomme la
 * source dans les motifs de suppression (« Bounce (SalesBlink) », par
 * exemple) — utile le jour où plusieurs transports coexistent.
 */
export async function traiterEvenementEmail(
  ex: Executeur,
  org: string,
  ev: EvenementEmail,
  origine: string,
): Promise<ResultatEvenement> {
  if (!ev.email) return { stored: false, reason: 'no_email' };

  // Résolution du contact par (org, email). Inconnu → on ne stocke RIEN.
  const contactRes = await ex.query<{ id: string }>(
    `select id from contacts where organization_id = $1 and lower(email) = lower($2) limit 1`,
    [org, ev.email],
  );
  const contact = contactRes.rows[0];
  if (!contact) return { stored: false, reason: 'unknown_contact' };

  if (ev.type === 'rebond') {
    await addSuppression(ex, org, 'email', ev.email, 'bounce', `Bounce (${origine})`);
    await stopEnrollment(ex, org, contact.id, 'bounced', 'bounce');
    return { stored: true, effect: 'bounce' };
  }

  if (ev.type === 'desinscrit') {
    await addSuppression(ex, org, 'email', ev.email, 'unsubscribe', `Désinscription (${origine})`);
    await stopEnrollment(ex, org, contact.id, 'stopped', 'unsubscribe');
    return { stored: true, effect: 'unsubscribe' };
  }

  if (ev.type === 'repondu') {
    // Le traitement est commun à tous les canaux : classer, ouvrir le fil,
    // arrêter la séquence, notifier. Voir `record-reply.ts`.
    const enregistre = await recordInboundReply(ex, org, {
      contactId: contact.id,
      channel: 'email',
      body: ev.corps,
      providerMessageId: ev.messageId,
    });
    if (enregistre.isNew) {
      // Notification même pour une auto-réponse : le fil doit être vu (règle n° 9).
      const excerpt = ev.corps.slice(0, 140);
      await notifyReply(ex, org, 'Nouvelle réponse', excerpt || enregistre.classification);
    }
    return { stored: true, effect: 'reply', classification: enregistre.classification };
  }

  // 'envoye' et 'erreur' : traités par la relève, pas ici.
  return { stored: false, reason: 'ignored' };
}
