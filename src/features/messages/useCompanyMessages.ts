import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useHasActiveBatches } from '@/hooks/useActiveProspectBatches';
import type { EnrichedCompany } from '@/hooks/useEnrichedCompanies';

/**
 * Message Smartlead generated/edited pour un prospect (Jay Reach 1.5.1).
 * Une ligne par (prospect_id, channel).
 */
export interface ProspectMessage {
  id: string;
  prospect_id: string;
  channel: string;
  subject: string | null;
  body: string;
  icebreaker: string | null;
  status: string;
}

/**
 * Charge tous les messages d'une entreprise (toutes personas confondues)
 * et expose une mutation pour relancer la generation cote backend.
 *
 * Auto-refetch quand un batch Anthropic est en cours (toutes les 30s).
 */
export function useCompanyMessages(company: EnrichedCompany) {
  const queryClient = useQueryClient();
  const hasActiveBatches = useHasActiveBatches();

  const messagesQuery = useQuery({
    queryKey: ['company-messages', company.company_group_id],
    refetchInterval: hasActiveBatches ? 30_000 : false,
    queryFn: async (): Promise<ProspectMessage[]> => {
      const profileIds = company.profiles.map((p) => p.id);
      if (profileIds.length === 0) return [];
      const { data } = await supabase
        .from('prospect_messages')
        .select('id, prospect_id, channel, subject, body, icebreaker, status')
        .in('prospect_id', profileIds);
      return (data || []) as ProspectMessage[];
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('generate-prospect-messages-bulk', {
        body: { mode: 'submit-batch', company_group_id: company.company_group_id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-prospect-batches'] });
      queryClient.invalidateQueries({ queryKey: ['company-messages', company.company_group_id] });
    },
  });

  return {
    messages: messagesQuery.data ?? [],
    isLoading: messagesQuery.isLoading,
    regenerate: regenerateMutation.mutate,
    isRegenerating: regenerateMutation.isPending,
  };
}
