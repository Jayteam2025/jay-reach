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
import { MailCheck, Loader2 } from 'lucide-react';
import type { EnrichedCompany } from '@/hooks/useEnrichedCompanies';
import { useCompanyEnrichment } from './useCompanyEnrichment';

/**
 * Bouton "Vérifier X emails" + dialog de confirmation Bouncer (Jay Reach 1.5.3).
 *
 * Affiche null s'il n'y a aucun email a verifier. Le dialog est portale par Radix,
 * donc ce composant peut etre rendu directement dans la barre d'actions du header.
 */
export function EnrichmentStatusPanel({ company }: { company: EnrichedCompany }) {
  const {
    pendingBouncerCount,
    verifyingEmails,
    verifyDialogOpen,
    setVerifyDialogOpen,
    launchBouncerVerification,
  } = useCompanyEnrichment(company);

  if (pendingBouncerCount === 0) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 text-[12px] gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => setVerifyDialogOpen(true)}
        disabled={verifyingEmails}
      >
        {verifyingEmails ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <MailCheck className="w-3.5 h-3.5" />
        )}
        Vérifier {pendingBouncerCount} email{pendingBouncerCount > 1 ? 's' : ''}
      </Button>

      <AlertDialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vérifier les emails via Bouncer</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-[13px]">
                <p>
                  On va vérifier <strong>{pendingBouncerCount} email{pendingBouncerCount > 1 ? 's' : ''}</strong> de
                  {' '}<strong>{company.company_name}</strong> via Bouncer (SMTP RCPT TO).
                </p>
                <p>
                  Cela consomme <strong>{pendingBouncerCount} crédit{pendingBouncerCount > 1 ? 's' : ''}</strong> sur ton quota
                  mensuel (1000/mois).
                </p>
                <div className="rounded-md bg-muted/50 p-3 text-[12px] space-y-1.5 text-muted-foreground">
                  <p className="font-medium text-foreground">Verdicts possibles :</p>
                  <p><span className="text-emerald-600 dark:text-emerald-400">Vérifié</span> — email confirmé valide, safe à envoyer</p>
                  <p><span className="text-red-600 dark:text-red-400">Invalide</span> — n'existe pas, on l'exclut auto</p>
                  <p><span className="text-orange-600 dark:text-orange-400">Catch-all</span> — domaine accepte tout, impossible de savoir sans envoyer (PME OVH/Gandi typique)</p>
                </div>
                <p className="text-muted-foreground text-[12px]">
                  Résultat dans ~30-60s, la page se rafraîchira automatiquement.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={launchBouncerVerification}>
              Vérifier ({pendingBouncerCount} crédit{pendingBouncerCount > 1 ? 's' : ''})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
