import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { ProspectSignal } from '@/hooks/useProspectSignals';

/**
 * Données de l'écran Signaux (file de tri façon inbox, spec §4).
 * Réutilise la table prospect_signals. Mapping des onglets sur les statuts
 * (contrainte status ∈ raw/validated/matched/dismissed/archived) :
 *   À traiter = 'raw' · Validées = 'validated' (+ 'matched' déjà enrichis) ·
 *   Rejetées = 'dismissed'|'archived'.
 * Valider pose 'validated' (pas 'matched') : le signal reste dans le backlog
 * d'enrichissement (scoredSignals) au lieu d'en sortir sans être enrichi.
 */
export type TriageBucket = 'todo' | 'validated' | 'rejected';

export function useSignaux() {
  return useQuery({
    queryKey: ['signaux-triage'],
    staleTime: 15_000,
    queryFn: async (): Promise<ProspectSignal[]> => {
      // Plafond volontairement large : à 500 les compteurs du Dashboard étaient
      // tronqués en silence (workspaces > 500 signaux). 5000 couvre les volumes
      // réels par workspace ; au-delà, passer sur une agrégation server-side.
      const { data, error } = await supabase
        .from('prospect_signals')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as ProspectSignal[];
    },
  });
}

/** Valider (raw→validated) ou rejeter (raw→dismissed) un signal, ou le remettre à traiter. */
export function useSetSignalStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'validated' | 'matched' | 'dismissed' | 'raw' }) => {
      const { error } = await supabase.from('prospect_signals').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['signaux-triage'] });
      void qc.invalidateQueries({ queryKey: ['prospect-signals'] });
    },
    onError: () => {
      toast.error('Impossible de mettre à jour le signal.');
    },
  });
}

/** Valider en masse tous les signaux passés (raw→validated). */
export function useBulkValidateSignals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from('prospect_signals').update({ status: 'validated' }).in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['signaux-triage'] });
      void qc.invalidateQueries({ queryKey: ['prospect-signals'] });
    },
    onError: () => {
      toast.error('Impossible de valider les signaux.');
    },
  });
}

export function bucketOf(status: string): TriageBucket {
  // 'validated' = validé par l'utilisateur ; 'matched' = déjà enrichi. Les deux
  // s'affichent dans l'onglet « Validées ».
  if (status === 'validated' || status === 'matched') return 'validated';
  if (status === 'dismissed' || status === 'archived') return 'rejected';
  return 'todo';
}
