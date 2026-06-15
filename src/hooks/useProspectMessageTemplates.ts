import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type ProspectTargetCategory = 'hr' | 'director' | 'field_sales';
export type ProspectChannel = 'email' | 'linkedin' | 'postal_letter' | 'social_dm';

export interface ProspectMessageTemplate {
  id: string;
  target_category: ProspectTargetCategory;
  persona_id: string | null;
  channel: ProspectChannel;
  subject: string | null;
  body: string;
  icebreaker_template: string;
  is_active: boolean;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

export type TemplatesByKey = Map<string, ProspectMessageTemplate>;

export function templateKey(
  category: ProspectTargetCategory,
  channel: ProspectChannel,
): string {
  return `${category}:${channel}`;
}

export function useProspectMessageTemplates() {
  return useQuery({
    queryKey: ['prospect-message-templates'],
    queryFn: async (): Promise<TemplatesByKey> => {
      const { data, error } = await supabase
        .from('prospect_message_templates')
        .select(
          'id, target_category, persona_id, channel, subject, body, icebreaker_template, is_active, version, updated_at, updated_by',
        )
        .order('target_category')
        .order('channel');

      if (error) throw error;

      const map: TemplatesByKey = new Map();
      for (const t of (data || []) as ProspectMessageTemplate[]) {
        map.set(templateKey(t.target_category, t.channel), t);
      }
      return map;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export interface UpdateTemplateInput {
  id: string;
  subject: string | null;
  body: string;
  icebreaker_template: string;
}

export interface RegenerateResult {
  regenerated_count: number;
  template_version: number;
  skipped: number;
}

export function useUpdateProspectMessageTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: UpdateTemplateInput,
    ): Promise<RegenerateResult> => {
      const { error: updateError } = await supabase
        .from('prospect_message_templates')
        .update({
          subject: input.subject,
          body: input.body,
          icebreaker_template: input.icebreaker_template,
        })
        .eq('id', input.id);

      if (updateError) throw updateError;

      const { data, error: invokeError } = await supabase.functions.invoke(
        'regenerate-prospect-messages-from-template',
        { body: { template_id: input.id } },
      );

      if (invokeError) throw invokeError;

      return data as RegenerateResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prospect-message-templates'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-messages'] });
    },
  });
}

/**
 * Compte les messages "non envoyes" pour une paire (persona, channel).
 * Utilise pour la modale de confirmation avant regenerate.
 *
 * 2026-05-21 : RPC count_non_sent_messages qui fait 1 COUNT cote DB. Avant :
 * 2 SELECT sans limite tronquaient a 1000 et faussaient le compteur.
 */
export function useCountNonSentMessages(
  personaId: string | null,
  channel: ProspectChannel,
  enabled = true,
) {
  return useQuery({
    queryKey: ['prospect-messages-count-non-sent', personaId, channel],
    queryFn: async (): Promise<number> => {
      if (!personaId) return 0;
      const { data, error } = await supabase.rpc('count_non_sent_messages', {
        p_persona_id: personaId,
        p_channel: channel,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    enabled,
    staleTime: 10_000,
  });
}
