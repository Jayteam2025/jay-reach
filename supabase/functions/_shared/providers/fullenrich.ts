/**
 * FullEnrich EnrichmentProvider implementation (Jay Reach 1.4.3).
 *
 * Wraps le client _shared/fullenrich.ts. Permet a un OSS de switcher vers
 * un autre provider d'enrichment (Dropcontact, Hunter, ...) en implementant
 * la meme interface.
 *
 * Limitation honnete : les capacites avancees de FullEnrich (search contacts
 * at company, credits balance, ...) ne sont PAS dans l'interface generique
 * car provider-specifiques. Un OSS user peut switcher la partie generique
 * (enrichContacts bulk) mais aurait a reimplementer le reste a la main si
 * il prend un autre provider.
 */
import { submitBulkEnrichment } from '../fullenrich.ts';
import type {
  EnrichmentProvider,
  EnrichmentInput,
  EnrichmentBulkResult,
  ResolvedProvider,
} from './types.ts';

interface FullEnrichConfig extends Record<string, unknown> {
  webhook_url?: string;
}

export const fullenrichEnricher: EnrichmentProvider = {
  type: 'fullenrich',

  async enrichContacts(
    input: EnrichmentInput,
    ctx: ResolvedProvider<FullEnrichConfig>
  ): Promise<EnrichmentBulkResult> {
    const webhookUrl = input.webhookUrl ?? ctx.config.webhook_url ?? null;
    const jobName = input.workspaceTag
      ? `${input.workspaceTag}-${Date.now()}`
      : `enrich-${Date.now()}`;

    const feContacts = input.contacts.map((c) => ({
      first_name: c.firstName ?? '',
      last_name: c.lastName ?? '',
      company_name: c.companyName ?? '',
      linkedin_url: c.linkedinUrl ?? undefined,
      enrich_fields: ['contact.work_emails'] as string[],
    })).filter((c) => c.first_name && c.last_name && (c.linkedin_url || c.company_name));

    if (feContacts.length === 0) {
      return { bulkId: '', total: 0, meta: { skipped: 'no_valid_contacts' } };
    }

    const bulkId = await submitBulkEnrichment(
      ctx.apiKey,
      jobName,
      feContacts,
      webhookUrl ? { webhookUrl } : undefined,
    );

    return {
      bulkId,
      total: feContacts.length,
      meta: { jobName, provider: 'fullenrich' },
    };
  },
};
