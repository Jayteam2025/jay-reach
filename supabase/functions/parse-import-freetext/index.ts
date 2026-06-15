import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { checkRateLimit } from "../_shared/rate-limiter.ts";
import { validateOrRespond } from "../_shared/validation.ts";
import { resolveLLMForDefaultWorkspace } from "../_shared/providers/registry.ts";
import type { LLMHandle } from "../_shared/providers/types.ts";
import {
  ParseFreetextRequestSchema,
  ParseFreetextResponseSchema,
  PreviewRowSchema,
} from "../_shared/schemas/prospect-import.ts";
import { z } from "npm:zod@3.24.1";

/**
 * parse-import-freetext
 *
 * Reçoit du texte libre extrait d'un PDF / DOCX / collé manuellement
 * et retourne des prospects structurés via Claude Sonnet.
 *
 * Chunking automatique : si le texte dépasse ~8k tokens, on coupe en
 * blocs de ~50 prospects max et on agrège les résultats.
 *
 * Spec : docs/superpowers/specs/2026-05-12-prospection-file-upload-import-design.md
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Cap arbitraire par appel Claude pour rester sous ~10k tokens output.
const CHUNK_CHAR_LIMIT = 40_000;

const SYSTEM_PROMPT = `Tu es un assistant qui extrait des prospects commerciaux d'un texte libre.

Le texte peut provenir d'un PDF, d'un DOCX ou d'un copier-coller. La structure
n'est pas tabulaire : repère les entreprises, les contacts, et les infos associées.

Retourne UN OBJET JSON avec un tableau "rows" (max 50 prospects par appel) et un champ "confidence" (0-1).

CHAQUE LIGNE doit suivre EXACTEMENT cette forme :

{
  "raison_sociale": "string (obligatoire)",
  "siren": "string optionnelle",
  "domain": "string optionnelle (site web)",
  "tier": "string optionnelle (1/2/3 ou laisser brut)",
  "sector": "string optionnelle",
  "address": "string optionnelle (adresse complète)",
  "city": "string optionnelle",
  "country": "string optionnelle",
  "ca_estimate": "string optionnelle",
  "fdv_size": "string optionnelle (taille force de vente)",
  "contact_first_name": "string optionnelle",
  "contact_last_name": "string optionnelle",
  "contact_role": "string optionnelle (poste)",
  "contact_email": "string optionnelle",
  "contact_phone": "string optionnelle",
  "linkedin_url": "string optionnelle (URL profil OU placeholder type 'à rechercher')",
  "pipeline_status": "string optionnelle (statut commercial : 'invitation envoyée', 'en contact', etc.)",
  "notes": "string optionnelle",
  "angle": "string optionnelle (angle d'approche)",
  "imported_metadata": "objet libre pour tout ce qui ne rentre pas ailleurs"
}

RÈGLES :
- Une entreprise avec PLUSIEURS contacts → produis PLUSIEURS rows (1 par contact) avec la même raison_sociale.
- Tier : si tu vois "🔥 TIER 1" ou "Priorité haute" → "1". "⭐ TIER 2" → "2". Sinon laisse brut.
- Ne pas inventer d'emails. Si non présent dans le texte, omet le champ.
- Si tu détectes "Invitation LinkedIn envoyée" ou similaire → mets-le dans pipeline_status BRUT, le smart-skip se fera en aval.
- imported_metadata est utile pour : "Angle d'approche", "Fit Jay", "Spécialité", "Notes" si non standard.

Retourne UNIQUEMENT le JSON. Pas de markdown, pas de prose.`;

function buildUserPrompt(fullText: string): string {
  return `Extrais tous les prospects de ce texte. Retourne JSON { "rows": [...], "confidence": 0.x }.

TEXTE :
${fullText}`;
}

async function callLLM(systemPrompt: string, userPrompt: string, llm: LLMHandle): Promise<string> {
  const result = await llm.provider.complete({
    tier: "smart",
    system: systemPrompt,
    user: userPrompt,
    jsonMode: true,
    temperature: 0.1,
    maxTokens: 16000,
  }, llm.context);

  // Strip defensif des fences ```json ... ``` ou ``` ... ```
  let jsonText = result.text.trim();
  if (jsonText.startsWith("```json")) {
    jsonText = jsonText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  return jsonText;
}

function chunkText(text: string, maxCharsPerChunk: number): string[] {
  if (text.length <= maxCharsPerChunk) return [text];

  // Split sur les doubles sauts de ligne (paragraphes) pour ne pas couper au milieu
  // d'un prospect. Si un paragraphe dépasse le cap → coupe brut.
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxCharsPerChunk) {
      if (current) chunks.push(current);
      if (para.length > maxCharsPerChunk) {
        // Para trop long, force-coupe
        for (let i = 0; i < para.length; i += maxCharsPerChunk) {
          chunks.push(para.slice(i, i + maxCharsPerChunk));
        }
        current = "";
      } else {
        current = para;
      }
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const ChunkResponseSchema = z.object({
  rows: z.array(PreviewRowSchema).max(80),
  confidence: z.number().min(0).max(1),
});

async function parseOneChunk(text: string, llm: LLMHandle): Promise<{
  rows: z.infer<typeof PreviewRowSchema>[];
  confidence: number;
}> {
  const content = await callLLM(SYSTEM_PROMPT, buildUserPrompt(text), llm);
  const parsed = JSON.parse(content);
  const validation = ChunkResponseSchema.safeParse(parsed);
  if (!validation.success) {
    console.error("[PARSE-FREETEXT] Chunk shape mismatch:", validation.error.issues.slice(0, 3));
    return { rows: [], confidence: 0 };
  }
  return validation.data;
}

function json(body: unknown, status: number, corsHeaders: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, corsHeaders);

  try {
    // 1. Auth
    const { userId, error: authError } = await extractUserId(supabase, req);
    if (authError || !userId) return json({ error: "Unauthorized" }, 401, corsHeaders);

    // 2. Admin gating
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (profile?.role !== "admin") return json({ error: "Admin only" }, 403, corsHeaders);

    // 3. Rate limit (admin category : 30/min, cet endpoint est coûteux en tokens LLM)
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

    // 4. Validation
    const body = await req.json().catch(() => ({}));
    const validation = validateOrRespond(ParseFreetextRequestSchema, body, corsHeaders, "strict", {
      functionName: "parse-import-freetext",
      userId,
    });
    if (validation.response) return validation.response;

    const { full_text } = validation.data;

    // 5. Resolve le LLM actif du workspace par défaut
    let llm: LLMHandle;
    try {
      llm = await resolveLLMForDefaultWorkspace(supabase);
    } catch (err) {
      console.error("[PARSE-FREETEXT] Failed to resolve LLM provider:", err);
      return json(
        {
          error: "AI parsing failed",
          message: "Le service d'IA est temporairement indisponible. Veuillez réessayer ou utiliser un format tabulaire (XLSX/CSV).",
        },
        502,
        corsHeaders
      );
    }

    // 6. Chunking si nécessaire
    const chunks = chunkText(full_text, CHUNK_CHAR_LIMIT);
    if (chunks.length > 10) {
      return json(
        {
          error: "Texte trop volumineux",
          message: `Document généré ${chunks.length} chunks (max 10). Réduisez le contenu ou splittez le fichier.`,
        },
        400,
        corsHeaders
      );
    }

    // 7. Appels Claude (séquentiel)
    const allRows: z.infer<typeof PreviewRowSchema>[] = [];
    const confidences: number[] = [];

    for (let i = 0; i < chunks.length; i++) {
      try {
        const { rows, confidence } = await parseOneChunk(chunks[i], llm);
        allRows.push(...rows);
        confidences.push(confidence);
      } catch (err) {
        console.error(`[PARSE-FREETEXT] Chunk ${i + 1}/${chunks.length} failed:`, err);
        // Continue avec les autres chunks ; le preview montre ce qu'on a
      }
    }

    if (allRows.length === 0) {
      return json(
        {
          error: "No prospects detected",
          message:
            "Aucun prospect n'a pu être extrait. Vérifiez le contenu ou utilisez un format tabulaire (XLSX/CSV).",
        },
        422,
        corsHeaders
      );
    }

    // Cap à 500 par fichier (CHECK schema)
    const cappedRows = allRows.slice(0, 500);
    const avgConfidence =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0.5;

    const response = ParseFreetextResponseSchema.parse({
      rows: cappedRows,
      confidence: avgConfidence,
    });

    return json(response, 200, corsHeaders);
  } catch (err) {
    console.error("[PARSE-FREETEXT] Unhandled error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500,
      corsHeaders
    );
  }
});
