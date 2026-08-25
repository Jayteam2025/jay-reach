/**
 * Adaptateur réel du scoring : implémente `SignalScorer` via Anthropic. C'est le
 * SEUL endroit qui appelle le modèle (règle CLAUDE.md #4 : provider derrière une
 * interface). Non exercé par les tests hermétiques, qui injectent un scorer pur.
 */
import Anthropic from '@anthropic-ai/sdk';
import { buildScoringUserMessage, parseScoringResponse } from '@jay-reach/core';
import type { SignalScorer } from './handlers/score.js';

const DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * Construit un scorer branché sur Anthropic. `apiKey` vient du coffre à
 * credentials (ou du repli env), jamais d'un payload de job.
 */
export function createAnthropicScorer(apiKey: string, model: string = DEFAULT_MODEL): SignalScorer {
  const client = new Anthropic({ apiKey });
  return async (prospects, systemPrompt) => {
    if (prospects.length === 0) return [];
    const res = await client.messages.create({
      model,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: buildScoringUserMessage(prospects) }],
    });
    const text = res.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    return parseScoringResponse(text);
  };
}
