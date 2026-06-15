/**
 * Parsing local des fichiers d'import de prospection.
 * - Tabulaire (XLSX/XLS/CSV/TSV) → headers + sample rows + all rows
 * - Texte libre (PDF/DOCX/texte collé) → texte brut concaténé
 *
 * Pas d'appel réseau dans ce module. Toute la logique IA est dans les
 * edge functions detect-import-mapping / parse-import-freetext.
 */

import * as XLSX from "xlsx";
import mammoth from "mammoth";

export type ImportFormat =
  | "xlsx"
  | "xls"
  | "csv"
  | "tsv"
  | "pdf"
  | "docx"
  | "text_paste";

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface ParsedTabular {
  kind: "tabular";
  format: Exclude<ImportFormat, "pdf" | "docx" | "text_paste">;
  sheet_names: string[];
  selected_sheet: string;
  headers: string[];
  sample_rows: unknown[][];
  all_rows: unknown[][];
  file_meta: {
    filename: string;
    format: ImportFormat;
    size_bytes: number;
  };
}

export interface ParsedFreetext {
  kind: "freetext";
  format: Extract<ImportFormat, "pdf" | "docx" | "text_paste">;
  full_text: string;
  file_meta: {
    filename: string;
    format: ImportFormat;
    size_bytes: number;
  };
}

export type ParsedFile = ParsedTabular | ParsedFreetext;

export function detectFormatFromFilename(filename: string): ImportFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls")) return "xls";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".tsv")) return "tsv";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

function pickBestSheet(workbook: XLSX.WorkBook): string {
  if (workbook.SheetNames.length === 1) return workbook.SheetNames[0];

  // Heuristique : la feuille avec le plus de lignes structurées (cellules
  // non vides sur les 5 premières colonnes des 15 premières lignes).
  let bestName = workbook.SheetNames[0];
  let bestScore = 0;
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
    let score = 0;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      for (let j = 0; j < Math.min(row.length, 5); j++) {
        const v = row[j];
        if (v !== "" && v !== null && v !== undefined) score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  }
  return bestName;
}

function rowsToHeadersAndSample(rows: unknown[][]): {
  headers: string[];
  sample_rows: unknown[][];
  header_index: number;
} {
  // Heuristique : la ligne header est la première ligne qui contient au moins
  // 3 valeurs non vides ET dont la majorité des valeurs sont des strings.
  // Cas couvert : feuille avec un titre/sous-titre en haut (ex: actionco.xlsx
  // où les vrais headers sont en ligne 4).
  let headerIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const nonEmpty = row.filter((v) => v !== "" && v !== null && v !== undefined);
    if (nonEmpty.length >= 3) {
      const stringCount = nonEmpty.filter((v) => typeof v === "string").length;
      if (stringCount >= nonEmpty.length * 0.7) {
        headerIndex = i;
        break;
      }
    }
  }

  const headers = (rows[headerIndex] || []).map((v) => String(v ?? "").trim());
  const dataRows = rows.slice(headerIndex + 1);
  // Sample = max 8 lignes non vides
  const sample_rows: unknown[][] = [];
  for (const r of dataRows) {
    if (!Array.isArray(r)) continue;
    if (r.every((v) => v === "" || v === null || v === undefined)) continue;
    sample_rows.push(r);
    if (sample_rows.length >= 8) break;
  }
  return { headers, sample_rows, header_index: headerIndex };
}

async function parseTabular(file: File, format: ParsedTabular["format"]): Promise<ParsedTabular> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const selected = pickBestSheet(workbook);
  const ws = workbook.Sheets[selected];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const { headers, sample_rows, header_index } = rowsToHeadersAndSample(rows);

  // all_rows : toutes les lignes APRES le header (utilise l'index detecte,
  // pas indexOf qui compare par reference et echoue toujours).
  const allRows = rows.slice(header_index + 1);

  return {
    kind: "tabular",
    format,
    sheet_names: workbook.SheetNames,
    selected_sheet: selected,
    headers,
    sample_rows,
    all_rows: allRows,
    file_meta: { filename: file.name, format, size_bytes: file.size },
  };
}

async function extractPdfText(file: File): Promise<string> {
  // Import dynamique pour ne pas alourdir le bundle initial.
  // Vite gère le worker pdfjs-dist automatiquement via le ?url import.
  const pdfjsLib = await import("pdfjs-dist");
  // En V1 on désactive le worker pour rester simple (parse synchrone main thread).
  // Si performance pose problème, on activera le worker plus tard.
  pdfjsLib.GlobalWorkerOptions.workerSrc = await import(
    /* @vite-ignore */ "pdfjs-dist/build/pdf.worker.mjs?url"
  ).then((m) => m.default);

  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    text += pageText + "\n\n";
  }
  return text.trim();
}

async function extractDocxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value.trim();
}

export async function parseImportFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} MB, max 5 MB)`);
  }

  const format = detectFormatFromFilename(file.name);
  if (!format) {
    throw new Error(`Format non supporté. Acceptés : XLSX, XLS, CSV, TSV, PDF, DOCX.`);
  }

  if (format === "pdf") {
    const text = await extractPdfText(file);
    if (!text || text.length < 20) {
      throw new Error(
        "Ce PDF semble être un scan (texte vide). Convertissez-le ou copiez-collez le contenu."
      );
    }
    return {
      kind: "freetext",
      format: "pdf",
      full_text: text,
      file_meta: { filename: file.name, format: "pdf", size_bytes: file.size },
    };
  }

  if (format === "docx") {
    const text = await extractDocxText(file);
    if (!text || text.length < 20) {
      throw new Error("Ce DOCX semble vide ou non extractible.");
    }
    return {
      kind: "freetext",
      format: "docx",
      full_text: text,
      file_meta: { filename: file.name, format: "docx", size_bytes: file.size },
    };
  }

  return parseTabular(file, format);
}

export function parsePastedText(text: string): Promise<ParsedFreetext> {
  const trimmed = text.trim();
  if (trimmed.length < 20) {
    return Promise.reject(new Error("Le texte collé est trop court (au moins 20 caractères)."));
  }
  if (trimmed.length > 200_000) {
    return Promise.reject(new Error("Le texte collé dépasse 200k caractères. Réduisez-le."));
  }
  return Promise.resolve({
    kind: "freetext",
    format: "text_paste",
    full_text: trimmed,
    file_meta: {
      filename: "texte-colle.txt",
      format: "text_paste",
      size_bytes: new TextEncoder().encode(trimmed).length,
    },
  });
}

/**
 * SHA-256 hex du contenu du fichier, pour le dédup d'imports identiques côté
 * edge function.
 */
export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
