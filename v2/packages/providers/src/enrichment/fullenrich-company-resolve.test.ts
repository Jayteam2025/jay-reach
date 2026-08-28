/**
 * Un échec du provider n'est pas une absence de résultat.
 *
 * Les deux se ressemblaient : chaque erreur d'appel était transformée en tableau
 * vide, puis mémorisée comme « entreprise introuvable » pendant 24 heures. Un
 * compte FullEnrich à sec suffisait donc à faire disparaître des entreprises du
 * pipeline pour une journée, y compris après rechargement des crédits, sans que
 * rien ne l'explique — constaté en recette le 2026-08-28 sur neuf entreprises.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveCompany, type SupabaseLike } from './fullenrich-company-resolve.js';

/** Cache en mémoire qui note ce qu'on lui demande d'écrire. */
function cacheEspion() {
  const ecritures: { type: string; cle: string; data: unknown }[] = [];
  const cache: SupabaseLike = {
    from() {
      return {
        select() {
          const etage = {
            eq() {
              return { ...etage, maybeSingle: async () => ({ data: null, error: null }) };
            },
          };
          return etage;
        },
        async upsert(values: Record<string, unknown>) {
          ecritures.push({
            type: String(values.cache_type ?? ''),
            cle: String(values.cache_key ?? ''),
            data: values.data,
          });
          return { error: null };
        },
      };
    },
  };
  return { cache, ecritures };
}

/** Nombre d'entrées « introuvable » mémorisées. */
function negatifs(ecritures: { data: unknown }[]): number {
  return ecritures.filter((e) => (e.data as { id?: string } | null)?.id === '__not_found__').length;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveCompany — échec provider ou absence de résultat', () => {
  it('ne mémorise rien quand le provider refuse (crédits épuisés)', async () => {
    // Cas réel : HTTP 403 error.not_enough_credits sur tous les appels.
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ code: 'error.not_enough_credits', message: 'Not enough credits' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { cache, ecritures } = cacheEspion();

    const resultat = await resolveCompany(cache, 'cle-test', 'LÉA NATURE', { country_code: 'FR', llm: null });

    expect(resultat, "un échec provider ne résout aucune entreprise").toBeNull();
    expect(
      negatifs(ecritures),
      "un compte à sec ne doit pas faire passer une entreprise pour introuvable pendant 24 h",
    ).toBe(0);
  });

  it('mémorise bien une absence réelle de résultat', async () => {
    // Le provider répond normalement, il ne connaît simplement pas l'entreprise.
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ companies: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { cache, ecritures } = cacheEspion();

    const resultat = await resolveCompany(cache, 'cle-test', 'Entreprise Inexistante SARL', {
      country_code: 'FR',
      llm: null,
    });

    expect(resultat).toBeNull();
    expect(
      negatifs(ecritures),
      'une absence confirmée mérite le cache : elle évite de repayer le même appel',
    ).toBeGreaterThan(0);
  });
});
