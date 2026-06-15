import { assertEquals, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  DetectMappingRequestSchema,
  DetectMappingResponseSchema,
  ParseFreetextRequestSchema,
  ParseFreetextResponseSchema,
  EnqueueImportRequestSchema,
  PreviewRowSchema,
  CANONICAL_FIELDS,
} from "./prospect-import.ts";

// ─── DetectMappingRequestSchema ────────────────────────────

Deno.test("DetectMappingRequestSchema: valid request passes", () => {
  const valid = {
    headers: ["Groupe", "Contact", "Email"],
    sample_rows: [
      ["Infopro Digital", "Jean Doe", "jean@example.com"],
      ["Le Monde", "Marie Dupont", null],
    ],
    file_meta: { filename: "prospects.xlsx", format: "xlsx", size_bytes: 12000 },
  };
  const result = DetectMappingRequestSchema.safeParse(valid);
  assertEquals(result.success, true);
});

Deno.test("DetectMappingRequestSchema: file > 5 MB rejected", () => {
  const invalid = {
    headers: ["A"],
    sample_rows: [["foo"]],
    file_meta: { filename: "huge.xlsx", format: "xlsx", size_bytes: 6_000_000 },
  };
  const result = DetectMappingRequestSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test("DetectMappingRequestSchema: invalid format rejected", () => {
  const invalid = {
    headers: ["A"],
    sample_rows: [["foo"]],
    file_meta: { filename: "f.txt", format: "txt", size_bytes: 100 },
  };
  const result = DetectMappingRequestSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test("DetectMappingRequestSchema: too many headers rejected", () => {
  const invalid = {
    headers: new Array(51).fill("col"),
    sample_rows: [],
    file_meta: { filename: "f.xlsx", format: "xlsx", size_bytes: 1000 },
  };
  const result = DetectMappingRequestSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

// ─── DetectMappingResponseSchema ───────────────────────────

Deno.test("DetectMappingResponseSchema: valid Mistral response passes", () => {
  const valid = {
    header_row_index: 0,
    column_mapping: { Groupe: "raison_sociale", Contact: "contact_full", Email: "contact_email" },
    multi_contact_cells: [],
    confidence: 0.92,
  };
  const result = DetectMappingResponseSchema.safeParse(valid);
  assertEquals(result.success, true);
});

Deno.test("DetectMappingResponseSchema: invalid canonical field rejected", () => {
  const invalid = {
    header_row_index: 0,
    column_mapping: { Groupe: "not_a_canonical_field" },
    multi_contact_cells: [],
    confidence: 0.5,
  };
  const result = DetectMappingResponseSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test("DetectMappingResponseSchema: multi_contact_cells parsed correctly", () => {
  const valid = {
    header_row_index: 0,
    column_mapping: { Contact: "contact_full" },
    multi_contact_cells: [
      {
        row_index: 1,
        column_key: "Contact",
        raw: "Isabelle André (DG), Guillaume Gelis",
        split: [
          { first_name: "Isabelle", last_name: "André", role: "DG" },
          { first_name: "Guillaume", last_name: "Gelis" },
        ],
      },
    ],
    confidence: 0.85,
  };
  const result = DetectMappingResponseSchema.safeParse(valid);
  assertEquals(result.success, true);
});

// ─── PreviewRowSchema ──────────────────────────────────────

Deno.test("PreviewRowSchema: minimal valid row", () => {
  const valid = { raison_sociale: "Infopro Digital" };
  const result = PreviewRowSchema.safeParse(valid);
  assertEquals(result.success, true);
});

Deno.test("PreviewRowSchema: empty raison_sociale rejected", () => {
  const invalid = { raison_sociale: "" };
  const result = PreviewRowSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test("PreviewRowSchema: full row with all fields", () => {
  const valid = {
    raison_sociale: "Ferrero France",
    siren: "123456789",
    domain: "ferrero.fr",
    tier: "1",
    sector: "Agroalimentaire",
    address: "18 rue Jacques Monod, 76130 Mont-Saint-Aignan",
    city: "Mont-Saint-Aignan",
    country: "France",
    ca_estimate: "1000M€",
    fdv_size: "500+",
    contact_first_name: "Cédric",
    contact_last_name: "Leportier",
    contact_role: "Directeur Commercial France",
    contact_email: "cedric@ferrero.fr",
    contact_phone: "+33 1 23 45 67 89",
    linkedin_url: "https://www.linkedin.com/in/cedric-leportier",
    pipeline_status: "Invitation LinkedIn envoyée",
    notes: "Basé à Rouen. Ex-Henkel.",
    angle: "N+1 de Castello",
    imported_metadata: { fit_jay: 5, recommandation: "TIER 1" },
  };
  const result = PreviewRowSchema.safeParse(valid);
  assertEquals(result.success, true);
});

Deno.test("PreviewRowSchema: invalid email rejected", () => {
  const invalid = { raison_sociale: "X", contact_email: "not-an-email" };
  const result = PreviewRowSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test("PreviewRowSchema: empty email string is allowed (literal '')", () => {
  const valid = { raison_sociale: "X", contact_email: "" };
  const result = PreviewRowSchema.safeParse(valid);
  assertEquals(result.success, true);
});

// ─── ParseFreetextRequestSchema ────────────────────────────

Deno.test("ParseFreetextRequestSchema: valid pdf request", () => {
  const valid = {
    full_text: "Some extracted text",
    file_meta: { filename: "doc.pdf", format: "pdf", size_bytes: 5000 },
  };
  const result = ParseFreetextRequestSchema.safeParse(valid);
  assertEquals(result.success, true);
});

Deno.test("ParseFreetextRequestSchema: text > 200k rejected", () => {
  const invalid = {
    full_text: "a".repeat(200_001),
    file_meta: { filename: "doc.pdf", format: "pdf", size_bytes: 5000 },
  };
  const result = ParseFreetextRequestSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test("ParseFreetextRequestSchema: xlsx format rejected (use detect-import-mapping instead)", () => {
  const invalid = {
    full_text: "abc",
    file_meta: { filename: "doc.xlsx", format: "xlsx", size_bytes: 5000 },
  };
  const result = ParseFreetextRequestSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

// ─── EnqueueImportRequestSchema ────────────────────────────

Deno.test("EnqueueImportRequestSchema: valid commit payload", () => {
  const valid = {
    source_meta: { filename: "p.xlsx", format: "xlsx", size_bytes: 12000 },
    mapping_used: { header_row_index: 0, columns: { Groupe: "raison_sociale" } },
    rows: [{ raison_sociale: "Foo" }, { raison_sociale: "Bar" }],
  };
  const result = EnqueueImportRequestSchema.safeParse(valid);
  assertEquals(result.success, true);
});

Deno.test("EnqueueImportRequestSchema: options default applied", () => {
  const valid = {
    source_meta: { filename: "p.xlsx", format: "xlsx", size_bytes: 12000 },
    mapping_used: {},
    rows: [{ raison_sociale: "Foo" }],
  };
  const result = EnqueueImportRequestSchema.safeParse(valid);
  assert(result.success);
  assertEquals(result.data.options.skip_duplicates_already_engaged, true);
});

Deno.test("EnqueueImportRequestSchema: empty rows rejected", () => {
  const invalid = {
    source_meta: { filename: "p.xlsx", format: "xlsx", size_bytes: 1000 },
    mapping_used: {},
    rows: [],
  };
  const result = EnqueueImportRequestSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test("EnqueueImportRequestSchema: > 500 rows rejected", () => {
  const invalid = {
    source_meta: { filename: "p.xlsx", format: "xlsx", size_bytes: 1000 },
    mapping_used: {},
    rows: new Array(501).fill({ raison_sociale: "X" }),
  };
  const result = EnqueueImportRequestSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

// ─── CANONICAL_FIELDS coverage ─────────────────────────────

Deno.test("CANONICAL_FIELDS exposes all expected slots", () => {
  // Sanity check : la liste contient bien les champs critiques du spec
  const expected = [
    "raison_sociale",
    "contact_full",
    "contact_first_name",
    "contact_last_name",
    "contact_role",
    "contact_email",
    "linkedin_url",
    "tier",
    "pipeline_status",
    "_ignore",
  ];
  for (const field of expected) {
    assert(CANONICAL_FIELDS.includes(field as never), `Missing canonical field: ${field}`);
  }
});
