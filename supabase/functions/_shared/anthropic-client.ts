/**
 * Claude Sonnet API Client for Deno
 * Simple wrapper for calling Anthropic's Claude models
 */

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

export const CLAUDE_MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
} as const;

function anthropicKey(explicit?: string | null): string {
  const k = explicit ?? Deno.env.get("ANTHROPIC_API_KEY");
  if (!k) throw new Error("ANTHROPIC_API_KEY manquante");
  return k;
}

export async function callClaude(opts: {
  apiKey?: string | null;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  jsonMode?: boolean;
  temperature?: number;
}): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey(opts.apiKey),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0,
      system: opts.system + (opts.jsonMode ? "\nRéponds UNIQUEMENT avec du JSON valide." : ""),
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return {
    text: json.content?.[0]?.text ?? "",
    usage: { input_tokens: json.usage?.input_tokens ?? 0, output_tokens: json.usage?.output_tokens ?? 0 },
  };
}

export async function callClaudeSonnet(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 2000
): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
  return callClaude({ model: CLAUDE_MODELS.sonnet, system: systemPrompt, user: userMessage, maxTokens });
}

// =====================================================
// Message Batches API (async processing, 50% cheaper)
// =====================================================

export interface BatchMessageRequest {
  custom_id: string;
  params: {
    model: string;
    max_tokens: number;
    system: string;
    messages: Array<{ role: string; content: string }>;
  };
}

export interface BatchStatusResponse {
  id: string;
  processing_status: string;
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
}

export interface BatchResultItem {
  custom_id: string;
  result: {
    type: string;
    message?: {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    error?: { type: string; message: string };
  };
}

function getAnthropicHeaders(apiKey?: string | null): Record<string, string> {
  const key = anthropicKey(apiKey);
  return {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  };
}

export async function createMessageBatch(
  requests: BatchMessageRequest[],
  apiKey?: string | null,
): Promise<BatchStatusResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages/batches', {
    method: 'POST',
    headers: getAnthropicHeaders(apiKey),
    body: JSON.stringify({ requests }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Batch create error (${response.status}): ${errorText.substring(0, 300)}`);
  }

  return await response.json();
}

export async function getMessageBatch(
  batchId: string,
  apiKey?: string | null,
): Promise<BatchStatusResponse> {
  const headers = getAnthropicHeaders(apiKey);
  const response = await fetch(
    `https://api.anthropic.com/v1/messages/batches/${batchId}`,
    { headers }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Batch check error (${response.status}): ${errorText.substring(0, 300)}`);
  }

  return await response.json();
}

export async function getMessageBatchResults(
  batchId: string,
  apiKey?: string | null,
): Promise<BatchResultItem[]> {
  const headers = getAnthropicHeaders(apiKey);
  const response = await fetch(
    `https://api.anthropic.com/v1/messages/batches/${batchId}/results`,
    { headers }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Batch results error (${response.status}): ${errorText.substring(0, 300)}`);
  }

  const text = await response.text();
  return text.trim().split('\n').filter(l => l.trim()).map(line => JSON.parse(line));
}
