import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Campagnes éditables côté app (1 par persona). Le nom, l'ICP et la séquence
 * (étapes / textes / délais) sont persistés dans la table prospect_campaigns.
 * L'envoi réel reste géré par Smartlead (mapping séparé, cf useSmartleadCampaigns).
 */

export type StepChannel = 'email' | 'linkedin' | 'letter';

export interface CampaignStep {
  id: string;
  type: 'step' | 'wait';
  channel?: StepChannel;
  title?: string;
  subject?: string;
  body?: string;
  delay_days?: number;
  note?: string;
}

export interface CampaignPersona {
  id: string;
  slug: string;
  label: string;
  icon: string | null;
  is_active: boolean;
}

export interface Campaign {
  id: string;
  workspace_id: string;
  persona_id: string;
  name: string;
  steps: CampaignStep[];
  is_active: boolean;
  created_at: string;
  persona: CampaignPersona | null;
}

const CAMPAIGNS_KEY = ['prospect-campaigns'] as const;

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

/** Séquence canonique du produit, utilisée pour initialiser une nouvelle campagne. */
export function defaultCampaignSteps(): CampaignStep[] {
  return [
    {
      id: uid(),
      type: 'step',
      channel: 'email',
      title: 'Email — icebreaker signal',
      subject: 'Vous recrutez un {{intitulé_offre}} ?',
      body: "Bonjour {{prénom}}, j'ai vu que {{entreprise}} renforce son équipe terrain…",
    },
    { id: uid(), type: 'wait', delay_days: 3, note: 'si pas de réponse' },
    {
      id: uid(),
      type: 'step',
      channel: 'linkedin',
      title: 'Invitation LinkedIn',
      note: "Sans note — le profil et l'email précédent font le travail.",
    },
    { id: uid(), type: 'wait', delay_days: 2, note: 'après acceptation' },
    {
      id: uid(),
      type: 'step',
      channel: 'letter',
      title: 'Courrier manuscrit',
      note: 'Lettre Manuscry — si adresse entreprise vérifiée. Coût : 3,90 € / envoi.',
    },
    { id: uid(), type: 'wait', delay_days: 4 },
    {
      id: uid(),
      type: 'step',
      channel: 'email',
      title: 'Email — relance courte',
      subject: 'Re — {{prénom}}, vous avez reçu mon mot ?',
      body: 'Deux lignes, une question fermée, un lien agenda.',
    },
  ];
}

interface RawCampaign extends Omit<Campaign, 'persona' | 'steps'> {
  steps: CampaignStep[] | null;
  icp_personas: CampaignPersona | null;
}

export function useCampaigns() {
  return useQuery({
    queryKey: CAMPAIGNS_KEY,
    queryFn: async (): Promise<Campaign[]> => {
      const { data, error } = await supabase
        .from('prospect_campaigns')
        .select('id, workspace_id, persona_id, name, steps, is_active, created_at, icp_personas:persona_id(id, slug, label, icon, is_active)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as RawCampaign[]).map((r) => {
        const { icp_personas, steps, ...rest } = r;
        return { ...rest, steps: steps ?? [], persona: icp_personas ?? null };
      });
    },
  });
}

export interface UpsertCampaignInput {
  id?: string;
  workspace_id: string;
  persona_id: string;
  name: string;
  steps: CampaignStep[];
  is_active?: boolean;
}

export function useUpsertCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertCampaignInput) => {
      const { error } = await supabase
        .from('prospect_campaigns')
        .upsert(
          {
            ...(input.id ? { id: input.id } : {}),
            workspace_id: input.workspace_id,
            persona_id: input.persona_id,
            name: input.name,
            steps: input.steps,
            is_active: input.is_active ?? true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,persona_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CAMPAIGNS_KEY }),
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('prospect_campaigns').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CAMPAIGNS_KEY }),
  });
}
