/**
 * Pipeline d'import : mapping → validation → déduplication → compte rendu.
 * Purement fonctionnel (aucune I/O), pour être testé de bout en bout.
 */
import type { ColumnMapping, ImportField } from './mapping.js';
import type { ParsedRows, RawRow } from './parse.js';

export type MappedRow = Partial<Record<ImportField, string>> & { raw: RawRow };

export function applyMapping(parsed: ParsedRows, mapping: ColumnMapping): MappedRow[] {
  return parsed.rows.map((raw) => {
    const mapped: MappedRow = { raw };
    for (const [header, field] of Object.entries(mapping)) {
      const value = raw[header];
      if (value && value.trim()) {
        mapped[field] = value.trim();
      }
    }
    return mapped;
  });
}

// ---- Validation -----------------------------------------------------------
export interface ValidationResult {
  readonly valid: MappedRow[];
  readonly rejected: MappedRow[];
}

/** Une ligne sans nom ET sans email est rejetée. */
export function validateRows(rows: MappedRow[]): ValidationResult {
  const valid: MappedRow[] = [];
  const rejected: MappedRow[] = [];
  for (const row of rows) {
    const hasName = Boolean((row.first_name ?? '').trim() || (row.last_name ?? '').trim());
    const hasEmail = Boolean((row.email ?? '').trim());
    if (!hasName && !hasEmail) {
      rejected.push(row);
    } else {
      valid.push(row);
    }
  }
  return { valid, rejected };
}

// ---- Déduplication --------------------------------------------------------
export function normalizeLinkedin(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '');
}

/** Clé de dédup : email → LinkedIn → nom+entreprise (dans cet ordre). */
export function dedupKey(row: MappedRow): string | null {
  if ((row.email ?? '').trim()) {
    return `email:${row.email!.trim().toLowerCase()}`;
  }
  if ((row.linkedin_url ?? '').trim()) {
    return `li:${normalizeLinkedin(row.linkedin_url!)}`;
  }
  const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim().toLowerCase();
  const company = (row.company ?? '').trim().toLowerCase();
  return name && company ? `nc:${name}|${company}` : null;
}

export interface DedupeResult {
  readonly unique: MappedRow[];
  readonly merged: number;
}

/** Fusionne les doublons : complète les champs vides, n'écrase jamais un champ rempli. */
export function dedupeRows(rows: MappedRow[]): DedupeResult {
  const byKey = new Map<string, MappedRow>();
  const noKey: MappedRow[] = [];
  let merged = 0;
  for (const row of rows) {
    const key = dedupKey(row);
    if (!key) {
      noKey.push(row);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row });
    } else {
      for (const field of Object.keys(row) as Array<keyof MappedRow>) {
        if (field === 'raw') {
          continue;
        }
        const current = existing[field];
        const incoming = row[field];
        if ((current === undefined || current === '') && incoming) {
          existing[field] = incoming;
        }
      }
      merged += 1;
    }
  }
  return { unique: [...byKey.values(), ...noKey], merged };
}

// ---- Compte rendu ---------------------------------------------------------
export interface ImportReport {
  readonly rowsTotal: number;
  readonly rowsRejected: number;
  readonly rowsUnique: number;
  readonly rowsMerged: number;
  readonly emailsMissing: number;
}

export interface ImportOutcome {
  readonly report: ImportReport;
  readonly rows: MappedRow[];
  readonly rejected: MappedRow[];
}

/** Exécute tout le pipeline et produit le compte rendu affiché avant validation. */
export function processImport(parsed: ParsedRows, mapping: ColumnMapping): ImportOutcome {
  const mapped = applyMapping(parsed, mapping);
  const { valid, rejected } = validateRows(mapped);
  const { unique, merged } = dedupeRows(valid);
  const emailsMissing = unique.filter((r) => !(r.email ?? '').trim()).length;
  return {
    report: {
      rowsTotal: parsed.rows.length,
      rowsRejected: rejected.length,
      rowsUnique: unique.length,
      rowsMerged: merged,
      emailsMissing,
    },
    rows: unique,
    rejected,
  };
}
