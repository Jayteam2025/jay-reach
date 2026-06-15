import { Linkedin, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useEnqueueLinkedInInvitations, useLinkedInQueueMap } from '@/hooks/useLinkedInInvitation';
import type { EnrichedProfile } from '@/hooks/useEnrichedCompanies';

/**
 * Invite tous les profils LinkedIn éligibles d'une catégorie via l'extension queue
 * (Jay Reach 1.5.2). Exclut ceux déjà invités, en file, ou sans linkedin_url.
 */
export function BulkLinkedInInvitePanel({
  profiles,
  categoryLabel,
}: {
  profiles: EnrichedProfile[];
  categoryLabel: string;
}) {
  const enqueueMutation = useEnqueueLinkedInInvitations();
  const { data: queueMaps } = useLinkedInQueueMap();
  const { toast } = useToast();

  const eligible = profiles.filter((p) => {
    if (!p.linkedin_url) return false;
    if (p.linkedin_invited_at) return false;
    const q = queueMaps?.byProspect.get(p.id);
    if (q && (q.status === 'pending' || q.status === 'processing' || q.status === 'sent')) return false;
    return true;
  });

  const total = profiles.filter((p) => !!p.linkedin_url).length;
  const alreadyDone = total - eligible.length;

  const handleInvite = async () => {
    if (eligible.length === 0) return;
    try {
      const result = await enqueueMutation.mutateAsync({
        prospect_ids: eligible.map((p) => p.id),
        method: 'extension_auto',
      });
      toast({
        description: result.enqueued > 0
          ? `${result.enqueued} ${categoryLabel} ajouté${result.enqueued > 1 ? 's' : ''} à la file LinkedIn`
          : 'Aucun profil éligible',
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        description: err instanceof Error ? err.message : 'Erreur ajout file',
      });
    }
  };

  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-sky-500/20 bg-sky-500/5 px-4 py-2.5">
      <div className="flex items-center gap-2 text-[12px] text-foreground">
        <Linkedin className="w-3.5 h-3.5 text-sky-500" />
        <span>
          {eligible.length > 0
            ? <>Inviter <strong>{eligible.length}</strong> {categoryLabel} sur LinkedIn</>
            : <>Tous les {categoryLabel} ont déjà été invités</>}
        </span>
        {alreadyDone > 0 && (
          <span className="text-[11px] text-muted-foreground">
            ({alreadyDone} déjà fait{alreadyDone > 1 ? 's' : ''})
          </span>
        )}
      </div>
      <Button
        size="sm"
        className="h-7 text-[12px] gap-1.5 bg-sky-500 hover:bg-sky-600 text-white"
        disabled={eligible.length === 0 || enqueueMutation.isPending}
        onClick={handleInvite}
      >
        {enqueueMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <UserPlus className="w-3 h-3" />
        )}
        Tout inviter
      </Button>
    </div>
  );
}
