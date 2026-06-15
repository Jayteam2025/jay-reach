import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, Copy, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabase';
import { useTrackAction, useCompanyProgress } from '@/hooks/useProspectActions';
import type { EnrichedCompany, EnrichedProfile } from '@/hooks/useEnrichedCompanies';
import { EmailStatusBadge } from '@/components/prospection/EmailStatusBadge';
import { ChannelShell, ChannelHeader } from './ChannelShell';
import { MessageContent } from './MessageContent';
import type { ProspectMessage } from '../useCompanyMessages';

export function EmailChannel({
  profile,
  company,
  message,
}: {
  profile: EnrichedProfile;
  company: EnrichedCompany;
  message: ProspectMessage | undefined;
}) {
  const trackAction = useTrackAction();
  const { data: progress } = useCompanyProgress(company.company_group_id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const completedChannels = progress?.byProspect[profile.id] || new Set();
  const done = completedChannels.has('email');
  const [verifyingThis, setVerifyingThis] = useState(false);

  const status: { label: string; kind: 'found' | 'missing' | 'sent' | 'draft' } | undefined =
    message?.status === 'sent' || done ? { label: 'Envoyé', kind: 'sent' } :
    message ? { label: 'Brouillon prêt', kind: 'draft' } :
    profile.email ? { label: 'Email trouvé', kind: 'found' } :
    { label: 'Email non trouvé', kind: 'missing' };

  const handleCopyEmail = async () => {
    if (!profile.email) return;
    await navigator.clipboard.writeText(profile.email);
    trackAction.mutate({
      prospectId: profile.id,
      companyGroupId: company.company_group_id,
      actionType: 'copy',
      channel: 'email',
    });
  };

  const handleVerifySingleEmail = async () => {
    if (!profile.email || profile.deliverability_status || verifyingThis) return;
    setVerifyingThis(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session?.session?.access_token;
      if (!accessToken) {
        toast({ description: 'Erreur auth : reconnecte-toi', variant: 'destructive' });
        setVerifyingThis(false);
        return;
      }
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bouncer-batch?emails=${encodeURIComponent(profile.email)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ description: `Échec : ${body.error || res.statusText}`, variant: 'destructive' });
        setVerifyingThis(false);
        return;
      }
      toast({ description: `Vérification ${profile.email} en cours (~30s)…` });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['enriched-companies'] });
        setVerifyingThis(false);
      }, 45_000);
    } catch (e) {
      toast({ description: `Erreur : ${e instanceof Error ? e.message : String(e)}`, variant: 'destructive' });
      setVerifyingThis(false);
    }
  };

  return (
    <ChannelShell accent="violet">
      <ChannelHeader Icon={Mail} label="Email" accent="violet" status={status} />

      {profile.email ? (
        <div className="flex items-center gap-2 text-[13px] font-mono text-foreground mb-3 flex-wrap">
          <span className="truncate">{profile.email}</span>
          <button
            onClick={handleCopyEmail}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Copier l'adresse"
          >
            <Copy className="w-3 h-3" />
          </button>
          <EmailStatusBadge status={profile.email_validation_status} deliverabilityStatus={profile.deliverability_status} />
          {!profile.deliverability_status && (
            <button
              onClick={handleVerifySingleEmail}
              disabled={verifyingThis}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0 underline-offset-2 hover:underline disabled:opacity-50"
              title="Vérifier cet email via Bouncer (1 crédit)"
            >
              {verifyingThis ? (
                <Loader2 className="w-3 h-3 animate-spin inline" />
              ) : (
                'Vérifier'
              )}
            </button>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground/70 mb-3">
          Pas trouvé par FullEnrich. Essayer via LinkedIn.
        </p>
      )}

      {message && <MessageContent message={message} profile={profile} company={company} channel="email" />}
    </ChannelShell>
  );
}
