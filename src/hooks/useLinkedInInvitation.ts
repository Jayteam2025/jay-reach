import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type LinkedInQueueStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
export type LinkedInInvitationMethod = 'extension_auto' | 'cowork_csv' | 'manual';

export interface LinkedInQueueItem {
  id: string;
  signal_id: string | null;
  prospect_id: string | null;
  status: LinkedInQueueStatus;
  method: LinkedInInvitationMethod;
  attempts: number;
  scheduled_for: string;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface LinkedInQueueMaps {
  bySignal: Map<string, LinkedInQueueItem>;
  byProspect: Map<string, LinkedInQueueItem>;
}

export function useLinkedInQueueMap() {
  return useQuery({
    queryKey: ['linkedin-invitation-queue'],
    refetchInterval: 30_000,
    queryFn: async (): Promise<LinkedInQueueMaps> => {
      const { data, error } = await supabase
        .from('linkedin_invitation_queue')
        .select('id, signal_id, prospect_id, status, method, attempts, scheduled_for, sent_at, error_message, created_at')
        .order('created_at', { ascending: false })
        .limit(5000);

      if (error) throw error;
      const bySignal = new Map<string, LinkedInQueueItem>();
      const byProspect = new Map<string, LinkedInQueueItem>();
      for (const item of (data || []) as LinkedInQueueItem[]) {
        if (item.signal_id && !bySignal.has(item.signal_id)) {
          bySignal.set(item.signal_id, item);
        }
        if (item.prospect_id && !byProspect.has(item.prospect_id)) {
          byProspect.set(item.prospect_id, item);
        }
      }
      return { bySignal, byProspect };
    },
  });
}

interface EnqueueResult {
  enqueued: number;
  skipped: { no_linkedin_url: number; not_found: number; already_in_queue: number; not_linkedin_signal: number };
  total_requested: number;
}

export function useEnqueueLinkedInInvitations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      signal_ids?: string[];
      prospect_ids?: string[];
      method?: LinkedInInvitationMethod;
    }): Promise<EnqueueResult> => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error('Non authentifie');

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/linkedin-invitation-enqueue`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          signal_ids: params.signal_ids || [],
          prospect_ids: params.prospect_ids || [],
          method: params.method || 'extension_auto',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-invitation-queue'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['enriched-companies'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-actions'] });
    },
  });
}
