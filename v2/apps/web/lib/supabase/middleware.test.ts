import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser } }) }));

const { updateSession } = await import('./middleware');

describe('updateSession', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'cle';
    getUser.mockReset();
  });

  it("ne pose aucun en-tête d'identité sur la requête transmise aux écrans", async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'vrai-utilisateur' } } });
    const requete = new NextRequest('http://localhost/campagnes');

    const { response, authenticated } = await updateSession(requete);

    expect(authenticated).toBe(true);
    // Next recopie les en-têtes de requête modifiés en `x-middleware-request-*`.
    const transmis = [...response.headers.keys()].filter((nom) => nom.includes('x-jr-user-id'));
    expect(transmis).toEqual([]);
  });

  it('sans session : non authentifié', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { authenticated } = await updateSession(new NextRequest('http://localhost/campagnes'));
    expect(authenticated).toBe(false);
  });
});
