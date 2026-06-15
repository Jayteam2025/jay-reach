// Helper : resoudre le workspace_id d'un user a partir de son user_id.
// Pour V1 Jay : un user = un seul workspace (membership 1-1).
// Cache in-memory pendant l'execution de l'edge function.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const cache = new Map<string, string | null>();

export async function resolveUserWorkspace(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  if (cache.has(userId)) return cache.get(userId) ?? null;
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[workspace] resolveUserWorkspace failed for user=${userId}: ${error.message}`);
    cache.set(userId, null);
    return null;
  }
  const workspaceId = (data?.workspace_id as string | undefined) ?? null;
  cache.set(userId, workspaceId);
  return workspaceId;
}
