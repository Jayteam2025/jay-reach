import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useWorkspaceBooleanSetting } from "@/hooks/useWorkspaceSettings";

export type CrmDetection = {
  company_group_id: string;
  domain: string | null;
  domain_source: "fullenrich" | "manual" | null;
  crm_name: string | null;
  crm_confidence: "high" | "medium" | "low" | "none" | "pending";
  detection_status: "pending" | "completed" | "failed";
  error: string | null;
  crm_signals: unknown;
  detected_at: string | null;
  updated_at: string | null;
};

export function useCrmDetection(companyGroupId: string | undefined) {
  const queryClient = useQueryClient();
  const crmDetectionEnabled = useWorkspaceBooleanSetting("crm_detection_enabled");

  const query = useQuery({
    queryKey: ["crm-detection", companyGroupId],
    enabled: !!companyGroupId && crmDetectionEnabled,
    queryFn: async (): Promise<CrmDetection | null> => {
      if (!companyGroupId || !crmDetectionEnabled) return null;
      const { data, error } = await supabase
        .from("prospect_crm_detections")
        .select("*")
        .eq("company_group_id", companyGroupId)
        .maybeSingle();
      if (error) throw error;
      return (data as CrmDetection | null) ?? null;
    },
    refetchInterval: (q) => {
      const d = q.state.data as CrmDetection | null;
      if (d?.detection_status === "pending") return 3_000;
      return false;
    },
  });

  const redetect = useMutation({
    mutationFn: async () => {
      if (!companyGroupId) throw new Error("missing company_group_id");
      if (!crmDetectionEnabled) {
        throw new Error("CRM detection is disabled for this workspace");
      }
      const { data, error } = await supabase.functions.invoke("detect-crm", {
        body: { company_group_id: companyGroupId, force: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-detection", companyGroupId] });
    },
  });

  return {
    detection: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    redetect: () => redetect.mutate(),
    isRedetecting: redetect.isPending,
  };
}
