/**
 * Workspace brand loader + template renderer (Jay Reach 1.3.2).
 *
 * Permet a chaque workspace de definir ses propres variables (founder_name,
 * product_pitch, brand_name, signature, app_url, notification_recipients)
 * et de les injecter dans les prompts LLM + templates email via une
 * substitution {{variable}} stricte.
 *
 * Aucun fallback Jay-specifique cote code : si le workspace n'a pas configure
 * une variable utilisee dans un prompt, le render leve une erreur explicite.
 * C'est volontaire : on veut un signal fort plutot qu'un message contenant
 * "{{founder_name}}" envoye en prod.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface WorkspaceBrand {
  workspace_id: string;
  brand_name: string | null;
  signature: string | null;
  hero_image_url: string | null;
  founder_name: string | null;
  product_pitch: string | null;
  app_url: string | null;
  notification_recipients: string[];
  attachments: unknown[];
}

export async function loadWorkspaceBrand(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceBrand | null> {
  const { data, error } = await supabase
    .from('workspace_brand')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) {
    console.error('[workspace-brand] load failed', error);
    throw new Error(`Failed to load workspace_brand: ${error.message}`);
  }
  return data as WorkspaceBrand | null;
}

/**
 * Substitue {{var}} dans un template. Leve si une variable utilisee
 * n'est pas resolue ou si {{}} traine apres render (defense in depth :
 * un message contenant {{x}} envoye en prod = catastrophe UX).
 */
export function renderTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`renderTemplate: variable "${key}" manquante ou vide`);
    }
    return value;
  });

  if (rendered.includes('{{') || rendered.includes('}}')) {
    throw new Error(`renderTemplate: marqueurs {{ ou }} restent apres render`);
  }

  return rendered;
}

/**
 * Convertit un brand en map de variables utilisable par renderTemplate.
 * Cle stable utilisee dans tous les prompts du codebase.
 */
export function brandToVars(brand: WorkspaceBrand): Record<string, string | null> {
  return {
    brand_name: brand.brand_name,
    founder_name: brand.founder_name,
    product_pitch: brand.product_pitch,
    signature: brand.signature,
    app_url: brand.app_url,
  };
}
