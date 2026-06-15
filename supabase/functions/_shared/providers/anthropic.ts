/**
 * Adapter LLMProvider pour Anthropic (Claude) — provider LLM par défaut.
 *
 * Wrappe le client brut anthropic-client.ts sous l'interface LLMProvider.
 * Tier → modèle : fast=Haiku, smart=Sonnet (overridable par workspace via
 * config.model_fast / config.model_smart).
 * supportsBatch=true : Message Batches API (50% moins cher, utilisé par le
 * scoring).
 */
import {
  callClaude,
  CLAUDE_MODELS,
  createMessageBatch,
  getMessageBatch,
  getMessageBatchResults,
} from "../anthropic-client.ts";
import type {
  LLMBatchRequestItem,
  LLMBatchResultItem,
  LLMBatchStatus,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMTier,
  ResolvedProvider,
} from "./types.ts";

function modelFor(tier: LLMTier, ctx: ResolvedProvider): string {
  const override = ctx.config?.[tier === "fast" ? "model_fast" : "model_smart"];
  if (typeof override === "string" && override.trim()) return override;
  return tier === "fast" ? CLAUDE_MODELS.haiku : CLAUDE_MODELS.sonnet;
}

export const anthropicLLM: LLMProvider = {
  type: "anthropic",
  supportsBatch: true,

  async complete(req: LLMRequest, ctx: ResolvedProvider): Promise<LLMResponse> {
    return await callClaude({
      apiKey: ctx.apiKey,
      model: modelFor(req.tier, ctx),
      system: req.system,
      user: req.user,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      jsonMode: req.jsonMode,
    });
  },

  async submitBatch(items: LLMBatchRequestItem[], ctx: ResolvedProvider): Promise<{ providerBatchId: string }> {
    const batch = await createMessageBatch(
      items.map((item) => ({
        custom_id: item.customId,
        params: {
          model: modelFor(item.request.tier, ctx),
          max_tokens: item.request.maxTokens ?? 1024,
          system: item.request.system + (item.request.jsonMode ? "\nRéponds UNIQUEMENT avec du JSON valide." : ""),
          messages: [{ role: "user", content: item.request.user }],
        },
      })),
      ctx.apiKey,
    );
    return { providerBatchId: batch.id };
  },

  async checkBatch(providerBatchId: string, ctx: ResolvedProvider): Promise<LLMBatchStatus> {
    const batch = await getMessageBatch(providerBatchId, ctx.apiKey);
    return {
      providerBatchId: batch.id,
      status: batch.processing_status === "ended" ? "ended" : "processing",
      counts: {
        processing: batch.request_counts?.processing ?? 0,
        succeeded: batch.request_counts?.succeeded ?? 0,
        errored: batch.request_counts?.errored ?? 0,
      },
    };
  },

  async fetchBatchResults(providerBatchId: string, ctx: ResolvedProvider): Promise<LLMBatchResultItem[]> {
    const results = await getMessageBatchResults(providerBatchId, ctx.apiKey);
    return results.map((r) => ({
      customId: r.custom_id,
      text: r.result.type === "succeeded" ? (r.result.message?.content?.[0]?.text ?? "") : null,
      error: r.result.type === "succeeded"
        ? null
        : (r.result.error?.message ?? r.result.type),
      usage: r.result.message?.usage,
    }));
  },
};
