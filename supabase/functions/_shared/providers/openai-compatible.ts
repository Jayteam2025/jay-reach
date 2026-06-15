/**
 * Adapter LLMProvider générique pour toute API "OpenAI-compatible"
 * (POST {base_url}/chat/completions) : OpenAI, Mistral, Groq, Ollama, vLLM...
 *
 * Credentials requis (saisis en UI ou via env fallback) :
 *   - api_key     : clé API (pour Ollama local, mettre n'importe quoi)
 *   - base_url    : ex. https://api.openai.com/v1, https://api.mistral.ai/v1,
 *                   http://localhost:11434/v1 (Ollama)
 *   - model_fast  : modèle des micro-tâches (ex. gpt-4o-mini, mistral-small-latest)
 *   - model_smart : modèle des tâches exigeantes (ex. gpt-4o, mistral-large-latest)
 *
 * supportsBatch=false : le scoring bascule en fallback sync (boucle complete()).
 * jsonMode = instruction système, pas de response_format (compat maximale —
 * tous les serveurs compatibles ne le supportent pas).
 */
import type { LLMProvider, LLMRequest, LLMResponse, LLMTier, ResolvedProvider } from "./types.ts";

interface OpenAICompatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function requiredCredential(ctx: ResolvedProvider, field: string): string {
  const v = ctx.credentials?.[field];
  if (!v || !v.trim()) {
    throw new Error(`openai_compatible: credential '${field}' manquant (à saisir dans Config → Providers)`);
  }
  return v.trim();
}

function modelFor(tier: LLMTier, ctx: ResolvedProvider): string {
  return requiredCredential(ctx, tier === "fast" ? "model_fast" : "model_smart");
}

export const openaiCompatibleLLM: LLMProvider = {
  type: "openai_compatible",
  supportsBatch: false,

  async complete(req: LLMRequest, ctx: ResolvedProvider): Promise<LLMResponse> {
    const baseUrl = requiredCredential(ctx, "base_url").replace(/\/+$/, "");
    const system = req.system + (req.jsonMode ? "\nRéponds UNIQUEMENT avec du JSON valide." : "");

    const messages: Array<{ role: string; content: string }> = [];
    if (system.trim()) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: req.user });

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${requiredCredential(ctx, "api_key")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelFor(req.tier, ctx),
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0,
        messages,
      }),
    });
    if (!res.ok) {
      throw new Error(`openai_compatible ${res.status}: ${(await res.text()).substring(0, 300)}`);
    }
    const json = await res.json() as OpenAICompatResponse;
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      usage: {
        input_tokens: json.usage?.prompt_tokens ?? 0,
        output_tokens: json.usage?.completion_tokens ?? 0,
      },
    };
  },
};
