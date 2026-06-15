import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ProspectSignal } from '@/hooks/useProspectSignals';
import { useHasActiveBatches } from '@/hooks/useActiveProspectBatches';

export type LinkedInContactStatus = 'nouveau' | 'ajoute' | 'message_envoye' | 'ignore';

export interface LinkedInContact extends ProspectSignal {
  contact_status: LinkedInContactStatus;
}

function deriveStatus(signal: ProspectSignal): LinkedInContactStatus {
  const ed = (signal.extracted_data) || {};
  const s = ed.contact_status as string | undefined;
  if (s === 'ajoute' || s === 'message_envoye' || s === 'ignore') return s;
  return 'nouveau';
}

export function useLinkedInContacts() {
  const hasActiveBatches = useHasActiveBatches();
  return useQuery({
    queryKey: ['linkedin-contacts'],
    refetchInterval: hasActiveBatches ? 45_000 : false,
    queryFn: async (): Promise<LinkedInContact[]> => {
      const { data, error } = await supabase
        .from('prospect_signals')
        .select('*')
        .eq('source', 'linkedin')
        .eq('signal_type', 'direct_listing')
        .neq('status', 'dismissed')
        .order('detected_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      return (data || []).map((s: ProspectSignal) => ({
        ...s,
        contact_status: deriveStatus(s),
      }));
    },
  });
}

export function useUpdateLinkedInStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ signalId, status }: { signalId: string; status: LinkedInContactStatus }) => {
      const { data: current, error: fetchErr } = await supabase
        .from('prospect_signals')
        .select('extracted_data')
        .eq('id', signalId)
        .single();
      if (fetchErr) throw fetchErr;

      const currentData = (current?.extracted_data as Record<string, unknown>) || {};
      const updated = { ...currentData, contact_status: status };

      const { error } = await supabase
        .from('prospect_signals')
        .update({ extracted_data: updated })
        .eq('id', signalId);

      if (error) throw error;
    },
    onMutate: async ({ signalId, status }) => {
      const queryKey = ['linkedin-contacts'];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<LinkedInContact[]>(queryKey);

      if (previous) {
        const next = previous.map(c =>
          c.id === signalId
            ? {
                ...c,
                contact_status: status,
                extracted_data: {
                  ...((c.extracted_data) || {}),
                  contact_status: status,
                },
              }
            : c
        );
        queryClient.setQueryData<LinkedInContact[]>(queryKey, next);
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['linkedin-contacts'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-contacts'] });
    },
  });
}
