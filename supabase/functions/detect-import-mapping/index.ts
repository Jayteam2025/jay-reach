import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { checkRateLimit } from "../_shared/rate-limiter.ts";
import { validateOrRespond } from "../_shared/validation.ts";
import { resolveLLMForDefaultWorkspace } from "../_shared/providers/registry.ts";
import type { LLMHandle } from "../_shared/providers/types.ts";
import {
  DetectMappingRequestSchema,
  DetectMappingResponseSchema,
  CANONICAL_FIELDS,
} from "../_shared/schemas/prospect-import.ts";

/**
 * detect-import-mapping
 *
 * Reçoit un échantillon (headers + 5-10 lignes) d'un fichier tabulaire
 * (XLSX/CSV/TSV) et retourne :
 *   - l'index de la ligne header (si non-1)
 *   - le mapping colonnes → champs canoniques (raison_sociale, contact_full, …)
 *   - les cellules multi-contacts à splitter ("Isabelle André (DG), Guillaume Gelis")
 *
 * Claude Sonnet, 1 call batché. Spec : docs/superpowers/specs/2026-05-12-prospection-file-upload-import-design.md
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const SYSTEM_PROMPT = `Tu es un assistant qui analyse des fichiers de prospection commerciale.
Ton rôle : à partir d'un échantillon de fichier tabulaire (headers + lignes), détecter :

1. **header_row_index** : l'index (0-based) de la ligne qui contient les en-têtes.
   Cas courants : 0 (normal), 3 ou 4 (titre + sous-titre + ligne vide avant les headers).

2. **column_mapping** : associer CHAQUE colonne du header à un champ canonique.
   Champs canoniques disponibles : ${CANONICAL_FIELDS.join(", ")}.
   Utilise "_ignore" pour les colonnes inutiles (Notes vides, champs purement décoratifs).
   Le mapping est { "nom_colonne_dans_header": "champ_canonique" }.

3. **multi_contact_cells** : repérer les cellules qui contiennent PLUSIEURS contacts
   dans une même valeur (ex: "Isabelle André (DG), Guillaume Gelis (Dir. Commercial)").
   Pour chaque cellule détectée, fournir le row_index, column_key, raw, et un split
   structuré en [{ first_name, last_name, role }].

4. **confidence** : 0.0 à 1.0, ton degré de certitude sur le mapping.

RÈGLES IMPORTANTES :
- "Groupe", "Entreprise", "Société", "Boîte", "Raison sociale" → raison_sociale
- "Contact à cibler", "Contact clé", "Contact" en cellule libre → contact_full
- "Prénom" séparé, "Nom" séparé → contact_first_name / contact_last_name
- "Tier", "Priorité", "🔥 TIER 1" → tier (normalise "🔥 TIER 1" en "1")
- "Statut", "État" → pipeline_status (garde la valeur brute, le smart-skip se fera en aval)
- "Adresse postale" → address
- "URL LinkedIn", "LinkedIn" → linkedin_url
- "Angle d'approche", "Stratégie" → angle
- "Notes" → notes
- "Fit Jay", "Score" → fit_score
- "CA estimé", "Chiffre d'affaires" → ca_estimate
- "Force commerciale terrain", "Taille FDV" → fdv_size
- "Spécialité", "Secteur", "Catégorie" → sector
- "Pays" → country
- "Ville" → city

Retourne UNIQUEMENT un objet JSON valide, pas de markdown.`;

function buildUserPrompt(headers: string[], sampleRows: unknown[][]): string {
  const headerLine = `HEADERS détectés (ligne actuelle 0) : ${JSON.stringify(headers)}`;
  const sampleLines = sampleRows
    .map((row, i) => `LIGNE ${i + 1} : ${JSON.stringify(row)}`)
    .join("\n");

  return `${headerLine}

ÉCHANTILLON :
${sampleLines}

Analyse et retourne le mapping JSON.`;
}

async function callLLM(systemPrompt: string, userPrompt: string, llm: LLMHandle): Promise<string> {
  const result = await llm.provider.complete({
    tier: "smart",
    system: systemPrompt,
    user: userPrompt,
    jsonMode: true,
    temperature: 0.1,
    maxTokens: 4096,
  }, llm.context);

  // Strip defisif des fences ```json ... ``` ou ``` ... ```
  let jsonText = result.text.trim();
  if (jsonText.startsWith("```json")) {
    jsonText = jsonText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  return jsonText;
}

async function callLLMWithRetry(
  systemPrompt: string,
  userPrompt: string,
  llm: LLMHandle
): Promise<string> {
  try {
    return await callLLM(systemPrompt, userPrompt, llm);
  } catch (err) {
    console.warn("[DETECT-MAPPING] LLM 1st attempt failed:", err instanceof Error ? err.message : err);
    return await callLLM(systemPrompt, userPrompt, llm);
  }
}

function json(body: unknown, status: number, corsHeaders: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  try {
    // 1. Auth
    const { userId, error: authError } = await extractUserId(supabase, req);
    if (authError || !userId) {
      return json({ error: "Unauthorized" }, 401, corsHeaders);
    }

    // 2. Admin gating
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (profile?.role !== "admin") {
      return json({ error: "Admin only" }, 403, corsHeaders);
    }

    // 3. Rate limit (admin category : 30/min)
    const rateLimit = await checkRateLimit(supabase, userId, "user", "admin");
    if (!rateLimit.allowed) {
      return json(
        {
          error: "Rate limit exceeded",
          retry_after: Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000),
        },
        429,
        corsHeaders
      );
    }

    // 4. Validation Zod
    const body = await req.json().catch(() => ({}));
    const validation = validateOrRespond(DetectMappingRequestSchema, body, corsHeaders, "strict", {
      functionName: "detect-import-mapping",
      userId,
    });
    if (validation.response) return validation.response;

    const { headers, sample_rows } = validation.data;

    // 5. Resolve le LLM actif du workspace par défaut
    let llm: LLMHandle;
    try {
      llm = await resolveLLMForDefaultWorkspace(supabase);
    } catch (err) {
      console.error("[DETECT-MAPPING] Failed to resolve LLM provider:", err);
      return json(
        {
          error: "AI mapping failed",
          message: "Le service d'IA est temporairement indisponible. Veuillez réessayer ou configurer le mapping manuellement.",
        },
        502,
        corsHeaders
      );
    }

    // 6. Appel Claude Sonnet
    let rawContent: string;
    try {
      rawContent = await callLLMWithRetry(SYSTEM_PROMPT, buildUserPrompt(headers, sample_rows), llm);
    } catch (err) {
      console.error("[DETECT-MAPPING] LLM failed after retry:", err);
      return json(
        {
          error: "AI mapping failed",
          message: "Le mapping automatique a échoué. Vous pouvez le configurer manuellement dans la preview.",
        },
        502,
        corsHeaders
      );
    }

    // 7. Parse et valide la réponse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (err) {
      console.error("[DETECT-MAPPING] Invalid JSON from LLM:", rawContent.slice(0, 200));
      return json(
        { error: "AI returned invalid JSON", message: "Configuration manuelle requise." },
        502,
        corsHeaders
      );
    }

    const responseValidation = DetectMappingResponseSchema.safeParse(parsed);
    if (!responseValidation.success) {
      console.error("[DETECT-MAPPING] LLM response shape mismatch:", responseValidation.error.issues);
      return json(
        {
          error: "AI response shape mismatch",
          message: "Le mapping retourné est invalide. Configuration manuelle requise.",
          details: responseValidation.error.issues.slice(0, 5),
        },
        502,
        corsHeaders
      );
    }

    return json(responseValidation.data, 200, corsHeaders);
  } catch (err) {
    console.error("[DETECT-MAPPING] Unhandled error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500,
      corsHeaders
    );
  }
});
