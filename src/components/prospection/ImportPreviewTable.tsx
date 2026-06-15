import { useEffect, useMemo, useState } from "react";
import { Loader2, Check, AlertTriangle, Database, Linkedin, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import type { PreviewRow } from "@/lib/apply-import-mapping";
import { isInvalidLinkedinUrl, detectDoNotOutreachReasons, formatDoNotOutreachReason } from "@/lib/linkedin-validator";
import { estimateImportCost, formatCostEstimate } from "@/lib/prospect-import-cost";

interface ImportPreviewTableProps {
  rows: PreviewRow[];
  onCommit: (selectedRows: PreviewRow[]) => void;
  onCancel: () => void;
  isCommitting?: boolean;
}

interface RowFlags {
  existsInBase: boolean;
  alreadyEnriched: boolean;
  needsLinkedinSearch: boolean;
  doNotOutreachReasons: string[] | null;
}

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-zàâäéèêëïîôùûüÿçœæ0-9\s]/g, "")
    .replace(/\b(sa|sas|sca|sarl|eurl|group|groupe|france|international|distribution)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function ImportPreviewTable({ rows, onCommit, onCancel, isCommitting }: ImportPreviewTableProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(rows.map((_, i) => i)));
  const [existingCompanyNames, setExistingCompanyNames] = useState<Set<string>>(new Set());
  const [enrichedCompanyNames, setEnrichedCompanyNames] = useState<Set<string>>(new Set());
  const [isCheckingDb, setIsCheckingDb] = useState(false);

  // Lookup DB pour les boites déjà en base + déjà enrichies (>= 1 profile)
  // 2 queries en parallèle : signals + profiles. On calcule cote front les
  // boites enrichies (qui ont au moins 1 profile rattache) vs simplement
  // presentes en base (status raw, 0 profil = pas encore enrichies).
  useEffect(() => {
    let cancelled = false;
    async function check() {
      setIsCheckingDb(true);
      try {
        const names = Array.from(
          new Set(rows.map((r) => normalizeCompanyName(r.raison_sociale)).filter(Boolean))
        );
        if (names.length === 0) {
          setExistingCompanyNames(new Set());
          setEnrichedCompanyNames(new Set());
          return;
        }
        const [signalsRes, profilesRes] = await Promise.all([
          supabase
            .from("prospect_signals")
            .select("id, company_name")
            .neq("status", "dismissed")
            .not("company_name", "is", null)
            .limit(5000),
          supabase
            .from("prospect_profiles")
            .select("source_signal_id")
            .not("source_signal_id", "is", null)
            .limit(20000),
        ]);
        if (signalsRes.error) throw signalsRes.error;
        if (profilesRes.error) throw profilesRes.error;

        const signalIdsWithProfile = new Set(
          (profilesRes.data || []).map((p) => String(p.source_signal_id)),
        );
        const dbNames = new Set<string>();
        const enrichedNames = new Set<string>();
        for (const sig of signalsRes.data || []) {
          const norm = normalizeCompanyName(String(sig.company_name || ""));
          if (!norm) continue;
          dbNames.add(norm);
          if (signalIdsWithProfile.has(String(sig.id))) {
            enrichedNames.add(norm);
          }
        }
        if (!cancelled) {
          setExistingCompanyNames(dbNames);
          setEnrichedCompanyNames(enrichedNames);
        }
      } catch (err) {
        logger.error("[IMPORT_PREVIEW] Failed to check DB matches", err);
      } finally {
        if (!cancelled) setIsCheckingDb(false);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const flagsByRow = useMemo<RowFlags[]>(() => {
    return rows.map((row) => {
      const norm = normalizeCompanyName(row.raison_sociale);
      return {
        existsInBase: existingCompanyNames.has(norm),
        alreadyEnriched: enrichedCompanyNames.has(norm),
        needsLinkedinSearch: isInvalidLinkedinUrl(row.linkedin_url),
        doNotOutreachReasons: detectDoNotOutreachReasons(row.pipeline_status),
      };
    });
  }, [rows, existingCompanyNames, enrichedCompanyNames]);

  // Auto-decoche les boites deja enrichies au 1er chargement quand les
  // enrichedCompanyNames sont disponibles. L'admin peut les re-cocher
  // s'il veut forcer un ré-enrich (rare).
  useEffect(() => {
    if (enrichedCompanyNames.size === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      let changed = false;
      rows.forEach((row, idx) => {
        const norm = normalizeCompanyName(row.raison_sociale);
        if (enrichedCompanyNames.has(norm) && next.has(idx)) {
          next.delete(idx);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [enrichedCompanyNames, rows]);

  const stats = useMemo(() => {
    let alreadyInBase = 0;
    let alreadyEnriched = 0;
    let needsLinkedin = 0;
    let doNotOutreach = 0;
    flagsByRow.forEach((f) => {
      if (f.existsInBase) alreadyInBase += 1;
      if (f.alreadyEnriched) alreadyEnriched += 1;
      if (f.needsLinkedinSearch) needsLinkedin += 1;
      if (f.doNotOutreachReasons) doNotOutreach += 1;
    });
    return {
      total: rows.length,
      selected: selected.size,
      alreadyInBase,
      alreadyEnriched,
      needsLinkedin,
      doNotOutreach,
      new: rows.length - alreadyInBase,
    };
  }, [flagsByRow, rows.length, selected.size]);

  const cost = useMemo(() => {
    const selectedRows = Array.from(selected).map((i) => rows[i]).filter((r): r is PreviewRow => Boolean(r));
    return estimateImportCost(selectedRows);
  }, [selected, rows]);

  function toggleRow(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((_, i) => i)));
    }
  }

  function handleCommit() {
    const selectedRows = Array.from(selected)
      .sort((a, b) => a - b)
      .map((i) => rows[i])
      .filter((r): r is PreviewRow => Boolean(r));
    onCommit(selectedRows);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Stats header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline" className="font-mono font-normal">
            {stats.total} ligne{stats.total > 1 ? "s" : ""}
          </Badge>
          <Badge variant="outline" className="font-mono font-normal">
            {stats.selected} sélectionnée{stats.selected > 1 ? "s" : ""}
          </Badge>
          {isCheckingDb ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Vérification doublons…
            </span>
          ) : (
            <>
              {stats.alreadyEnriched > 0 && (
                <Badge variant="outline" className="font-mono font-normal text-emerald-700 dark:text-emerald-400 border-emerald-500/40">
                  {stats.alreadyEnriched} déjà enrichi{stats.alreadyEnriched > 1 ? "es" : "e"}
                </Badge>
              )}
              {stats.alreadyInBase - stats.alreadyEnriched > 0 && (
                <Badge variant="outline" className="font-mono font-normal text-amber-700 dark:text-amber-400 border-amber-500/40">
                  {stats.alreadyInBase - stats.alreadyEnriched} en base non enrichie{(stats.alreadyInBase - stats.alreadyEnriched) > 1 ? "s" : ""}
                </Badge>
              )}
            </>
          )}
          {stats.needsLinkedin > 0 && (
            <Badge variant="outline" className="font-mono font-normal text-muted-foreground">
              {stats.needsLinkedin} LinkedIn à rechercher
            </Badge>
          )}
          {stats.doNotOutreach > 0 && (
            <Badge variant="outline" className="font-mono font-normal text-red-700 dark:text-red-400 border-red-500/40">
              {stats.doNotOutreach} ne pas relancer
            </Badge>
          )}
        </div>
        <div className="text-xs text-gray-500 max-w-md text-right">
          {formatCostEstimate(cost)}
        </div>
      </div>

      {/* Tableau scrollable */}
      <div className="flex-1 overflow-auto border border-border rounded-md mt-3">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background/95 backdrop-blur z-10 border-b border-border">
            <tr className="text-left">
              <th className="px-3 py-2 w-10">
                <Checkbox
                  checked={selected.size === rows.length && rows.length > 0}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th className="px-3 py-2 font-medium">Raison sociale</th>
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2 font-medium">Rôle</th>
              <th className="px-3 py-2 font-medium">Ville</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Statut</th>
              <th className="px-3 py-2 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const flags = flagsByRow[i];
              const isSelected = selected.has(i);
              return (
                <tr
                  key={i}
                  className={cn(
                    "border-b border-border/50 hover:bg-violet-500/5",
                    !isSelected && "opacity-50",
                    flags?.doNotOutreachReasons && "bg-red-500/5"
                  )}
                >
                  <td className="px-3 py-2">
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleRow(i)} />
                  </td>
                  <td className="px-3 py-2 font-medium">{row.raison_sociale}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                    {[row.contact_first_name, row.contact_last_name].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                    {row.contact_role || "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{row.city || "—"}</td>
                  <td className="px-3 py-2">
                    {row.tier ? (
                      <Badge variant="outline" className="font-mono">
                        T{row.tier}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate">
                    {row.pipeline_status || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {flags?.alreadyEnriched ? (
                        <Badge
                          variant="outline"
                          className="text-xs gap-1 text-emerald-700 dark:text-emerald-400 border-emerald-400"
                          title="Cette boite est déjà enrichie (contacts en base). Pas besoin de la ré-enrichir, elle est décochée par défaut."
                        >
                          <Database className="w-3 h-3" /> déjà enrichi
                        </Badge>
                      ) : flags?.existsInBase && (
                        <Badge
                          variant="outline"
                          className="text-xs gap-1 text-amber-700 dark:text-amber-400 border-amber-400"
                          title="Cette boite est déjà en base mais pas enrichie. Ses données seront fusionnées et l'enrichissement sera relancé."
                        >
                          <Database className="w-3 h-3" /> base
                        </Badge>
                      )}
                      {flags?.needsLinkedinSearch && (
                        <Badge
                          variant="outline"
                          className="text-xs gap-1"
                          title="LinkedIn absent ou invalide, recherche auto déclenchée"
                        >
                          <Linkedin className="w-3 h-3" /> à chercher
                        </Badge>
                      )}
                      {flags?.doNotOutreachReasons && (
                        <Badge
                          variant="outline"
                          className="text-xs gap-1 text-red-700 dark:text-red-400 border-red-400"
                          title={flags?.doNotOutreachReasons.map(formatDoNotOutreachReason).join(", ")}
                        >
                          <ShieldAlert className="w-3 h-3" /> stop
                        </Badge>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer avec actions */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t border-border">
        {stats.alreadyInBase > 0 && (
          <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            Les doublons seront fusionnés : les données du fichier écrasent les méta non-enrichies,
            mais les emails/téléphones déjà enrichis sont préservés.
          </p>
        )}
        <div className="flex gap-2 ml-auto">
          <Button variant="ghost" onClick={onCancel} disabled={isCommitting}>
            Annuler
          </Button>
          <Button
            onClick={handleCommit}
            disabled={isCommitting || stats.selected === 0}
            className="gap-2"
          >
            {isCommitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Importer {stats.selected} entreprise{stats.selected > 1 ? "s" : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}
