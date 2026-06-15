/**
 * Résolution du prompt de scoring d'un signal (Jay Reach dé-hardcoding PR2).
 *
 * Fonction PURE (zéro import), testée par Vitest et consommée par
 * score-prospect-signals (Deno). Fail-fast sans fallback Jay : si le trigger
 * n'a pas de prompt de scoring exploitable, on renvoie null et l'appelant
 * SKIPPE le signal (au lieu de le scorer avec l'ancien prompt Jay hardcodé).
 */

/** Sous-ensemble du trigger nécessaire à la résolution du prompt. */
export interface ScoringTrigger {
  signal_scoring_prompt: string | null;
}

/**
 * Seuil minimal de qualité d'un prompt custom. En dessous, on considère le
 * trigger comme non configuré pour le scoring (et on skippe, plus de repli Jay).
 */
export const MIN_CUSTOM_PROMPT_LENGTH = 200;

/**
 * Renvoie le system prompt à utiliser pour un signal, ou null si le trigger
 * n'a pas de prompt exploitable (introuvable, vide, ou trop court).
 *
 * Générique sur T extends ScoringTrigger : l'appelant (score-prospect-signals)
 * passe une Map<string, SignalTriggerRow> (type plus riche). Map étant invariant
 * sur son type de valeur, le générique évite une erreur de type sans cast.
 */
export function resolveSystemPrompt<T extends ScoringTrigger>(
  triggerId: string | null | undefined,
  triggers: Map<string, T>,
): string | null {
  if (!triggerId) return null;
  const trigger = triggers.get(triggerId);
  const prompt = trigger?.signal_scoring_prompt;
  if (prompt && prompt.length >= MIN_CUSTOM_PROMPT_LENGTH) {
    return prompt;
  }
  return null;
}
