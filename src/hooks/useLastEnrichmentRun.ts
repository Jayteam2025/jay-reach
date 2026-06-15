import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Renvoie l'ensemble des company_group_id enrichis lors du DERNIER run
 * d'enrichissement (job le plus recent du workspace). Sert au filtre
 * "Dernier run" de l'onglet Entreprises > Enrichies.
 *
 * Recalcule a chaque run (la liste suit toujours le dernier job). Filtre
 * d'affichage non destructif : les anciennes entreprises restent dans "Toutes".
 */
export function useLastEnrichmentRunCompanyIds() {
  return useQuery({
    queryKey: ['last-enrichment-run-company-ids'],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.rpc('get_last_enrichment_run_company_ids');
      if (error) throw error;
      return new Set(
        ((data ?? []) as Array<{ company_group_id: string }>).map((r) => r.company_group_id),
      );
    },
  });
}
