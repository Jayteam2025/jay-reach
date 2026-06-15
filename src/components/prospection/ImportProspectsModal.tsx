import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { logger } from "@/lib/logger";
import { computeFileHash, type ParsedFile } from "@/lib/parse-import-file";
import {
  applyMapping,
  type CanonicalField,
  type MultiContactCell,
  type PreviewRow,
} from "@/lib/apply-import-mapping";
import { ImportDropzone } from "./ImportDropzone";
import { ImportPreviewTable } from "./ImportPreviewTable";

interface ImportProspectsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSucceeded: (job_id: string | null) => void;
}

type Step = "upload" | "analyzing" | "preview" | "committing";

interface DetectMappingResponse {
  header_row_index: number;
  column_mapping: Record<string, CanonicalField>;
  multi_contact_cells: MultiContactCell[];
  confidence: number;
}

interface ParseFreetextResponse {
  rows: PreviewRow[];
  confidence: number;
}

interface EnqueueImportResponse {
  import_id: string;
  total: number;
  new_signal_ids: string[];
  re_promoted_signal_ids: string[];
  skipped_signal_ids: string[];
  rows_failed: number;
  enrichment_job_id: string | null;
}

export function ImportProspectsModal({
  open,
  onOpenChange,
  onImportSucceeded,
}: ImportProspectsModalProps) {
  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [mappingUsed, setMappingUsed] = useState<Record<string, unknown>>({});
  const [confidence, setConfidence] = useState<number>(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  function reset() {
    setStep("upload");
    setParsed(null);
    setFile(null);
    setPreviewRows([]);
    setMappingUsed({});
    setConfidence(0);
  }

  function handleClose() {
    if (step === "committing" || step === "analyzing") return; // ne ferme pas pendant un appel
    reset();
    onOpenChange(false);
  }

  async function handleParsed(p: ParsedFile, f?: File) {
    setParsed(p);
    setFile(f || null);
    setStep("analyzing");

    try {
      if (p.kind === "tabular") {
        const response = await invokeEdgeFunction<DetectMappingResponse>(
          "detect-import-mapping",
          {
            headers: p.headers,
            sample_rows: p.sample_rows,
            file_meta: p.file_meta,
          }
        );
        const rows = applyMapping(p, response.column_mapping, response.multi_contact_cells);
        if (rows.length === 0) {
          toast({
            title: "Aucune ligne exploitable",
            description: "Le fichier ne contient pas de prospects identifiables après mapping.",
            variant: "destructive",
          });
          reset();
          return;
        }
        setPreviewRows(rows);
        setMappingUsed({
          header_row_index: response.header_row_index,
          column_mapping: response.column_mapping,
          confidence: response.confidence,
          sheet: p.selected_sheet,
        });
        setConfidence(response.confidence);
      } else {
        const response = await invokeEdgeFunction<ParseFreetextResponse>(
          "parse-import-freetext",
          { full_text: p.full_text, file_meta: p.file_meta }
        );
        if (!response.rows || response.rows.length === 0) {
          toast({
            title: "Aucun prospect détecté",
            description: "L'IA n'a pas pu extraire de prospects de ce texte.",
            variant: "destructive",
          });
          reset();
          return;
        }
        setPreviewRows(response.rows);
        setMappingUsed({ mode: "freetext", confidence: response.confidence });
        setConfidence(response.confidence);
      }
      setStep("preview");
    } catch (err) {
      logger.error("[IMPORT_MODAL] Parsing failed", err);
      toast({
        title: "Erreur d'analyse",
        description: err instanceof Error ? err.message : "Impossible d'analyser le fichier.",
        variant: "destructive",
      });
      reset();
    }
  }

  async function handleCommit(selectedRows: PreviewRow[]) {
    if (!parsed) return;
    setStep("committing");

    try {
      let fileHash: string | undefined;
      if (file) {
        try {
          fileHash = await computeFileHash(file);
        } catch (err) {
          logger.warn("[IMPORT_MODAL] hash failed");
        }
      }

      const response = await invokeEdgeFunction<EnqueueImportResponse>(
        "enqueue-prospect-import",
        {
          source_meta: {
            filename: parsed.file_meta.filename,
            format: parsed.file_meta.format,
            size_bytes: parsed.file_meta.size_bytes,
            file_hash: fileHash,
            sheet_name: parsed.kind === "tabular" ? parsed.selected_sheet : undefined,
          },
          mapping_used: mappingUsed,
          rows: selectedRows,
          options: { skip_duplicates_already_engaged: true },
        }
      );

      toast({
        description: `Import lancé : ${response.new_signal_ids.length} nouveaux, ${response.re_promoted_signal_ids.length} mis à jour, ${response.skipped_signal_ids.length} flaggés "ne pas relancer".`,
      });

      // Invalide les caches concernés
      queryClient.invalidateQueries({ queryKey: ["prospect-signals"] });
      queryClient.invalidateQueries({ queryKey: ["enriched-companies"] });
      queryClient.invalidateQueries({ queryKey: ["prospect-imports"] });

      reset();
      onOpenChange(false);
      onImportSucceeded(response.enrichment_job_id);
    } catch (err) {
      logger.error("[IMPORT_MODAL] Commit failed", err);
      toast({
        title: "Erreur lors du commit",
        description: err instanceof Error ? err.message : "Impossible de finaliser l'import.",
        variant: "destructive",
      });
      setStep("preview");
    }
  }

  // Taille adaptative selon l'étape : compact pour upload/loaders, large pour preview.
  const sizeClass =
    step === "preview"
      ? "max-w-6xl h-[85vh]"
      : step === "upload"
        ? "max-w-2xl"
        : "max-w-md";

  const subtitle =
    step === "upload"
      ? "Jay détecte les colonnes et extrait les contacts via Mistral. Vous validez avant le commit."
      : step === "analyzing"
        ? "Mapping des colonnes en cours."
        : step === "committing"
          ? "Création des entreprises et lancement de l'enrichissement."
          : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={`${sizeClass} flex flex-col gap-6 border-border/40 dark:border-border/30 shadow-2xl`}>
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="font-display text-xl font-medium tracking-tight">
            Importer un fichier de prospects
            {confidence > 0 && step === "preview" && (
              <span className="ml-3 align-middle font-mono text-[11px] font-normal uppercase tracking-wider text-muted-foreground">
                IA · {Math.round(confidence * 100)}%
              </span>
            )}
          </DialogTitle>
          {subtitle && (
            <p className="text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          )}
        </DialogHeader>

        <div className="flex flex-1 flex-col min-h-0">
          {step === "upload" && <ImportDropzone onParsed={handleParsed} />}

          {step === "analyzing" && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <div className="text-center">
                <p className="font-display text-base font-medium text-foreground">
                  Mistral structure vos prospects
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  10 à 20 secondes selon la taille du fichier.
                </p>
              </div>
            </div>
          )}

          {step === "preview" && (
            <ImportPreviewTable
              rows={previewRows}
              onCommit={handleCommit}
              onCancel={reset}
            />
          )}

          {step === "committing" && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <div className="text-center">
                <p className="font-display text-base font-medium text-foreground">
                  Import en cours
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Création des entreprises et démarrage de l'enrichissement.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
