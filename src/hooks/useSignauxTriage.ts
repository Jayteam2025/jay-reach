import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ProspectSignal } from '@/hooks/useProspectSignals';

/**
 * Données de l'écran Signaux (file de tri façon inbox, spec §4).
 * Réutilise la table prospect_signals. Mapping des onglets sur les statuts
 * existants (contrainte status ∈ raw/matched/dismissed/archived) :
 *   À traiter = 'raw' · Validées = 'matched' · Rejetées = 'dismissed'|'archived'.
 */
export type TriageBucket = 'todo' | 'validated' | 'rejected';

export function useSignaux() {
  return useQuery({
    queryKey: ['signaux-triage'],
    staleTime: 15_000,
    queryFn: async (): Promise<ProspectSignal[]> => {
      const { data, error } = await supabase
        .from('prospect_signals')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ProspectSignal[];
    },
  });
}

/** Valider (raw→matched) ou rejeter (raw→dismissed) un signal, ou le remettre à traiter. */
export function useSetSignalStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'matched' | 'dismissed' | 'raw' }) => {
      const { error } = await supabase.from('prospect_signals').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['signaux-triage'] });
      void qc.invalidateQueries({ queryKey: ['prospect-signals'] });
    },
  });
}

/** Valider en masse tous les signaux passés (raw→matched). */
export function useBulkValidateSignals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from('prospect_signals').update({ status: 'matched' }).in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['signaux-triage'] });
      void qc.invalidateQueries({ queryKey: ['prospect-signals'] });
    },
  });
}

export function bucketOf(status: string): TriageBucket {
  if (status === 'matched') return 'validated';
  if (status === 'dismissed' || status === 'archived') return 'rejected';
  return 'todo';
}
