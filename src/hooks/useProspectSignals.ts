import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { useHasActiveBatches } from "@/hooks/useActiveProspectBatches";

export interface ProspectSignal {
  id: string;
  signal_type: string;
  source: string;
  source_url: string | null;
  raw_content: string | null;
  extracted_data: Record<string, unknown>;
  company_name: string | null;
  matched_prospect_id: string | null;
  status: string;
  detected_at: string;
  created_at: string;
  acquisition_method?: "scrape" | "file_upload" | "manual";
  import_id?: string | null;
  imported_metadata?: Record<string, unknown> | null;
  do_not_outreach_reasons?: string[] | null;
}

// =====================================================
// Query: Signaux de prospect avec filtres optionnels
// =====================================================

export type AcquisitionMethodFilter = "scrape" | "file_upload" | "manual" | "all";

interface ProspectSignalFilters {
  status?: string;
  source?: string;
  signal_type?: string;
  acquisition_method?: AcquisitionMethodFilter;
}

export function useProspectSignals(filters?: ProspectSignalFilters) {
  const hasActiveBatches = useHasActiveBatches();
  return useQuery({
    queryKey: ["prospect-signals", filters],
    refetchInterval: hasActiveBatches ? 45_000 : false,
    queryFn: async () => {
      let query = supabase
        .from("prospect_signals")
        .select("*")
        .not("status", "in", "(dismissed,archived)")
        .order("detected_at", { ascending: false })
        .limit(500);

      if (filters?.status) {
        query = query.eq("status", filters.status);
      }

      if (filters?.source) {
        query = query.eq("source", filters.source);
      }

      if (filters?.signal_type) {
        query = query.eq("signal_type", filters.signal_type);
      }

      if (filters?.acquisition_method && filters.acquisition_method !== "all") {
        query = query.eq("acquisition_method", filters.acquisition_method);
      }

      const { data, error } = await query;

      if (error) {
        logger.error("[PROSPECT_SIGNALS] Error fetching signals", error);
        throw error;
      }

      return data as ProspectSignal[];
    },
  });
}
