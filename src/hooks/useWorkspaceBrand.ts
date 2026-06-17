import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export interface BrandAttachment {
  persona_id?: string | null;
  channel?: string | null;
  type: 'inline_image';
  url: string;
  alt?: string | null;
}

export interface WorkspaceBrand {
  workspace_id: string;
  brand_name: string | null;
  signature: string | null;
  hero_image_url: string | null;
  /** Nom du founder/auteur (Jay Reach 1.3.2). Substitue {{founder_name}} dans les prompts LLM. */
  founder_name: string | null;
  /** Court resume du produit pour le system prompt. Substitue {{product_pitch}}. */
  product_pitch: string | null;
  /** URL de l app, utilisee dans les emails recap (CTA). */
  app_url: string | null;
  /** Liste d emails recevant les notifications hebdo. Vide = pas d envoi. */
  notification_recipients: string[];
  attachments: BrandAttachment[];
  created_at: string;
  updated_at: string;
}

const KEY = ['workspace-brand'] as const;

export function useWorkspaceBrand() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<WorkspaceBrand | null> => {
      // RLS filtre automatiquement sur les workspaces accessibles a l'user.
      // 1-1 par workspace : un seul row attendu.
      const { data, error } = await supabase
        .from('workspace_brand')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('[useWorkspaceBrand] fetch failed', { error });
        throw error;
      }
      return data as WorkspaceBrand | null;
    },
  });
}

export interface BrandUpdate {
  workspace_id: string;
  brand_name?: string | null;
  signature?: string | null;
  hero_image_url?: string | null;
  founder_name?: string | null;
  product_pitch?: string | null;
  app_url?: string | null;
  notification_recipients?: string[];
  attachments?: BrandAttachment[];
}

export function useUpdateWorkspaceBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BrandUpdate) => {
      const { workspace_id, ...payload } = input;
      const { data, error } = await supabase
        .from('workspace_brand')
        .upsert({ workspace_id, ...payload }, { onConflict: 'workspace_id' })
        .select()
        .single();
      if (error) throw error;
      return data as WorkspaceBrand;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
