import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

interface CronResult {
  step: string;
  success: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

interface CronResponse {
  success: boolean;
  run_id: string;
  duration_s: number;
  results: CronResult[];
}

export function useTriggerWeeklyCron() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<CronResponse> => {
      return invokeEdgeFunction<CronResponse>('weekly-prospect-cron', {});
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });
      void queryClient.invalidateQueries({ queryKey: ['enriched-companies'] });
      void queryClient.invalidateQueries({ queryKey: ['linkedin-contacts'] });
    },
  });
}
