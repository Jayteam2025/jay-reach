import { useState } from 'react';
import { Mail, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import type { EnrichedProfile } from '@/hooks/useEnrichedCompanies';
import { useSmartleadPush } from './useSmartleadPush';

/**
 * Pousse en Smartlead tous les leads d'un persona dont deliverability_status='valid'.
 * Le gate filtre quand même côté backend (defense in depth). `label` = nom du persona.
 */
export function BulkSendValidEmailsPanel({
  profiles,
  label,
}: {
  profiles: EnrichedProfile[];
  label: string;
}) {
  const { toast } = useToast();
  const { eligible, alreadySent, totalWithEmail, push, sending } = useSmartleadPush(profiles);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (totalWithEmail === 0) return null;

  const labelEligible = label;
  const labelTotal = label;

  const handleSend = async () => {
    setDialogOpen(false);
    try {
      const result = await push();
      if (!result) return;
      const { ok, skipped, failed } = result;
      toast({
        description: `${ok} envoyé${ok > 1 ? 's' : ''} sur Smartlead.${skipped > 0 ? ` ${skipped} bloqué${skipped > 1 ? 's' : ''} par le gate.` : ''}${failed > 0 ? ` ${failed} erreur${failed > 1 ? 's' : ''}.` : ''}`,
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        description: err instanceof Error ? err.message : 'Erreur envoi',
      });
    }
  };

  return (
    <>
      <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5">
        <div className="flex items-center gap-2 text-[12px] text-foreground">
          <Mail className="w-3.5 h-3.5 text-emerald-500" />
          <span>
            {eligible.length > 0 ? (
              <>
                Pousser <strong>{eligible.length}</strong> {labelEligible} validé{eligible.length > 1 ? 's' : ''} vers Smartlead
                {alreadySent > 0 && (
                  <span className="text-muted-foreground"> · {alreadySent} déjà envoyé{alreadySent > 1 ? 's' : ''}</span>
                )}
              </>
            ) : alreadySent > 0 ? (
              <>
                <strong>{alreadySent}</strong> {label} déjà envoyé{alreadySent > 1 ? 's' : ''} sur Smartlead
              </>
            ) : (
              <>Aucun {labelTotal} avec email vérifié (lancer Bouncer d'abord)</>
            )}
          </span>
        </div>
        <Button
          size="sm"
          className="h-7 text-[12px] gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white"
          disabled={eligible.length === 0 || sending}
          onClick={() => setDialogOpen(true)}
        >
          {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
          Envoyer
        </Button>
      </div>

      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Pousser {eligible.length} email{eligible.length > 1 ? 's' : ''} sur Smartlead
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-[13px]">
                <p>
                  {eligible.length} {labelEligible} avec <strong>deliverability_status=valid</strong>{' '}
                  {eligible.length > 1 ? 'seront poussés' : 'sera poussé'} dans la campagne Smartlead correspondante.
                </p>
                <p className="text-muted-foreground text-[12px]">
                  Le backend re-valide chaque envoi via le gate (double-check). Tu peux suivre l'avancement
                  dans Smartlead UI une fois fini.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleSend}>Pousser sur Smartlead</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
