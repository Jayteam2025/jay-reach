import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type ProviderCategory = 'outreach' | 'validator' | 'enricher' | 'source' | 'llm';

export interface WorkspaceProvider {
  id: string;
  workspace_id: string;
  category: ProviderCategory;
  provider_type: string;
  channel: 'email' | null;
  is_active: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  credential_last4: string | null;
  credential_set_at: string | null;
  last_test_status: 'ok' | 'error' | null;
  last_test_at: string | null;
  last_test_detail: string | null;
}

const KEY = ['workspace-providers'] as const;

export function useWorkspaceProviders() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<WorkspaceProvider[]> => {
      const { data, error } = await supabase
        .from('workspace_providers')
        .select('*')
        .order('category', { ascending: true })
        .order('provider_type', { ascending: true });

      if (error) throw error;
      return (data ?? []) as WorkspaceProvider[];
    },
  });
}

export function useToggleWorkspaceProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; is_active: boolean }) => {
      const { data, error } = await supabase
        .from('workspace_providers')
        .update({ is_active: input.is_active })
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw error;
      return data as WorkspaceProvider;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetProviderCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { provider_id: string; credentials: Record<string, string> }) => {
      const { data, error } = await supabase.functions.invoke('set-provider-credential', {
        body: input,
      });
      if (error) throw error;
      return data as { ok: boolean; last4: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export interface ProviderTestResult {
  ok: boolean;
  provider_type?: string;
  latency_ms: number;
  info?: Record<string, unknown>;
  error?: string;
}

export function useTestProviderConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { provider_id: string }): Promise<ProviderTestResult> => {
      const { data, error } = await supabase.functions.invoke('test-provider-connection', {
        body: input,
      });
      if (error) throw error;
      return data as ProviderTestResult;
    },
    // Le test persiste last_test_status/at/detail cote serveur : on refetch pour
    // que la pastille de statut passe a "Connecte"/"Erreur" sans refresh manuel.
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export interface CreateProviderInput {
  workspace_id: string;
  category: ProviderCategory;
  provider_type: string;
  channel?: 'email' | null;
}

export function useCreateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProviderInput) => {
      const { data, error } = await supabase
        .from('workspace_providers')
        .insert({
          workspace_id: input.workspace_id,
          category: input.category,
          provider_type: input.provider_type,
          channel: input.channel ?? null,
          is_active: false,
          config: {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as WorkspaceProvider;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string }) => {
      const { error } = await supabase
        .from('workspace_providers')
        .delete()
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
