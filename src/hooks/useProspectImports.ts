import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export interface ProspectImport {
  id: string;
  user_id: string;
  source_filename: string;
  source_format: "xlsx" | "xls" | "csv" | "tsv" | "pdf" | "docx" | "text_paste";
  source_file_size_bytes: number | null;
  source_file_hash: string | null;
  source_sheet_name: string | null;
  mapping_used: Record<string, unknown>;
  rows_detected: number;
  rows_imported: number;
  rows_skipped_duplicate: number;
  rows_skipped_user: number;
  rows_failed: number;
  created_at: string;
  committed_at: string | null;
}

export function useProspectImports() {
  return useQuery({
    queryKey: ["prospect-imports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospect_imports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        logger.error("[PROSPECT_IMPORTS] Error fetching imports", error);
        throw error;
      }
      return data as ProspectImport[];
    },
  });
}
