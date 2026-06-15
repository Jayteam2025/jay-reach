import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useDebounce } from './useDebounce';

export interface ProspectCompanySearchResult {
  company_group_id: string;
  company_name: string;
  similarity: number;
  profile_count: number;
  max_created_at: string;
}

/**
 * Recherche server-side fuzzy via RPC + trigram GIN index. Debounce 300ms.
 * Min 2 chars sinon return [] sans appel reseau.
 */
export function useSearchProspectCompanies(query: string, limit = 20) {
  const debounced = useDebounce(query.trim(), 300);

  return useQuery({
    queryKey: ['search-prospect-companies', debounced, limit],
    enabled: debounced.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<ProspectCompanySearchResult[]> => {
      const { data, error } = await supabase.rpc('search_prospect_companies', {
        p_query: debounced,
        p_limit: limit,
      });
      if (error) throw error;
      return (data as ProspectCompanySearchResult[]) ?? [];
    },
  });
}
