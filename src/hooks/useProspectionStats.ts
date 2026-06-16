import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface PersonaPushCount {
  persona_id: string;
  /** Profils deliverability_status=valid pas encore poussés vers Smartlead. */
  pushable: number;
  /** Profils déjà poussés (smartlead_push_decision='push'). */
  sent: number;
}

export interface ProspectionStats {
  scored: number;
  enriched: number;
  scrape_count: number;
  import_count: number;
  /** Compteurs de push groupés par persona_id (dé-hardcoding : plus de hr/director/field_sales). */
  push_by_persona: PersonaPushCount[];
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
