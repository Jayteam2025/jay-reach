/**
 * Appel modèle (Anthropic) pour classer une réponse quand les règles sont
 * muettes — passe 3 de la classification (T26). Garde-fou : sans clé configurée,
 * renvoie null et l'appelant applique un défaut raisonnable (réponse humaine).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ReplyClassification } from '@jay-reach/core';

const LABELS: ReplyClassification[] = ['human_reply', 'auto_absence', 'auto_left_company', 'auto_other'];

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface ReplyContext {
  receivedMessage: string;
  contactName: string;
  company: string;
  campaignName: string;
  history?: string;
}

/**
 * Génère une PROPOSITION de réponse à un message reçu (T26b). Jamais envoyée
 * automatiquement : l'humain relit et envoie. Renvoie null sans clé configurée.
 */
export async function generateSuggestedReply(ctx: ReplyContext): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 500,
      system:
        'Tu rédiges, pour un commercial B2B, une proposition de réponse à un message reçu en prospection. ' +
        'Réponds en français, ton professionnel et chaleureux, court (3–5 phrases). Réponds au fond du message, ' +
        'propose un créneau si pertinent. Ne mets pas d’objet, ne signe pas (pas de « Cordialement »/nom). ' +
        'Renvoie UNIQUEMENT le corps de la réponse, sans préambule.',
      messages: [
        {
          role: 'user',
          content:
            `Contact : ${ctx.contactName} (${ctx.company}). Campagne : ${ctx.campaignName}.\n` +
            (ctx.history ? `Historique : ${ctx.history}\n` : '') +
            `\nMessage reçu :\n"""${ctx.receivedMessage}"""\n\nRédige la réponse.`,
        },
      ],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function classifyReplyWithModel(body: string): Promise<ReplyClassification | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 64,
      system:
        "Tu classes une réponse reçue à un email de prospection B2B. Réponds UNIQUEMENT par un seul mot parmi : human_reply, auto_absence, auto_left_company, auto_other. " +
        'human_reply = une vraie personne répond (même bref). auto_absence = message automatique d’absence/congés. ' +
        'auto_left_company = la personne a quitté l’entreprise. auto_other = autre message automatique.',
      messages: [{ role: 'user', content: body.slice(0, 2000) }],
    });
    const textBlocks = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    const label = (textBlocks.map((b) => b.text).join(' ') || '').trim().toLowerCase();
    return LABELS.find((l) => label.includes(l)) ?? null;
  } catch {
    return null;
  }
}
