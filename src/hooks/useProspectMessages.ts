import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export interface ProspectMessage {
  id: string;
  prospect_id: string;
  sequence_id: string | null;
  step_position: number | null;
  channel: string;
  subject: string | null;
  body: string;
  icebreaker: string | null;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  replied_at: string | null;
  llm_model: string | null;
  created_at: string;
  updated_at: string;
  prospect?: {
    first_name: string;
    last_name: string;
    company_name: string | null;
  };
}

// =====================================================
// Query: Messages de prospect avec join sur prospects
// =====================================================

interface ProspectMessageFilters {
  status?: string;
  channel?: string;
}

export function useProspectMessages(filters?: ProspectMessageFilters) {
  return useQuery({
    queryKey: ["prospect-messages", filters],
    queryFn: async () => {
      let query = supabase
        .from("prospect_messages")
        .select("*, prospect:prospect_profiles(first_name, last_name, company_name)")
        .order("created_at", { ascending: false })
        .limit(100);

      if (filters?.status) {
        query = query.eq("status", filters.status);
      }

      if (filters?.channel) {
        query = query.eq("channel", filters.channel);
      }

      const { data, error } = await query;

      if (error) {
        logger.error("[PROSPECT_MESSAGES] Error fetching messages", error);
        throw error;
      }

      return data as ProspectMessage[];
    },
  });
}

// =====================================================
// Mutation: Approuver un message
// =====================================================

interface ApproveMessagePayload {
  id: string;
}

export function useApproveMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: ApproveMessagePayload) => {
      const { data, error } = await supabase
        .from("prospect_messages")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*, prospect:prospect_profiles(first_name, last_name, company_name)")
        .maybeSingle();

      if (error) {
        logger.error("[PROSPECT_MESSAGES] Error approving message", error);
        throw error;
      }

      return data as ProspectMessage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prospect-messages"] });
    },
  });
}

// =====================================================
// Mutation: Marquer un message comme envoyé
// =====================================================

interface MarkMessageSentPayload {
  id: string;
}

export function useMarkMessageSent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: MarkMessageSentPayload) => {
      const { data, error } = await supabase
        .from("prospect_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("*, prospect:prospect_profiles(first_name, last_name, company_name)")
        .maybeSingle();

      if (error) {
        logger.error("[PROSPECT_MESSAGES] Error marking message as sent", error);
        throw error;
      }

      return data as ProspectMessage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prospect-messages"] });
    },
  });
}
