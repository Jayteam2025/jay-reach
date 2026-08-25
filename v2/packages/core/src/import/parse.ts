/**
 * Parsing CSV : détection du séparateur, gestion des guillemets. Pur et testable.
 * (Le XLSX passe par un lecteur dédié côté web — même sortie `ParsedRows`.)
 */

export type RawRow = Record<string, string>;

export interface ParsedRows {
  readonly headers: string[];
  readonly rows: RawRow[];
}

/** Détecte le séparateur le plus probable sur la première ligne. */
export function detectSeparator(sample: string): ',' | ';' | '\t' {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? '';
  const counts: Array<[',' | ';' | '\t', number]> = [
    [',', (firstLine.match(/,/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const best = counts[0];
  return best && best[1] > 0 ? best[0] : ',';
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

export function parseCsv(text: string, separator?: string): ParsedRows {
  const sep = separator ?? detectSeparator(text);
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = splitLine(lines[0] as string, sep);
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = splitLine(lines[i] as string, sep);
    const row: RawRow = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return { headers, rows };
}
