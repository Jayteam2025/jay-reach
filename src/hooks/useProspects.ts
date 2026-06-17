import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";

/** Persona resolu depuis icp_personas (Jay Reach 1.2.2+). */
export interface ProspectPersonaInline {
  id: string;
  slug: string;
  label: string;
  channels_priority: string[];
}

export interface Prospect {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  company_name: string | null;
  company_siren: string | null;
  company_size: string | null;
  company_sector: string | null;
  company_city: string | null;
  /** FK vers icp_personas. Toujours present apres migration. */
  persona_id: string | null;
  /** Persona resolu (denormalise via join icp_personas). Null si pas de persona_id. */
  persona: ProspectPersonaInline | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  twitter_url: string | null;
  status: string;
  qualification_score: number;
  enrichment_data: Record<string, unknown>;
  source_signal_id: string | null;
  company_group_id: string | null;
  email_validation_status: string;
  deliverability_status: string | null;
  deliverability_reason: string | null;
  deliverability_checked_at: string | null;
  smartlead_push_decision: string | null;
  smartlead_push_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type RawProspect = Omit<Prospect, "persona"> & {
  icp_personas: ProspectPersonaInline | null;
};

function denormalizePersona(raw: RawProspect): Prospect {
  const { icp_personas, ...rest } = raw;
  return { ...rest, persona: icp_personas ?? null };
}

/** Resout le label affichable d'un prospect depuis le persona. */
export function getProspectLabel(p: Prospect): string {
  return p.persona?.label ?? "Contact";
}

// =====================================================
// Query: Tous les prospects (non supprimés)
// =====================================================

export function useProspects() {
  return useQuery({
    queryKey: ["prospects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospect_profiles")
        .select("*, icp_personas:persona_id(id, slug, label, channels_priority)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) {
        logger.error("[PROSPECTS] Error fetching prospects", error);
        throw error;
      }

      return (data as RawProspect[]).map(denormalizePersona);
    },
  });
}

// =====================================================
// Query: Prospect simple par ID
// =====================================================

export function useProspect(id: string | null) {
  return useQuery({
    queryKey: ["prospect", id],
    queryFn: async () => {
      if (!id) return null;

      const { data, error } = await supabase
        .from("prospect_profiles")
        .select("*, icp_personas:persona_id(id, slug, label, channels_priority)")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        logger.error("[PROSPECT] Error fetching prospect", error);
        throw error;
      }

      return data ? denormalizePersona(data as RawProspect) : null;
    },
    enabled: !!id,
  });
}

// =====================================================
// Mutation: Mettre à jour le statut d'un prospect
// =====================================================

interface UpdateProspectStatusPayload {
  id: string;
  status: string;
}

export function useUpdateProspectStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: UpdateProspectStatusPayload) => {
      const { data, error } = await supabase
        .from("prospect_profiles")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        logger.error("[PROSPECT] Error updating status", error);
        throw error;
      }

      return data as Prospect;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
    },
  });
}

// =====================================================
// Mutation: Déplacer un prospect (optimistic update)
// =====================================================

interface MoveProspectPayload {
  id: string;
  targetGroupId: string | null;
}

export function useMoveProspect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, targetGroupId }: MoveProspectPayload) => {
      const { data, error } = await supabase
        .from("prospect_profiles")
        .update({ company_group_id: targetGroupId, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        logger.error("[PROSPECT] Error moving prospect", error);
        throw error;
      }

      return data as Prospect;
    },
    onMutate: async ({ id, targetGroupId }) => {
      // Annuler les requêtes en cours
      await queryClient.cancelQueries({ queryKey: ["prospects"] });
      await queryClient.cancelQueries({ queryKey: ["prospect", id] });

      // Sauvegarder les données précédentes
      const previousProspects = queryClient.getQueryData(["prospects"]);
      const previousProspect = queryClient.getQueryData(["prospect", id]);

      // Mettre à jour le cache optimistically
      queryClient.setQueryData(["prospects"], (oldData: Prospect[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map((prospect) =>
          prospect.id === id ? { ...prospect, company_group_id: targetGroupId } : prospect,
        );
      });

      queryClient.setQueryData(["prospect", id], (oldData: Prospect | null | undefined) => {
        if (!oldData) return oldData;
        return { ...oldData, company_group_id: targetGroupId };
      });

      return { previousProspects, previousProspect };
    },
    onError: (error, variables, context) => {
      logger.error("[PROSPECT] Error moving prospect", error);

      // Rollback en cas d'erreur
      if (context?.previousProspects) {
        queryClient.setQueryData(["prospects"], context.previousProspects);
      }
      if (context?.previousProspect) {
        queryClient.setQueryData(["prospect", variables.id], context.previousProspect);
      }
    },
    onSettled: () => {
      // Invalider les queries après la mutation
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
    },
  });
}
