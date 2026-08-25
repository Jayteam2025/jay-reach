/**
 * Classification des réponses entrantes (T26). Trois passes prévues :
 *   1. En-têtes (auto-reply) — `classifyByHeaders`
 *   2. Motifs multilingues FR/EN/NL — `classifyByRules`
 *   3. Modèle (dernier recours) — appelé côté serveur si les règles sont muettes
 *
 * Ce module ne fait que les passes 1 et 2 (pures, testables). La passe 3 (IA)
 * vit côté application (clé Anthropic). Effets sur les inscriptions décidés par
 * l'appelant selon la classification (arrêt / pause datée / départ).
 */

export type ReplyClassification = 'human_reply' | 'auto_absence' | 'auto_left_company' | 'auto_other' | 'unclassified';

export interface ClassifyResult {
  readonly classification: ReplyClassification;
  /** Pour une absence : nombre de jours avant reprise (défaut si non daté). */
  readonly resumeInDays?: number;
}

const ABSENCE = /\b(absent|en cong[ée]s?|cong[ée]s?|out of office|on vacation|away from (the|my) (office|desk)|afwezig|met verlof|vakantie|de retour le|back (on|from)|réponse automatique|automatic reply|automatisch antwoord)\b/i;
const LEFT_COMPANY = /\b(ne (suis|travaille) plus|n'est plus (en poste|dans l'entreprise|chez)|plus en poste|a quitt[ée] (l'entreprise|la soci[ée]t[ée]|nos [ée]quipes)|no longer (with|at|works? (at|for))|has left the (company|organi[sz]ation)|left the company|niet meer (bij|werkzaam)|uit dienst)\b/i;

/** Passe 1 — en-têtes d'auto-réponse. */
export function classifyByHeaders(headers: Record<string, unknown> | null | undefined): ClassifyResult | null {
  if (!headers) return null;
  const get = (k: string): string => String(headers[k] ?? headers[k.toLowerCase()] ?? '').toLowerCase();
  if (get('auto-submitted').includes('auto-') || get('x-autoreply') === 'yes' || get('x-autorespond') !== '' || get('precedence') === 'auto_reply') {
    return { classification: 'auto_absence', resumeInDays: 7 };
  }
  return null;
}

/** Passe 2 — motifs multilingues sur le corps du message. */
export function classifyByRules(body: string): ClassifyResult | null {
  const text = body ?? '';
  if (LEFT_COMPANY.test(text)) return { classification: 'auto_left_company' };
  if (ABSENCE.test(text)) return { classification: 'auto_absence', resumeInDays: 7 };
  return null;
}

/** Passes 1 + 2 combinées. Renvoie null si rien de sûr (→ passer au modèle). */
export function classifyReply(body: string, headers?: Record<string, unknown> | null): ClassifyResult | null {
  return classifyByHeaders(headers) ?? classifyByRules(body);
}
