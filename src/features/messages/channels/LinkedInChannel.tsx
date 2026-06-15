import { Linkedin, Loader2, CheckCircle2, Clock, AlertCircle, UserPlus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useEnqueueLinkedInInvitations, useLinkedInQueueMap } from '@/hooks/useLinkedInInvitation';
import type { EnrichedProfile } from '@/hooks/useEnrichedCompanies';
import { ChannelShell, ChannelHeader } from './ChannelShell';

export function LinkedInChannel({
  profile,
}: {
  profile: EnrichedProfile;
}) {
  const enqueueMutation = useEnqueueLinkedInInvitations();
  const { data: queueMaps } = useLinkedInQueueMap();
  const { toast } = useToast();

  const queueItem = queueMaps?.byProspect.get(profile.id);
  const isAlreadyInvited = !!profile.linkedin_invited_at;
  const queueStatus = queueItem?.status;
  const canInvite = !!profile.linkedin_url && !isAlreadyInvited
    && (!queueStatus || queueStatus === 'failed' || queueStatus === 'cancelled');

  const handleOpen = () => {
    if (!profile.linkedin_url) return;
    window.open(profile.linkedin_url, '_blank', 'noopener,noreferrer');
  };

  const handleInvite = async () => {
    try {
      const result = await enqueueMutation.mutateAsync({
        prospect_ids: [profile.id],
        method: 'extension_auto',
      });
      if (result.enqueued > 0) {
        toast({ description: 'Ajouté à la file d\'invitation LinkedIn' });
      } else {
        toast({
          variant: 'destructive',
          description: 'Non ajouté (déjà en file ou pas éligible)',
        });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        description: err instanceof Error ? err.message : 'Erreur ajout file',
      });
    }
  };

  const status = profile.linkedin_url
    ? isAlreadyInvited
      ? { label: 'Invitation envoyée', kind: 'found' as const }
      : queueStatus === 'pending' || queueStatus === 'processing'
        ? { label: 'En file d\'invitation', kind: 'found' as const }
        : { label: 'Profil trouvé', kind: 'found' as const }
    : { label: 'Profil non trouvé', kind: 'missing' as const };

  return (
    <ChannelShell accent="sky">
      <ChannelHeader Icon={Linkedin} label="LinkedIn" accent="sky" status={status} />

      {!profile.linkedin_url && (
        <p className="text-[12px] text-muted-foreground/70">
          Profil LinkedIn non identifié.
        </p>
      )}

      {profile.linkedin_url && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-7 text-[12px] gap-1.5 bg-sky-500 hover:bg-sky-600 text-white"
            onClick={handleInvite}
            disabled={!canInvite || enqueueMutation.isPending}
          >
            {enqueueMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : isAlreadyInvited ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : queueStatus === 'pending' || queueStatus === 'processing' ? (
              <Clock className="w-3 h-3" />
            ) : queueStatus === 'failed' ? (
              <AlertCircle className="w-3 h-3" />
            ) : (
              <UserPlus className="w-3 h-3" />
            )}
            {isAlreadyInvited
              ? 'Invitation envoyée'
              : queueStatus === 'pending' || queueStatus === 'processing'
                ? 'En attente d\'envoi'
                : queueStatus === 'failed'
                  ? 'Réessayer l\'invitation'
                  : 'Inviter sur LinkedIn'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[12px] gap-1.5 border-sky-500/30 hover:bg-sky-500/10"
            onClick={handleOpen}
          >
            <ExternalLink className="w-3 h-3" />
            Ouvrir le profil
          </Button>
        </div>
      )}

      {queueItem?.status === 'failed' && queueItem.error_message && (
        <p className="text-[11px] text-red-500/80 mt-1">{queueItem.error_message}</p>
      )}
    </ChannelShell>
  );
}
