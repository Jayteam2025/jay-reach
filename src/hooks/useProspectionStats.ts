import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ProspectionStats {
  scored: number;
  enriched: number;
  scrape_count: number;
  import_count: number;
  push_counts: {
    hr: number;
    director: number;
    field_sales: number;
  };
  push_sent_counts: {
    hr: number;
    director: number;
    field_sales: number;
  };
}

/**
 * Agregats dashboard prospection (cote DB, 1 RPC).
 * Remplace les calculs JS qui plantaient a >1000 profils.
 */
export function useProspectionStats() {
  return useQuery({
    queryKey: ['prospection-stats'],
    staleTime: 30_000,
    queryFn: async (): Promise<ProspectionStats> => {
      const { data, error } = await supabase.rpc('get_prospection_dashboard_stats');
      if (error) throw error;
      return data as ProspectionStats;
    },
  });
}
