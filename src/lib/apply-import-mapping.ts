/**
 * Applique un mapping (colonne → champ canonique) sur les lignes brutes
 * d'un fichier tabulaire pour produire des PreviewRow normalisées.
 */

import type { ParsedTabular } from "./parse-import-file";

export type CanonicalField =
  | "raison_sociale"
  | "siren"
  | "siret"
  | "domain"
  | "website"
  | "tier"
  | "sector"
  | "address"
  | "city"
  | "country"
  | "ca_estimate"
  | "fdv_size"
  | "contact_full"
  | "contact_first_name"
  | "contact_last_name"
  | "contact_role"
  | "contact_email"
  | "contact_phone"
  | "linkedin_url"
  | "pipeline_status"
  | "notes"
  | "angle"
  | "fit_score"
  | "_ignore";

export interface PreviewRow {
  raison_sociale: string;
  siren?: string;
  domain?: string;
  tier?: string;
  sector?: string;
  address?: string;
  city?: string;
  country?: string;
  ca_estimate?: string;
  fdv_size?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_role?: string;
  contact_email?: string;
  contact_phone?: string;
  linkedin_url?: string;
  pipeline_status?: string;
  notes?: string;
  angle?: string;
  imported_metadata?: Record<string, unknown>;
}

export interface MultiContactSplit {
  first_name?: string;
  last_name?: string;
  role?: string;
}

export interface MultiContactCell {
  row_index: number;
  column_key: string;
  raw: string;
  split: MultiContactSplit[];
}

function trimToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function normalizeTier(raw: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[🔥⭐❌✨💎]/gu, "").trim().toUpperCase();
  const match = cleaned.match(/TIER\s*([1-3])/);
  if (match) return match[1];
  // "Priorité haute" → 1, "Priorité moyenne" → 2
  if (/haute|critique|max/i.test(raw)) return "1";
  if (/moy/i.test(raw)) return "2";
  if (/basse|faible/i.test(raw)) return "3";
  return raw.trim() || undefined;
}

function parseContactFull(raw: string): {
  first_name?: string;
  last_name?: string;
  role?: string;
} {
  // "Isabelle André (DG)" → { first_name: "Isabelle", last_name: "André", role: "DG" }
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const roleMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)/);
  const namePart = roleMatch?.[1]?.trim() ?? trimmed;
  const role = roleMatch?.[2]?.trim();

  const tokens = namePart.split(/\s+/);
  if (tokens.length === 0) return { role };
  if (tokens.length === 1) return { first_name: tokens[0], role };
  // Premier token = prénom, le reste = nom (gère "Frédéric L'Hermite")
  return {
    first_name: tokens[0],
    last_name: tokens.slice(1).join(" "),
    role,
  };
}

export function applyMapping(
  parsed: ParsedTabular,
  columnMapping: Record<string, CanonicalField>,
  multiContactCells: MultiContactCell[] = []
): PreviewRow[] {
  const headers = parsed.headers;
  const rows = parsed.all_rows;

  // Index multi_contact_cells par row_index pour lookup O(1)
  const multiCellsByRow = new Map<number, MultiContactCell[]>();
  for (const cell of multiContactCells) {
    const existing = multiCellsByRow.get(cell.row_index) || [];
    existing.push(cell);
    multiCellsByRow.set(cell.row_index, existing);
  }

  const result: PreviewRow[] = [];

  rows.forEach((rawRow, rowIndex) => {
    if (!Array.isArray(rawRow)) return;
    if (rawRow.every((v) => v === "" || v === null || v === undefined)) return; // Skip empty rows

    // Construit la row "brute" à partir du mapping
    const baseRow: PreviewRow = { raison_sociale: "" };
    const importedMetadata: Record<string, unknown> = {};

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (header === undefined) continue;
      const canonical = columnMapping[header];
      const value = trimToString(rawRow[i]);

      if (!value || !canonical || canonical === "_ignore") continue;

      switch (canonical) {
        case "raison_sociale":
          baseRow.raison_sociale = value;
          break;
        case "siren":
        case "siret":
          baseRow.siren = value;
          break;
        case "domain":
        case "website":
          baseRow.domain = value;
          break;
        case "tier":
          baseRow.tier = normalizeTier(value);
          break;
        case "sector":
          baseRow.sector = value;
          break;
        case "address":
          baseRow.address = value;
          break;
        case "city":
          baseRow.city = value;
          break;
        case "country":
          baseRow.country = value;
          break;
        case "ca_estimate":
          baseRow.ca_estimate = value;
          break;
        case "fdv_size":
          baseRow.fdv_size = value;
          break;
        case "contact_full": {
          const parsed = parseContactFull(value);
          if (parsed.first_name) baseRow.contact_first_name = parsed.first_name;
          if (parsed.last_name) baseRow.contact_last_name = parsed.last_name;
          if (parsed.role && !baseRow.contact_role) baseRow.contact_role = parsed.role;
          break;
        }
        case "contact_first_name":
          baseRow.contact_first_name = value;
          break;
        case "contact_last_name":
          baseRow.contact_last_name = value;
          break;
        case "contact_role":
          baseRow.contact_role = value;
          break;
        case "contact_email":
          baseRow.contact_email = value;
          break;
        case "contact_phone":
          baseRow.contact_phone = value;
          break;
        case "linkedin_url":
          baseRow.linkedin_url = value;
          break;
        case "pipeline_status":
          baseRow.pipeline_status = value;
          break;
        case "notes":
          baseRow.notes = baseRow.notes ? `${baseRow.notes} | ${value}` : value;
          break;
        case "angle":
          baseRow.angle = value;
          break;
        case "fit_score":
          importedMetadata.fit_score = value;
          break;
      }
    }

    if (Object.keys(importedMetadata).length > 0) {
      baseRow.imported_metadata = importedMetadata;
    }

    if (!baseRow.raison_sociale) return; // Skip rows sans entreprise

    // Multi-contacts : si la row a des cellules multi-contact, on génère
    // une PreviewRow par contact (même boite, contacts différents).
    const multiCells = multiCellsByRow.get(rowIndex);
    if (multiCells && multiCells.length > 0) {
      for (const cell of multiCells) {
        for (const split of cell.split) {
          result.push({
            ...baseRow,
            contact_first_name: split.first_name || baseRow.contact_first_name,
            contact_last_name: split.last_name || baseRow.contact_last_name,
            contact_role: split.role || baseRow.contact_role,
          });
        }
      }
    } else {
      result.push(baseRow);
    }
  });

  return result;
}
