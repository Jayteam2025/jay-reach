import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ProspectSearchBarProps {
  value: string;
  onChange: (q: string) => void;
  resultCount?: number;
  totalCount?: number;
  placeholder?: string;
}

/**
 * Barre de recherche texte avec debounce 200ms.
 * Filtre client-side dans ProspectionEntreprises (suffisant tant que <500 lignes).
 * Si la base dépasse cette limite, basculer en server-side via PostgREST trigram.
 */
export function ProspectSearchBar({
  value,
  onChange,
  resultCount,
  totalCount,
  placeholder = "Rechercher une entreprise, un contact, une ville…",
}: ProspectSearchBarProps) {
  const [local, setLocal] = useState(value);

  // Sync external -> local (e.g. URL change)
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Debounce local -> parent
  useEffect(() => {
    const t = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder={placeholder}
          className="pl-9 pr-9 h-9"
        />
        {local && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLocal("");
              onChange("");
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      {value && resultCount !== undefined && totalCount !== undefined && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {resultCount} / {totalCount}
        </span>
      )}
    </div>
  );
}

/**
 * Filtre client-side : matche query sur company_name, contact, ville, secteur.
 * Tolère les accents et la casse (normalisation NFD).
 */
function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function matchesProspectQuery(
  query: string,
  fields: Array<string | null | undefined>
): boolean {
  if (!query.trim()) return true;
  const q = normalize(query.trim());
  const haystack = fields.map(normalize).join(" ");
  // Match all tokens (logical AND) — permet "figaro paris" pour Figaro à Paris
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token));
}
