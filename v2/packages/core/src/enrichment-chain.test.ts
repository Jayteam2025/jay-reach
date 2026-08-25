import { describe, expect, it, vi } from 'vitest';
import {
  estimateChainCostEur,
  runEnrichmentChain,
  type ChainProvider,
  type EnrichmentCache,
} from './enrichment-chain.js';

type In = { name: string };
type Out = { email: string };

function provider(id: string, confidence: number | null, cost = 0.1): ChainProvider<In, Out> {
  return {
    id,
    estimateCostEur: () => cost,
    enrich: vi.fn(async () =>
      confidence === null ? null : { data: { email: `${id}@x.fr` }, confidence },
    ),
  };
}

describe('runEnrichmentChain', () => {
  it('renvoie le premier résultat au-dessus du seuil et court-circuite la suite', async () => {
    const p1 = provider('low', 0.4);
    const p2 = provider('good', 0.9);
    const p3 = provider('never', 0.95);
    const out = await runEnrichmentChain({ name: 'X' }, [p1, p2, p3], { confidenceThreshold: 0.7 });
    expect(out?.providerId).toBe('good');
    expect(p3.enrich).not.toHaveBeenCalled();
  });

  it('renvoie null si aucun provider ne dépasse le seuil', async () => {
    const out = await runEnrichmentChain({ name: 'X' }, [provider('a', 0.4)], { confidenceThreshold: 0.7 });
    expect(out).toBeNull();
  });

  it('utilise le cache et ne rappelle pas les providers', async () => {
    const p = provider('fe', 0.9);
    const store = new Map<string, unknown>();
    const cache: EnrichmentCache<Out> = {
      get: async (k) => (store.get(k) as never) ?? null,
      set: async (k, v) => void store.set(k, v),
    };
    const opts = { confidenceThreshold: 0.7, cache, cacheKey: (i: In) => i.name };
    await runEnrichmentChain({ name: 'X' }, [p], opts);
    await runEnrichmentChain({ name: 'X' }, [p], opts);
    expect(p.enrich).toHaveBeenCalledTimes(1); // 2e appel servi par le cache
  });

  it('respecte le budget restant (arrêt avant dépassement)', async () => {
    const p1 = provider('a', 0.4, 0.1);
    const p2 = provider('b', 0.9, 0.1);
    const out = await runEnrichmentChain({ name: 'X' }, [p1, p2], {
      confidenceThreshold: 0.7,
      budgetRemainingEur: 0.1, // ne couvre qu'un appel
    });
    expect(out).toBeNull();
    expect(p2.enrich).not.toHaveBeenCalled();
  });

  it('estime le coût de la chaîne avant exécution', () => {
    expect(estimateChainCostEur([provider('a', 0.9, 0.25), provider('b', 0.9, 0.75)], 1)).toBeCloseTo(1);
  });
});
