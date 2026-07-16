import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Données de l'écran Dashboard (résultats de prospection).
 * Alimenté par 3 RPCs côté DB (migration dashboard_results_backend) :
 * get_dashboard_kpis / get_dashboard_activity / get_dashboard_alerts,
 * toutes scopées au workspace du membre courant. Le panier moyen se règle
 * via set_workspace_deal_size (rangé dans workspaces.settings).
 */
export type DashboardPeriod = '7d' | '30d' | '3m';

export interface DashboardKpis {
  period: string;
  replies: number;
  replies_prev: number;
  positive_replies: number;
  positive_pct: number;
  meetings: number;
  meetings_prev: number;
  /** Panier moyen paramétré (€), null tant que non défini → carte Pipeline masquée. */
  deal_size: number | null;
  pipeline: number | null;
  pipeline_prev: number | null;
}

export interface DashboardActivityBucket {
  /** Début de bucket au format YYYY-MM-DD. */
  bucket: string;
  linkedin_invites: number;
  emails: number;
  linkedin_messages: number;
  replies: number;
}

export interface DashboardAlert {
  severity: 'critical' | 'opportunity' | 'info';
  icon: string;
  text: string;
  action_label: string;
  action_target: string;
}

export function useDashboardKpis(period: DashboardPeriod) {
  return useQuery({
    queryKey: ['dashboard-kpis', period],
    staleTime: 30_000,
    queryFn: async (): Promise<DashboardKpis> => {
      const { data, error } = await supabase.rpc('get_dashboard_kpis', { p_period: period });
      if (error) throw error;
      return data as DashboardKpis;
    },
  });
}

export function useDashboardActivity(period: DashboardPeriod) {
  return useQuery({
    queryKey: ['dashboard-activity', period],
    staleTime: 30_000,
    queryFn: async (): Promise<DashboardActivityBucket[]> => {
      const { data, error } = await supabase.rpc('get_dashboard_activity', { p_period: period });
      if (error) throw error;
      return (data ?? []) as DashboardActivityBucket[];
    },
  });
}

export function useDashboardAlerts(period: DashboardPeriod) {
  return useQuery({
    queryKey: ['dashboard-alerts', period],
    staleTime: 30_000,
    queryFn: async (): Promise<DashboardAlert[]> => {
      const { data, error } = await supabase.rpc('get_dashboard_alerts', { p_period: period });
      if (error) throw error;
      return (data ?? []) as DashboardAlert[];
    },
  });
}

/** Règle (ou efface, si null/<=0) le panier moyen du workspace. */
export function useSetDealSize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: number | null) => {
      const { error } = await supabase.rpc('set_workspace_deal_size', { p_value: value });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dashboard-kpis'] });
    },
  });
}
