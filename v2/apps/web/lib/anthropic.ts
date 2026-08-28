/**
 * Appel modèle (Anthropic) pour classer une réponse quand les règles sont
 * muettes — passe 3 de la classification (T26). Garde-fou : sans clé configurée,
 * renvoie null et l'appelant applique un défaut raisonnable (réponse humaine).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ReplyClassification } from '@jay-reach/core';
import { getPool } from './db';

const LABELS: ReplyClassification[] = ['human_reply', 'auto_absence', 'auto_left_company', 'auto_other'];

/**
 * Resout la cle Anthropic de l'organisation : le coffre chiffre d'abord, la
 * variable d'environnement en repli. C'est le meme ordre que le worker.
 *
 * L'app web ne lisait que `process.env`, alors que la cle se saisit dans
 * l'onglet Fournisseurs et vit chiffree en base. Resultat : chez un operateur
 * qui a suivi l'interface, le tri par modele et les reponses suggerees etaient
 * morts sans que rien ne l'explique.
 */
export async function resolveAnthropicKey(organizationId: string): Promise<string | null> {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey) {
    try {
      const res = await getPool().query<{ secret: string | null }>(
        'select app.get_credential($1, $2, $3) as secret',
        [organizationId, 'anthropic', encryptionKey],
      );
      const brut = res.rows[0]?.secret;
      if (brut) {
        // Le coffre peut porter la cle brute ou un objet JSON (heritage du socle v1).
        try {
          const o = JSON.parse(brut) as Record<string, unknown>;
          const v = o.api_key ?? o.apiKey ?? o.key;
          if (typeof v === 'string' && v !== '') return v;
        } catch {
          /* cle brute */
        }
        return brut;
      }
    } catch {
      // Coffre injoignable : on retombe sur l'environnement plutot que d'echouer.
    }
  }
  return process.env.ANTHROPIC_API_KEY ?? null;
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
export async function generateSuggestedReply(ctx: ReplyContext, apiKey: string): Promise<string | null> {
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

export async function classifyReplyWithModel(
  body: string,
  apiKey: string | null,
): Promise<ReplyClassification | null> {
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
