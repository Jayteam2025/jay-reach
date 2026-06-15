import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Returns a map of normalized company name → company_group_id for all enriched companies.
 * Used to detect when a LinkedIn contact's company is also in the Entreprises flow.
 *
 * 2026-05-21 : passe sur RPC get_company_name_map qui agrege cote DB.
 * Avant : SELECT * sans limite tronquait a 1000 rows et ratait les matches.
 */
export function useCrossDetection() {
  return useQuery({
    queryKey: ['cross-detection'],
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.rpc('get_company_name_map');
      if (error) throw error;
      const obj = (data as Record<string, string>) ?? {};
      return new Map(Object.entries(obj));
    },
  });
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(sas|sa|sarl|eurl|sasu|group|groupe|france|international|holding)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}
