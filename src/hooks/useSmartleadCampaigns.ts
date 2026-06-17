import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Mapping persona -> campagne Smartlead (1 par persona, contrainte unique workspace+persona). */
export interface SmartleadCampaignMapping {
  id: string;
  workspace_id: string;
  persona_id: string;
  campaign_id: string;
  campaign_name: string | null;
  enabled: boolean;
}

/** Campagne renvoyee par l'API Smartlead (pour le dropdown). */
export interface SmartleadCampaignOption {
  id: number;
  name: string;
  status: string;
}

const MAPPINGS_KEY = ['smartlead-campaign-mappings'] as const;
const LIST_KEY = ['smartlead-campaign-list'] as const;

/** Les lignes de mapping deja enregistrees (smartlead_campaigns). */
export function useSmartleadCampaignMappings() {
  return useQuery({
    queryKey: MAPPINGS_KEY,
    queryFn: async (): Promise<SmartleadCampaignMapping[]> => {
      const { data, error } = await supabase
        .from('smartlead_campaigns')
        .select('id, workspace_id, persona_id, campaign_id, campaign_name, enabled');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Liste live des campagnes du compte Smartlead (via edge fn, resout la cle du workspace). */
export interface SmartleadCampaignListResult {
  ok: boolean;
  campaigns?: SmartleadCampaignOption[];
  error?: string;
}

export function useSmartleadCampaignList() {
  return useQuery({
    queryKey: LIST_KEY,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<SmartleadCampaignListResult> => {
      const { data, error } = await supabase.functions.invoke('list-smartlead-campaigns', {
        body: {},
      });
      if (error) throw error;
      return data as SmartleadCampaignListResult;
    },
  });
}

/** Upsert d'un mapping (1 campagne par persona). On conflit (workspace_id, persona_id) -> update. */
export function useUpsertSmartleadCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      workspace_id: string;
      persona_id: string;
      campaign_id: string;
      campaign_name: string | null;
      enabled: boolean;
    }) => {
      const { data, error } = await supabase
        .from('smartlead_campaigns')
        .upsert(input, { onConflict: 'workspace_id,persona_id' })
        .select()
        .single();
      if (error) throw error;
      return data as SmartleadCampaignMapping;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MAPPINGS_KEY }),
  });
}

/** Retire le mapping d'un persona (option « Aucune campagne »). */
export function useDeleteSmartleadCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('smartlead_campaigns').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MAPPINGS_KEY }),
  });
}
