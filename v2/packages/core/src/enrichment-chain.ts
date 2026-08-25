/**
 * Orchestration de l'enrichissement : providers chaînés dans un ordre
 * configurable, arrêt au premier résultat dépassant le seuil de confiance,
 * cache (ne jamais payer deux fois), budget par organisation, coût estimé
 * avant exécution. Logique PURE — les providers et le cache sont injectés.
 */

export interface EnrichmentOutcome<O = unknown> {
  readonly providerId: string;
  readonly data: O;
  readonly confidence: number;
}

export interface ChainProvider<I, O> {
  readonly id: string;
  /** Coût estimé (€) pour N opérations. */
  estimateCostEur(operations: number): number;
  /** Renvoie un résultat + sa confiance, ou null si rien trouvé. */
  enrich(input: I): Promise<{ data: O; confidence: number } | null>;
}

export interface EnrichmentCache<O> {
  get(key: string): Promise<EnrichmentOutcome<O> | null>;
  set(key: string, value: EnrichmentOutcome<O>): Promise<void>;
}

export interface ChainOptions<I, O> {
  readonly confidenceThreshold: number;
  readonly cache?: EnrichmentCache<O>;
  readonly cacheKey?: (input: I) => string;
  /** Budget restant (€). Un provider qui ferait dépasser le budget est sauté. */
  readonly budgetRemainingEur?: number;
}

/** Coût estimé de toute la chaîne, à afficher AVANT d'exécuter. */
export function estimateChainCostEur<I, O>(
  chain: readonly ChainProvider<I, O>[],
  operations: number,
): number {
  const total = chain.reduce((sum, provider) => sum + provider.estimateCostEur(operations), 0);
  return Math.round(total * 10000) / 10000;
}

export async function runEnrichmentChain<I, O>(
  input: I,
  chain: readonly ChainProvider<I, O>[],
  options: ChainOptions<I, O>,
): Promise<EnrichmentOutcome<O> | null> {
  // Cache : on ne paie jamais deux fois le même enrichissement.
  const key = options.cacheKey?.(input);
  if (options.cache && key !== undefined) {
    const cached = await options.cache.get(key);
    if (cached) {
      return cached;
    }
  }

  let spent = 0;
  for (const provider of chain) {
    const cost = provider.estimateCostEur(1);
    if (options.budgetRemainingEur !== undefined && spent + cost > options.budgetRemainingEur) {
      break; // budget épuisé : on s'arrête proprement.
    }
    spent += cost;

    const result = await provider.enrich(input);
    if (result && result.confidence >= options.confidenceThreshold) {
      const outcome: EnrichmentOutcome<O> = {
        providerId: provider.id,
        data: result.data,
        confidence: result.confidence,
      };
      if (options.cache && key !== undefined) {
        await options.cache.set(key, outcome);
      }
      return outcome;
    }
  }
  return null;
}
