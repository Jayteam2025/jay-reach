import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface IcpFilter {
  id: string;
  name: string;
  criteria: {
    sectors?: string[];
    company_sizes?: string[];
    regions?: string[];
    job_keywords: string[];
    exclude_keywords?: string[];
    min_score?: number;
  };
  is_active: boolean;
  created_at: string;
}

export interface ProspectTemplate {
  id: string;
  name: string;
  channel: string;
  system_prompt: string;
  user_prompt_template: string;
  is_active: boolean;
}

export interface ProspectSequence {
  id: string;
  name: string;
  steps?: Array<{
    channel: string;
    delay_days?: number;
    day?: number;
  }>;
  is_active: boolean;
  created_at: string;
}

export function useIcpFilters() {
  return useQuery({
    queryKey: ['prospect-icp-filters'],
    queryFn: async () => {
      const { data, error } = await supabase.from('prospect_icp_filters').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as IcpFilter[];
    },
  });
}

export function useProspectTemplates() {
  return useQuery({
    queryKey: ['prospect-templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('prospect_templates').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as ProspectTemplate[];
    },
  });
}

export function useProspectSequences() {
  return useQuery({
    queryKey: ['prospect-sequences'],
    queryFn: async () => {
      const { data, error } = await supabase.from('prospect_sequences').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
