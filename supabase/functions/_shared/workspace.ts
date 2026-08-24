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

// Contrôle d'appartenance : l'utilisateur est-il membre de CE workspace ?
// A ne pas confondre avec resolveUserWorkspace ci-dessus, qui renvoie le premier
// workspace trouvé et ne convient donc pas à une décision d'autorisation.
// Pas de cache : un contrôle d'accès ne doit pas servir une réponse périmée.
// Fail-closed : toute erreur de lecture refuse l'accès.
const ROLE_RANK: Record<string, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

export type WorkspaceRole = "viewer" | "member" | "admin" | "owner";

export async function isWorkspaceMember(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  minRole: WorkspaceRole = "viewer",
): Promise<boolean> {
  if (!userId || !workspaceId) return false;
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    console.warn(`[workspace] isWorkspaceMember failed for user=${userId}: ${error.message}`);
    return false;
  }
  if (!data) return false;
  return (ROLE_RANK[data.role as string] ?? 0) >= ROLE_RANK[minRole];
}
