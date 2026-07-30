import { useQuery } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

/**
 * Stats réelles d'une campagne Smartlead (analytics + séquence), via l'edge
 * function get-smartlead-campaign-stats. Alimente l'en-tête de l'écran Campagnes
 * dès que la clé API Smartlead est configurée (onglet Providers).
 */
export interface SmartleadAnalytics {
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  open_rate: number | null;
  reply_rate: number | null;
}

export interface SmartleadSeqStep {
  seq_number: number;
  delay_days: number;
  subject: string;
}

export interface SmartleadStatsResult {
  ok: boolean;
  error?: string;
  analytics?: SmartleadAnalytics | null;
  sequence?: SmartleadSeqStep[];
}

export function useSmartleadCampaignStats(campaignId: string | null) {
  // Pas de refetchInterval : chaque carte montait sa propre query, soit 2 appels
  // Smartlead (analytics + séquence) par campagne toutes les 60 s en continu, écran
  // ouvert (20 appels/min pour 10 campagnes). On s'en remet au refetch au focus
  // (défaut React Query) avec un staleTime large.
  return useQuery({
    queryKey: ['smartlead-campaign-stats', campaignId],
    enabled: !!campaignId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<SmartleadStatsResult> =>
      invokeEdgeFunction<SmartleadStatsResult>(
        'get-smartlead-campaign-stats',
        { campaign_id: campaignId },
        { timeoutMs: 20_000 },
      ),
  });
}
