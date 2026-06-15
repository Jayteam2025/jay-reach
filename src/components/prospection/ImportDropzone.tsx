import { useState, useRef, type DragEvent, type ChangeEvent } from "react";
import { Upload, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  parseImportFile,
  parsePastedText,
  type ParsedFile,
} from "@/lib/parse-import-file";

interface ImportDropzoneProps {
  onParsed: (parsed: ParsedFile, file?: File) => void;
}

const ACCEPTED_EXTS = ".xlsx,.xls,.csv,.tsv,.pdf,.docx";
const FORMAT_LABELS = ["XLSX", "CSV", "PDF", "DOCX"];
const MIN_PASTE_CHARS = 20;

export function ImportDropzone({ onParsed }: ImportDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [isTextFocused, setIsTextFocused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const pasteTrimmedLength = pastedText.trim().length;
  const pasteIsReady = pasteTrimmedLength >= MIN_PASTE_CHARS;

  async function handleFile(file: File) {
    setIsParsing(true);
    try {
      const parsed = await parseImportFile(file);
      onParsed(parsed, file);
    } catch (err) {
      toast({
        title: "Erreur de lecture",
        description: err instanceof Error ? err.message : "Impossible de lire le fichier.",
        variant: "destructive",
      });
    } finally {
      setIsParsing(false);
    }
  }

  async function handlePasted() {
    if (!pasteIsReady) return;
    setIsParsing(true);
    try {
      const parsed = await parsePastedText(pastedText);
      onParsed(parsed);
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Texte invalide.",
        variant: "destructive",
      });
    } finally {
      setIsParsing(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      {/* Drop zone — héros du flux upload */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !isParsing && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-disabled={isParsing}
        className={cn(
          "group relative overflow-hidden rounded-xl border bg-muted/20 transition-[background-color,border-color] duration-200 ease-out cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
          isParsing && "cursor-wait",
          isDragging
            ? "border-primary/40 bg-primary/5"
            : "border-border hover:border-primary/30 hover:bg-muted/30"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTS}
          onChange={handleSelect}
          className="hidden"
          disabled={isParsing}
        />

        <div className="flex flex-col items-center gap-5 px-8 py-14 text-center">
          {isParsing ? (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
              <p className="text-base font-medium text-foreground">Analyse du fichier…</p>
            </>
          ) : (
            <>
              <div
                className={cn(
                  "flex h-14 w-14 items-center justify-center rounded-full transition-colors duration-200",
                  isDragging
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground group-hover:bg-primary/15 group-hover:text-primary"
                )}
              >
                <Upload className="h-6 w-6" strokeWidth={1.75} />
              </div>

              <div className="space-y-1.5">
                <p className="font-display text-lg font-medium text-foreground">
                  Déposez un fichier de prospects
                </p>
                <p className="text-sm text-muted-foreground">
                  ou cliquez pour parcourir vos documents
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                {FORMAT_LABELS.map((label, idx) => (
                  <span key={label} className="flex items-center gap-2">
                    {idx > 0 && <span className="text-muted-foreground/40">·</span>}
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                      {label}
                    </span>
                  </span>
                ))}
                <span className="text-muted-foreground/40">·</span>
                <span className="text-[11px] text-muted-foreground/70">5 MB max</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Séparateur subtil — pas de bg-background overlay sur ligne */}
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/50">
        <span className="h-px flex-1 bg-border/60" />
        <span>ou collez du texte</span>
        <span className="h-px flex-1 bg-border/60" />
      </div>

      {/* Textarea — bouton ghost violet, réservé jusqu'à seuil de caractères */}
      <div className="space-y-3">
        <Textarea
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          onFocus={() => setIsTextFocused(true)}
          onBlur={() => setIsTextFocused(false)}
          placeholder="Collez l'extrait d'un email, le contenu d'un PDF, une liste manuelle… Jay détecte les entreprises et contacts."
          rows={4}
          disabled={isParsing}
          className={cn(
            "resize-none border-border/60 bg-muted/20 text-sm leading-relaxed transition-colors duration-200",
            "focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/30"
          )}
        />

        <div className="flex items-center justify-between gap-3">
          <p
            className={cn(
              "text-xs transition-opacity duration-200",
              pastedText.length === 0
                ? "text-muted-foreground/50"
                : pasteIsReady
                  ? "text-muted-foreground/70"
                  : "text-amber-600/80 dark:text-amber-400/70"
            )}
          >
            {pastedText.length === 0
              ? "Au moins 20 caractères pour analyser"
              : pasteIsReady
                ? `${pasteTrimmedLength} caractères prêts`
                : `${pasteTrimmedLength} / ${MIN_PASTE_CHARS} caractères minimum`}
          </p>

          <Button
            onClick={handlePasted}
            disabled={isParsing || !pasteIsReady}
            variant={pasteIsReady ? "default" : "ghost"}
            size="sm"
            className={cn(
              "gap-2 transition-all duration-200",
              !pasteIsReady && "opacity-60",
              (isTextFocused || pasteIsReady) ? "opacity-100" : "opacity-70"
            )}
          >
            {isParsing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Analyser
          </Button>
        </div>
      </div>
    </div>
  );
}
