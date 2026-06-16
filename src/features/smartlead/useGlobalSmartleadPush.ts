import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import type { EnrichedCompany } from '@/hooks/useEnrichedCompanies';

/**
 * Push Smartlead global (Jay Reach 1.5.5).
 *
 * Pousse tous les leads d'un persona avec deliverability_status='valid' (toutes
 * entreprises enrichies confondues) sur Smartlead via manual_override. Le gate
 * backend revalide chaque envoi.
 *
 * Dé-hardcoding : ciblage par persona_id (et non plus par la target_category
 * legacy hr/director/field_sales). La campagne Smartlead est résolue côté
 * backend depuis smartlead_campaigns par persona_id.
 *
 * Extrait de ProspectionEntreprises.tsx pour sortir le fetch direct du composant.
 * Retourne l'objet useMutation (mutate / isPending / variables) tel quel.
 */
export function useGlobalSmartleadPush(companies: EnrichedCompany[]) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (personaId: string) => {
      const validProspects = companies.flatMap(c => c.profiles).filter(
        p => p.persona_id === personaId
          && p.deliverability_status === 'valid'
          && p.email
          && p.smartlead_push_decision !== 'push',
      );
      if (validProspects.length === 0) return { ok: 0, skipped: 0, failed: 0, total: 0 };
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session?.session?.access_token;
      if (!accessToken) throw new Error('Auth manquante : reconnecte-toi');
      let ok = 0, skipped = 0, failed = 0;
      for (const p of validProspects) {
        try {
          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-via-smartlead`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prospect_id: p.id, channel: 'email', manual_override: true }),
          });
          if (res.ok) ok++;
          else if (res.status === 422) skipped++;
          else failed++;
        } catch {
          failed++;
        }
      }
      return { ok, skipped, failed, total: validProspects.length };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['enriched-companies'] });
      toast({
        description: `${data.ok}/${data.total} pousse${data.ok > 1 ? 's' : ''} sur Smartlead${data.skipped > 0 ? ` · ${data.skipped} bloque${data.skipped > 1 ? 's' : ''} par le gate` : ''}${data.failed > 0 ? ` · ${data.failed} erreur${data.failed > 1 ? 's' : ''}` : ''}.`,
      });
    },
    onError: (err) => {
      toast({ variant: 'destructive', description: err instanceof Error ? err.message : 'Erreur push global' });
    },
  });
}
