import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type ProspectChannel = 'email' | 'social_dm';

export interface ProspectMessageTemplate {
  id: string;
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

/** Clé d'un template : (persona_id, channel). Modèle persona-based. */
export function templateKey(personaId: string, channel: ProspectChannel): string {
  return `${personaId}:${channel}`;
}

export function useProspectMessageTemplates() {
  return useQuery({
    queryKey: ['prospect-message-templates'],
    queryFn: async (): Promise<TemplatesByKey> => {
      const { data, error } = await supabase
        .from('prospect_message_templates')
        .select(
          'id, persona_id, channel, subject, body, icebreaker_template, is_active, version, updated_at, updated_by',
        )
        .order('channel');

      if (error) throw error;

      const map: TemplatesByKey = new Map();
      for (const t of (data || []) as ProspectMessageTemplate[]) {
        // Modèle persona-based : on n'indexe que les templates rattachés à un persona.
        if (t.persona_id) map.set(templateKey(t.persona_id, t.channel), t);
      }
      return map;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export interface UpsertTemplateInput {
  persona_id: string;
  channel: ProspectChannel;
  subject: string | null;
  body: string;
  icebreaker_template: string;
}

export interface RegenerateResult {
  regenerated_count: number;
  template_version: number;
  skipped: number;
}

/**
 * Crée OU met à jour le template d'un (persona, canal), puis régénère les messages
 * non envoyés. L'éditer alors qu'il n'existe pas encore = le créer (modèle OSS :
 * pas de seed, l'opérateur configure ses templates par persona).
 */
export function useUpsertProspectMessageTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpsertTemplateInput): Promise<RegenerateResult> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const { data: membership } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      const workspaceId = membership?.workspace_id as string | undefined;
      if (!workspaceId) throw new Error('Aucun workspace pour cet utilisateur');

      // Upsert manuel (évite les ambiguïtés ON CONFLICT côté PostgREST).
      const { data: existing } = await supabase
        .from('prospect_message_templates')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('persona_id', input.persona_id)
        .eq('channel', input.channel)
        .maybeSingle();

      let templateId = (existing?.id as string | undefined) ?? null;

      if (templateId) {
        const { error: updateError } = await supabase
          .from('prospect_message_templates')
          .update({
            subject: input.subject,
            body: input.body,
            icebreaker_template: input.icebreaker_template,
          })
          .eq('id', templateId);
        if (updateError) throw updateError;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('prospect_message_templates')
          .insert({
            workspace_id: workspaceId,
            persona_id: input.persona_id,
            channel: input.channel,
            subject: input.subject,
            body: input.body,
            icebreaker_template: input.icebreaker_template,
            is_active: true,
          })
          .select('id')
          .single();
        if (insertError) throw insertError;
        templateId = inserted.id as string;
      }

      const { data, error: invokeError } = await supabase.functions.invoke(
        'regenerate-prospect-messages-from-template',
        { body: { template_id: templateId } },
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
