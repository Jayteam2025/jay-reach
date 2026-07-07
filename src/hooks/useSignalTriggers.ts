import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export type SignalTrigger = {
  id: string;
  workspace_id: string;
  slug: string;
  label: string;
  description: string | null;
  icon: string | null;
  search_keywords: string[];
  exclude_keywords: string[];
  source_types: string[];
  industry_filters: string[];
  geo_filters: Array<{ country?: string; regions?: string[]; cities?: string[] }>;
  signal_scoring_prompt: string;
  signal_match_threshold: number;
  elimination_rules: unknown[];
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type SignalTriggerDraft = Omit<
  SignalTrigger,
  'id' | 'workspace_id' | 'created_at' | 'updated_at' | 'created_by'
> & {
  id?: string;
};

const SIGNAL_TRIGGERS_KEY = ['signal-triggers'] as const;

export function useSignalTriggers() {
  return useQuery({
    queryKey: SIGNAL_TRIGGERS_KEY,
    queryFn: async (): Promise<SignalTrigger[]> => {
      const { data, error } = await supabase
        .from('signal_triggers')
        .select('*')
        .order('is_default', { ascending: false })
        .order('label', { ascending: true });

      if (error) {
        logger.error('[useSignalTriggers] fetch failed', { error });
        throw error;
      }
      return (data ?? []) as SignalTrigger[];
    },
  });
}

export function useUpsertSignalTrigger() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (draft: SignalTriggerDraft & { workspace_id: string }) => {
      const { id, ...payload } = draft;

      if (id) {
        const { data, error } = await supabase
          .from('signal_triggers')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return data as SignalTrigger;
      }

      const { data, error } = await supabase
        .from('signal_triggers')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as SignalTrigger;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SIGNAL_TRIGGERS_KEY });
    },
  });
}

export function useDeleteSignalTrigger() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('signal_triggers').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SIGNAL_TRIGGERS_KEY });
    },
  });
}

// Seules les sources réellement scrapées par scrape-job-signals (SCRAPER_BY_SOURCE) :
// brave / linkedin_jobs / google_alerts n'ont pas de scraper → retirées.
export const KNOWN_SOURCE_TYPES = [
  'adzuna',
  'france_travail',
  'apify_linkedin',
] as const;

export type SourceType = (typeof KNOWN_SOURCE_TYPES)[number];
