import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export type IcpPersona = {
  id: string;
  workspace_id: string;
  slug: string;
  label: string;
  description: string | null;
  icon: string | null;
  job_title_keywords: string[];
  seniority_levels: string[];
  department_patterns: string[];
  exclude_titles: string[];
  persona_scoring_prompt: string;
  search_strategy?: 'by_titles' | 'seniority_cast_wide';
  enrichment_caps?: { search_max: number; keep_cap: number | null; min_contacts: number };
  persona_match_threshold: number;
  channels_priority: string[];
  channels_config: Record<string, unknown>;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type IcpPersonaDraft = Omit<
  IcpPersona,
  'id' | 'workspace_id' | 'created_at' | 'updated_at' | 'created_by'
> & {
  id?: string;
};

const ICP_PERSONAS_KEY = ['icp-personas'] as const;

export function useIcpPersonas() {
  return useQuery({
    queryKey: ICP_PERSONAS_KEY,
    queryFn: async (): Promise<IcpPersona[]> => {
      const { data, error } = await supabase
        .from('icp_personas')
        .select('*')
        .order('is_default', { ascending: false })
        .order('label', { ascending: true });

      if (error) {
        logger.error('[useIcpPersonas] fetch failed', { error });
        throw error;
      }
      return (data ?? []) as IcpPersona[];
    },
  });
}

export function useUpsertIcpPersona() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (draft: IcpPersonaDraft & { workspace_id: string }) => {
      const { id, ...payload } = draft;

      if (id) {
        const { data, error } = await supabase
          .from('icp_personas')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return data as IcpPersona;
      }

      const { data, error } = await supabase
        .from('icp_personas')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as IcpPersona;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ICP_PERSONAS_KEY });
    },
  });
}

export function useDeleteIcpPersona() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('icp_personas').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ICP_PERSONAS_KEY });
    },
  });
}

// Seuls les canaux d'outreach réellement gérés par le code (Smartlead = email,
// extension = linkedin). instagram / tiktok / postal_letter non implémentés → retirés.
export const KNOWN_CHANNELS = [
  'email',
  'linkedin',
] as const;

export const KNOWN_SENIORITY_LEVELS = [
  'individual_contributor',
  'manager',
  'director',
  'c_level',
] as const;

export type IcpChannel = (typeof KNOWN_CHANNELS)[number];
export type IcpSeniority = (typeof KNOWN_SENIORITY_LEVELS)[number];
