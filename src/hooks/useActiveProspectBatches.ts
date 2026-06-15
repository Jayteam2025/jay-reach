import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ActiveProspectBatch {
  id: string;
  batch_id: string;
  batch_type: "scoring" | "linkedin_message";
  status: "in_progress" | "ended" | "failed";
  total: number | null;
  submitted_at: string;
  last_polled_at: string | null;
}

/**
 * Retourne les batches Anthropic en cours de traitement.
 * Utilise pour conditionnellement activer le refetchInterval sur les
 * hooks qui affichent des donnees scorees / messages generes.
 */
export function useActiveProspectBatches() {
  return useQuery({
    queryKey: ["active-prospect-batches"],
    queryFn: async (): Promise<ActiveProspectBatch[]> => {
      const { data, error } = await supabase
        .from("prospect_batches")
        .select("id, batch_id, batch_type, status, total, submitted_at, last_polled_at")
        .eq("status", "in_progress")
        .order("submitted_at", { ascending: false });

      if (error) throw error;
      return (data || []);
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useHasActiveBatches(): boolean {
  const { data } = useActiveProspectBatches();
  return (data?.length ?? 0) > 0;
}
