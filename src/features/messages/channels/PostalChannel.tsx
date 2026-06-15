import { FileText } from 'lucide-react';
import type { EnrichedCompany, EnrichedProfile } from '@/hooks/useEnrichedCompanies';
import { ChannelShell, ChannelHeader } from './ChannelShell';
import { MessageContent } from './MessageContent';
import type { ProspectMessage } from '../useCompanyMessages';

export function PostalChannel({
  profile,
  company,
  message,
}: {
  profile: EnrichedProfile;
  company: EnrichedCompany;
  message: ProspectMessage | undefined;
}) {
  const enrichment = profile.enrichment_data || {};
  const hasAddress = typeof enrichment.company_address === 'string' && enrichment.company_address.length > 0;

  const status: { label: string; kind: 'found' | 'missing' | 'draft' } | undefined =
    message ? { label: 'Brouillon prêt', kind: 'draft' } :
    hasAddress ? { label: 'Adresse OK', kind: 'found' } :
    { label: 'Adresse manquante', kind: 'missing' };

  return (
    <ChannelShell accent="amber">
      <ChannelHeader Icon={FileText} label="Courrier" accent="amber" status={status} />

      {!hasAddress && (
        <p className="text-[12px] text-muted-foreground/70 mb-3">
          Ni FullEnrich ni INSEE n'ont retourné d'adresse.
        </p>
      )}

      {message && <MessageContent message={message} profile={profile} company={company} channel="postal_letter" />}
    </ChannelShell>
  );
}
