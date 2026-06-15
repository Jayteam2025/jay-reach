import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export interface ArchivedSignal {
  id: string;
  company_name: string | null;
  ai_score: string | null;
  archived_at: string;
}

/**
 * Signaux archivés (onglet « Archivés »). Chargé À LA DEMANDE : `enabled`
 * ne devient true que quand l'onglet est actif (les archivés ne sont pas
 * dans le set principal). RPC paginée get_archived_signals (cf mémoire
 * scaling-prospection-rpcs : pas de SELECT direct sur prospect_*).
 */
export function useArchivedSignals(enabled: boolean, limit = 100) {
  return useQuery({
    queryKey: ['archived-signals', limit],
    enabled,
    queryFn: async (): Promise<ArchivedSignal[]> => {
      const { data, error } = await supabase.rpc('get_archived_signals', {
        p_limit: limit,
        p_offset: 0,
      });
      if (error) {
        logger.error('[ARCHIVED_SIGNALS] RPC error', error);
        throw error;
      }
      return (data ?? []) as ArchivedSignal[];
    },
  });
}

/**
 * Compteur des archivés — TOUJOURS chargé (le badge de l'onglet reste visible
 * même hors vue Archivés). Count-only (`head: true`) → aucune ligne transférée ;
 * RLS scope au workspace courant.
 */
export function useArchivedCount() {
  return useQuery({
    queryKey: ['archived-signals-count'],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('prospect_signals')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'archived')
        .eq('signal_type', 'job_posting');
      if (error) {
        logger.error('[ARCHIVED_SIGNALS] count error', error);
        throw error;
      }
      return count ?? 0;
    },
  });
}
