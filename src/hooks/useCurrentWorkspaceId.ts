import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Resout le workspace_id de l'user courant via workspace_members.
 * Cache infini (un user a 1 seul workspace en V1, pas de changement runtime).
 * Renvoie null si pas authentifie ou pas de membership.
 */
export function useCurrentWorkspaceId() {
  return useQuery({
    queryKey: ['current-workspace-id'],
    staleTime: Infinity,
    queryFn: async (): Promise<string | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return (data?.workspace_id as string) ?? null;
    },
  });
}
