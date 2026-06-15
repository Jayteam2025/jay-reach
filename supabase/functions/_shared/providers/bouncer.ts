/**
 * Bouncer EmailValidator implementation (Jay Reach 1.4.2).
 *
 * Wraps le client _shared/bouncer.ts pour respecter l'interface EmailValidator.
 * Permet a un consommateur OSS de switcher facilement vers un autre provider
 * (ZeroBounce, NeverBounce, etc.) en implementant la meme interface.
 */
import { submitBatch as bouncerSubmitBatch, downloadResults as bouncerDownloadResults } from '../bouncer.ts';
import type { EmailValidator, EmailValidationResult, ResolvedProvider } from './types.ts';

interface BouncerConfig extends Record<string, unknown> {
  callback_url?: string;
}

export const bouncerValidator: EmailValidator = {
  type: 'bouncer',
  deliveryMode: 'webhook',

  async submitBatch(emails, ctx: ResolvedProvider<BouncerConfig>) {
    const callbackUrl = ctx.config.callback_url;
    if (!callbackUrl) {
      throw new Error('bouncer.submitBatch: config.callback_url manquant');
    }
    const result = await bouncerSubmitBatch(emails, callbackUrl, ctx.apiKey);
    return { providerBatchId: result.job_id };
  },

  async fetchResults(providerBatchId, ctx) {
    const results = await bouncerDownloadResults(providerBatchId, ctx.apiKey);
    return results.map((r): EmailValidationResult => ({
      email: r.email,
      verdict: r.status,
      reason: r.reason ?? null,
    }));
  },
};
