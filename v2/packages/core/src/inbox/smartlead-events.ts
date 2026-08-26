/**
 * Parseur des événements webhook Smartlead entrants (T27, volet réception).
 * Défensif : Smartlead fait varier ses payloads, donc on normalise vers une forme
 * stable et on garde le brut. Aucun I/O — testable hors réseau.
 *
 * Règle CLAUDE.md #6 : Zod sur toute donnée entrante (ici, un webhook).
 */
import { z } from 'zod';

/** Type d'événement normalisé (indépendant des variantes de nommage Smartlead). */
export type SmartleadEventType = 'replied' | 'bounced' | 'unsubscribed' | 'opened' | 'clicked' | 'sent' | 'unknown';

export interface SmartleadEvent {
  readonly type: SmartleadEventType;
  /** Email du lead (destinataire, ou expéditeur pour une réponse). */
  readonly email: string | null;
  readonly campaignId: string | null;
  /** Corps de la réponse (événement `replied`), si présent. */
  readonly replyText: string | null;
  /** En-têtes du message reçu (pour la classification auto-reply), si présents. */
  readonly headers: Record<string, unknown> | null;
  /** Identifiant de message côté provider (corrélation éventuelle). */
  readonly messageId: string | null;
  readonly raw: unknown;
}

// Schéma tolérant : on n'exige que `event_type`, le reste est optionnel et
// récupéré parmi plusieurs noms de champs possibles.
const rawSchema = z
  .object({
    event_type: z.string().optional(),
    event: z.string().optional(),
    campaign_id: z.union([z.string(), z.number()]).optional(),
    to_email: z.string().optional(),
    lead_email: z.string().optional(),
    from_email: z.string().optional(),
    email: z.string().optional(),
    reply_message: z.object({ text: z.string().optional(), html: z.string().optional() }).partial().optional(),
    reply_body: z.string().optional(),
    email_body: z.string().optional(),
    reply_headers: z.record(z.unknown()).optional(),
    headers: z.record(z.unknown()).optional(),
    message_id: z.union([z.string(), z.number()]).optional(),
    stats_id: z.union([z.string(), z.number()]).optional(),
    sl_lead_email: z.string().optional(),
  })
  .passthrough();

function normalizeType(raw: string | undefined): SmartleadEventType {
  const v = (raw ?? '').toUpperCase();
  if (v.includes('REPL')) return 'replied';
  if (v.includes('BOUNCE')) return 'bounced';
  if (v.includes('UNSUB') || v.includes('OPT_OUT') || v.includes('OPTOUT')) return 'unsubscribed';
  if (v.includes('OPEN')) return 'opened';
  if (v.includes('CLICK')) return 'clicked';
  if (v.includes('SENT') || v.includes('DELIVER')) return 'sent';
  return 'unknown';
}

function firstString(...vals: (string | number | undefined)[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/** Parse un payload webhook Smartlead. Renvoie l'événement normalisé, ou une erreur. */
export function parseSmartleadEvent(payload: unknown): SmartleadEvent | { error: string } {
  const res = rawSchema.safeParse(payload);
  if (!res.success) return { error: 'payload invalide' };
  const p = res.data;
  const type = normalizeType(p.event_type ?? p.event);
  const email = firstString(p.to_email, p.lead_email, p.sl_lead_email, p.from_email, p.email);
  const replyText = firstString(p.reply_message?.text, p.reply_message?.html, p.reply_body, p.email_body);
  const headers = (p.reply_headers ?? p.headers ?? null) as Record<string, unknown> | null;
  return {
    type,
    email: email ? email.toLowerCase() : null,
    campaignId: firstString(p.campaign_id),
    replyText,
    headers,
    messageId: firstString(p.message_id, p.stats_id),
    raw: payload,
  };
}

/** L'événement agit-il sur l'inscription/suppression (vs simple analytics) ? */
export function isActionableSmartleadEvent(type: SmartleadEventType): boolean {
  return type === 'replied' || type === 'bounced' || type === 'unsubscribed';
}
