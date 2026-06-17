import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useCurrentWorkspaceId } from '@/hooks/useCurrentWorkspaceId';

// =====================================================
// Track an action (copy message, open link)
// =====================================================

interface TrackActionPayload {
  prospectId: string;
  companyGroupId: string;
  actionType: 'copy' | 'open' | 'sent';
  channel: 'email' | 'instagram' | 'tiktok' | 'social_dm';
}

export function useTrackAction() {
  const queryClient = useQueryClient();
  const { data: workspaceId } = useCurrentWorkspaceId();

  return useMutation({
    mutationFn: async ({ prospectId, companyGroupId, actionType, channel }: TrackActionPayload) => {
      if (!workspaceId) throw new Error('No workspace for current user');
      const { error } = await supabase
        .from('prospect_actions')
        .insert({
          prospect_id: prospectId,
          workspace_id: workspaceId,
          company_group_id: companyGroupId,
          action_type: actionType,
          channel,
        });

      if (error) throw error;
    },
    // Optimistic update: reflect the action in progress cache immediately
    onMutate: async (variables) => {
      const queryKey = ['prospect-actions', variables.companyGroupId];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CompanyProgress>(queryKey);

      if (previous) {
        const byProspect = { ...previous.byProspect };
        const existing = byProspect[variables.prospectId] || new Set<string>();
        if (!existing.has(variables.channel)) {
          const next = new Set(existing);
          next.add(variables.channel);
          byProspect[variables.prospectId] = next;
          const completed = previous.completed + 1;
          queryClient.setQueryData<CompanyProgress>(queryKey, {
            ...previous,
            byProspect,
            completed,
            percent: previous.total > 0 ? Math.round((completed / previous.total) * 100) : 0,
          });
        }
      }

      return { previous, queryKey };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      toast({
        variant: 'destructive',
        description: `Suivi action échoué : ${err instanceof Error ? err.message : 'erreur inconnue'}`,
      });
    },
    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({ queryKey: ['prospect-actions', variables.companyGroupId] });
    },
  });
}

// =====================================================
// Get progress for a company (actions done / total possible)
// =====================================================

interface CompanyProgress {
  completed: number;
  total: number;
  percent: number;
  byProspect: Record<string, Set<string>>;
}

export function useCompanyProgress(companyGroupId: string | null) {
  return useQuery({
    queryKey: ['prospect-actions', companyGroupId],
    queryFn: async (): Promise<CompanyProgress> => {
      if (!companyGroupId) return { completed: 0, total: 0, percent: 0, byProspect: {} };

      // Fetch profiles for this company to compute total actions
      const { data: profiles } = await supabase
        .from('prospect_profiles')
        .select('id, linkedin_url, instagram_url, tiktok_url, persona:persona_id(slug)')
        .eq('company_group_id', companyGroupId);

      // Count expected actions per profile selon le persona slug.
      //  - 1 action principale (email pour tous les personas)
      //  - 1 action LinkedIn (auto-invite) si linkedin_url present
      //  - +1 par autre reseau social (field-sales uniquement)
      let total = 0;
      for (const p of (profiles || []) as unknown as Array<{ linkedin_url: string | null; instagram_url: string | null; tiktok_url: string | null; persona: { slug: string } | null }>) {
        const slug = p.persona?.slug;
        if (slug === 'hr-decision-maker') total += 1;
        if (slug === 'director') total += 1;
        if (p.linkedin_url) total += 1;
        if (slug === 'field-sales') {
          if (p.instagram_url) total += 1;
          if (p.tiktok_url) total += 1;
        }
      }

      // Fetch completed actions
      const { data: actions } = await supabase
        .from('prospect_actions')
        .select('prospect_id, channel')
        .eq('company_group_id', companyGroupId);

      // Deduplicate: one action per (prospect_id, channel)
      const seen = new Set<string>();
      const byProspect: Record<string, Set<string>> = {};
      for (const a of actions || []) {
        const key = `${a.prospect_id}:${a.channel}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (!byProspect[a.prospect_id]) byProspect[a.prospect_id] = new Set();
          byProspect[a.prospect_id]?.add(a.channel);
        }
      }

      const completed = seen.size;
      return {
        completed,
        total,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0,
        byProspect,
      };
    },
    enabled: !!companyGroupId,
  });
}

// =====================================================
// Progress de toutes les entreprises en une requete
// Pour le tri (ex: 100% en bas de liste). Plus efficace que N useCompanyProgress.
// =====================================================

export function useAllCompaniesProgress() {
  return useQuery({
    queryKey: ['prospect-actions', 'all'],
    queryFn: async (): Promise<Record<string, { percent: number; completed: number; total: number }>> => {
      // 2026-05-21 : passe sur RPC get_all_companies_progress qui agrege cote
      // DB. Avant : 2 SELECT sans limite tronquaient a 1000 rows et le
      // pourcentage etait faux pour les workspaces > 1000 profils.
      const { data, error } = await supabase.rpc('get_all_companies_progress');
      if (error) throw error;
      return (data as Record<string, { percent: number; completed: number; total: number }>) ?? {};
    },
  });
}
