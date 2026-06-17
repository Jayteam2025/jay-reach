import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export interface WorkspaceSettings {
  crm_detection_enabled?: boolean;
  [key: string]: unknown;
}

const KEY = ['workspace-settings'] as const;

/**
 * Hook pour lire les settings (jsonb) du workspace courant.
 */
export function useWorkspaceSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<WorkspaceSettings> => {
      // RLS filtre automatiquement sur les workspaces accessibles à l'user.
      const { data, error } = await supabase
        .from('workspaces')
        .select('settings')
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('[useWorkspaceSettings] fetch failed', { error });
        throw error;
      }
      return (data?.settings as WorkspaceSettings) ?? {};
    },
  });
}

/**
 * Hook pour mettre à jour un setting spécifique du workspace.
 * Effectue un merge du setting spécifié plutôt qu'une remise à zéro.
 */
export function useUpdateWorkspaceSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; value: unknown }) => {
      const { key, value } = input;
      // Lecture du settings courant pour faire un merge
      const { data: current, error: readErr } = await supabase
        .from('workspaces')
        .select('settings')
        .limit(1)
        .maybeSingle();
      if (readErr) throw readErr;
      const currentSettings = (current?.settings as WorkspaceSettings) ?? {};

      // Merge : on crée une copie shallow du settings courant + on mets à jour la clé
      const newSettings = { ...currentSettings, [key]: value };

      // Upsert du settings (tous les workspaces du user ont au moins 1 row)
      const { error } = await supabase
        .from('workspaces')
        .update({ settings: newSettings })
        .limit(1);
      if (error) throw error;

      return newSettings;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

/**
 * Hook pratique pour lire un setting booléen spécifique (ex. crm_detection_enabled).
 * Retourne la valeur ou false si absent.
 */
export function useWorkspaceBooleanSetting(settingKey: string): boolean {
  const { data: settings } = useWorkspaceSettings();
  return (settings?.[settingKey] as boolean) ?? false;
}
