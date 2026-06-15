import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useProspectStats() {
  return useQuery({
    queryKey: ['prospect-stats'],
    queryFn: async () => {
      // Parallel queries for stats
      const [profilesRes, signalsRes, messagesRes] = await Promise.all([
        supabase
          .from('prospect_profiles')
          .select('status', { count: 'exact', head: false })
          .is('deleted_at', null),
        // Exclut les dismissed du compteur Signaux : les rejetes (cabinets,
        // fragments...) ne doivent pas gonfler le KPI affiche au dashboard.
        supabase
          .from('prospect_signals')
          .select('status, source', { count: 'exact', head: false })
          .neq('status', 'dismissed'),
        supabase
          .from('prospect_messages')
          .select('status, channel', { count: 'exact', head: false }),
      ]);

      const prospects = profilesRes.data || [];
      const signals = signalsRes.data || [];
      const messages = messagesRes.data || [];

      // Count by status
      const prospectsByStatus: Record<string, number> = {};
      prospects.forEach(p => {
        prospectsByStatus[p.status] = (prospectsByStatus[p.status] || 0) + 1;
      });

      const signalsByStatus: Record<string, number> = {};
      signals.forEach(s => {
        signalsByStatus[s.status] = (signalsByStatus[s.status] || 0) + 1;
      });

      const messagesByStatus: Record<string, number> = {};
      messages.forEach(m => {
        messagesByStatus[m.status] = (messagesByStatus[m.status] || 0) + 1;
      });

      return {
        totalProspects: prospects.length,
        prospectsByStatus,
        totalSignals: signals.length,
        signalsByStatus,
        totalMessages: messages.length,
        messagesByStatus,
      };
    },
  });
}
