/**
 * Adaptateur réel du scoring : implémente `SignalScorer` via Anthropic. C'est le
 * SEUL endroit qui appelle le modèle (règle CLAUDE.md #4 : provider derrière une
 * interface). Non exercé par les tests hermétiques, qui injectent un scorer pur.
 *
 * Modèle : niveau `smart` du socle (Sonnet), surchargé par organisation via la
 * config du provider (`model_smart`). `thinking` explicitement DÉSACTIVÉ : sur
 * Sonnet 5 l'omettre déclenche le raisonnement adaptatif (nouveau défaut), qui
 * facture des tokens, ajoute de la latence et surtout ponctionne le même budget
 * `max_tokens` que le JSON de réponse. On garde donc le comportement du socle
 * (pas de raisonnement pour cette tâche de classification). `max_tokens` est
 * dimensionné sur la taille du lot (voir `scoringMaxTokens`).
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  buildScoringUserMessage,
  parseScoringResponse,
  resolveScoringModel,
  scoringMaxTokens,
} from '@jay-reach/core';
import type { SignalScorer } from './handlers/score.js';

/**
 * Construit un scorer branché sur Anthropic. `apiKey` vient du coffre à
 * credentials (ou du repli env), jamais d'un payload de job. `config` porte les
 * réglages non sensibles du provider (dont `model_smart`), édités par org.
 */
export function createAnthropicScorer(
  apiKey: string,
  config?: Record<string, string | undefined> | null,
): SignalScorer {
  const client = new Anthropic({ apiKey });
  const model = resolveScoringModel('smart', config);
  return async (prospects, systemPrompt) => {
    if (prospects.length === 0) return [];
    const res = await client.messages.create({
      model,
      max_tokens: scoringMaxTokens(prospects.length),
      thinking: { type: 'disabled' },
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
