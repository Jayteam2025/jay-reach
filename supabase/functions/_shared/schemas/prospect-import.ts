/**
 * Schemas Zod pour la feature d'import de fichiers de prospection.
 * Spec : docs/superpowers/specs/2026-05-12-prospection-file-upload-import-design.md
 */

import { z } from "npm:zod@3.24.1";

// ─── Canonical fields ──────────────────────────────────
// Champs que l'IA cherche à remplir lors du mapping.
// Les champs connus deviennent des colonnes typées de prospect_signals.extracted_data ;
// les autres vont dans imported_metadata jsonb.

export const CANONICAL_FIELDS = [
  "raison_sociale",
  "siren",
  "siret",
  "domain",
  "website",
  "tier",
  "sector",
  "address",
  "city",
  "country",
  "ca_estimate",
  "fdv_size",
  "contact_full",
  "contact_first_name",
  "contact_last_name",
  "contact_role",
  "contact_email",
  "contact_phone",
  "linkedin_url",
  "pipeline_status",
  "notes",
  "angle",
  "fit_score",
  "_ignore",
] as const;

export const CanonicalFieldSchema = z.enum(CANONICAL_FIELDS);
export type CanonicalField = z.infer<typeof CanonicalFieldSchema>;

// ─── detect-import-mapping ─────────────────────────────

export const DetectMappingRequestSchema = z.object({
  headers: z.array(z.string()).max(50, "Trop de colonnes (max 50)"),
  sample_rows: z
    .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
    .max(10, "Echantillon trop grand (max 10 lignes)"),
  file_meta: z.object({
    filename: z.string().max(255),
    format: z.enum(["xlsx", "xls", "csv", "tsv", "pdf", "docx", "text_paste"]),
    size_bytes: z.number().int().nonnegative().max(5_242_880, "Fichier > 5 MB"),
  }),
});

export type DetectMappingRequest = z.infer<typeof DetectMappingRequestSchema>;

export const DetectMappingResponseSchema = z.object({
  header_row_index: z.number().int().nonnegative(),
  column_mapping: z.record(z.string(), CanonicalFieldSchema),
  multi_contact_cells: z.array(
    z.object({
      row_index: z.number().int().nonnegative(),
      column_key: z.string(),
      raw: z.string(),
      split: z.array(
        z.object({
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          role: z.string().optional(),
        })
      ),
    })
  ),
  confidence: z.number().min(0).max(1),
});

export type DetectMappingResponse = z.infer<typeof DetectMappingResponseSchema>;

// ─── parse-import-freetext ─────────────────────────────

export const PreviewRowSchema = z.object({
  raison_sociale: z.string().min(1),
  siren: z.string().optional(),
  domain: z.string().optional(),
  tier: z.string().optional(), // normalisé en "1"/"2"/"3" si possible
  sector: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  ca_estimate: z.string().optional(),
  fdv_size: z.string().optional(),
  contact_first_name: z.string().optional(),
  contact_last_name: z.string().optional(),
  contact_role: z.string().optional(),
  contact_email: z.string().email().optional().or(z.literal("")),
  contact_phone: z.string().optional(),
  linkedin_url: z.string().optional(), // peut être "À rechercher" — validation isInvalidLinkedinUrl côté edge fn
  pipeline_status: z.string().optional(),
  notes: z.string().optional(),
  angle: z.string().optional(),
  imported_metadata: z.record(z.string(), z.unknown()).optional(),
});

export type PreviewRow = z.infer<typeof PreviewRowSchema>;

export const ParseFreetextRequestSchema = z.object({
  full_text: z.string().min(1).max(200_000, "Texte trop long (max 200k chars)"),
  file_meta: z.object({
    filename: z.string().max(255),
    format: z.enum(["pdf", "docx", "text_paste"]),
    size_bytes: z.number().int().nonnegative().max(5_242_880),
  }),
});

export type ParseFreetextRequest = z.infer<typeof ParseFreetextRequestSchema>;

export const ParseFreetextResponseSchema = z.object({
  rows: z.array(PreviewRowSchema).max(500, "Trop de prospects dans un fichier (max 500)"),
  confidence: z.number().min(0).max(1),
});

export type ParseFreetextResponse = z.infer<typeof ParseFreetextResponseSchema>;

// ─── enqueue-prospect-import ───────────────────────────

export const EnqueueImportRequestSchema = z.object({
  source_meta: z.object({
    filename: z.string().max(255),
    format: z.enum(["xlsx", "xls", "csv", "tsv", "pdf", "docx", "text_paste"]),
    size_bytes: z.number().int().nonnegative().max(5_242_880),
    file_hash: z.string().max(128).optional(),
    sheet_name: z.string().max(255).optional(),
  }),
  mapping_used: z.record(z.string(), z.unknown()),
  rows: z.array(PreviewRowSchema).min(1).max(500),
  options: z
    .object({
      skip_duplicates_already_engaged: z.boolean().default(true),
    })
    .default({ skip_duplicates_already_engaged: true }),
});

export type EnqueueImportRequest = z.infer<typeof EnqueueImportRequestSchema>;

export const EnqueueImportResponseSchema = z.object({
  import_id: z.string().uuid(),
  total: z.number().int().nonnegative(),
  new_signal_ids: z.array(z.string().uuid()),
  re_promoted_signal_ids: z.array(z.string().uuid()),
  skipped_signal_ids: z.array(z.string().uuid()),
  rows_failed: z.number().int().nonnegative(),
  enrichment_job_id: z.string().uuid().nullable(),
});

export type EnqueueImportResponse = z.infer<typeof EnqueueImportResponseSchema>;
