import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import type { EnrichedCompany } from '@/hooks/useEnrichedCompanies';

/** Persona slug pour expansion FullEnrich (utilise par la edge function) */
export type ExpandPersonaSlug = string;

/**
 * Hook : verification Bouncer des emails d'une entreprise (Jay Reach 1.5.3).
 *
 * Encapsule le state + le polling de la verification email :
 * - pendingBouncerCount : leads avec email pas encore verifies (= credits a consommer)
 * - launchBouncerVerification() : declenche bouncer-batch puis re-fetch apres 45s
 * - verifyDialogOpen : state du dialog de confirmation (consomme des credits)
 *
 * Extrait de EntrepriseFiche.tsx pour rendre la logique testable et reutilisable.
 */
export function useCompanyEnrichment(company: EnrichedCompany) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [verifyingEmails, setVerifyingEmails] = useState(false);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);

  // Compte les leads avec email pas encore verifies par Bouncer (= crédits qui seront consommés)
  const pendingBouncerCount = company.profiles.filter((p) => p.email && !p.deliverability_status).length;

  const launchBouncerVerification = async () => {
    if (pendingBouncerCount === 0) return;
    setVerifyingEmails(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session?.session?.access_token;
      if (!accessToken) {
        toast({ description: 'Erreur auth : reconnecte-toi', variant: 'destructive' });
        setVerifyingEmails(false);
        return;
      }
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bouncer-batch?company_group_id=${company.company_group_id}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ description: `Échec : ${body.error || res.statusText}`, variant: 'destructive' });
        setVerifyingEmails(false);
        return;
      }
      toast({
        description: `${body.queued} email${body.queued > 1 ? 's' : ''} en cours de vérification (~30-60s)…`,
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['enriched-companies'] });
        setVerifyingEmails(false);
        toast({ description: 'Vérification terminée. Les badges sont à jour.' });
      }, 45_000);
    } catch (e) {
      toast({
        description: `Erreur : ${e instanceof Error ? e.message : String(e)}`,
        variant: 'destructive',
      });
      setVerifyingEmails(false);
    }
  };

  return {
    pendingBouncerCount,
    verifyingEmails,
    verifyDialogOpen,
    setVerifyDialogOpen,
    launchBouncerVerification,
  };
}

export interface ExpandPersonaResult {
  inserted: number;
  more_available_counts: Record<string, number> | null;
  credits_used: number;
}

/**
 * Hook : expansion FullEnrich d'une categorie de contacts (Jay Reach 1.5.3).
 *
 * Si FullEnrich a encore des contacts dispo dans cette categorie, permet d'en
 * scraper 10 de plus via expand-prospect-profiles.
 *
 * Retourne :
 * - moreAvailable : nombre de contacts encore dispo dans FullEnrich pour cette categorie
 * - expand() : declenche le scraping de 10 contacts en plus
 * - isExpanding : true pendant le scraping
 */
export function useExpandCategory(company: EnrichedCompany, personaSlug: ExpandPersonaSlug, label: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const moreAvailable = company.moreAvailable?.[personaSlug] ?? 0;

  const expandMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('expand-prospect-profiles', {
        body: {
          company_group_id: company.company_group_id,
          persona_slug: personaSlug,
          count: 10,
        },
      });
      if (error) throw error;
      return data as ExpandPersonaResult;
    },
    onSuccess: (data) => {
      if (data.inserted === 0) {
        toast({ description: 'Aucun nouveau contact disponible.' });
      } else {
        toast({
          description: `${data.inserted} nouveaux ${label} ajoutés. Messages Claude en cours (30-60 min).`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['enriched-companies'] });
      queryClient.invalidateQueries({ queryKey: ['company-messages', company.company_group_id] });
      queryClient.invalidateQueries({ queryKey: ['active-prospect-batches'] });
    },
    onError: (err) => {
      toast({
        variant: 'destructive',
        description: err instanceof Error ? err.message : 'Erreur scraping',
      });
    },
  });

  return {
    moreAvailable,
    expand: () => expandMutation.mutate(),
    isExpanding: expandMutation.isPending,
  };
}
