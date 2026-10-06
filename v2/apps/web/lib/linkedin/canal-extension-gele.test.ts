import { describe, expect, it, vi } from 'vitest';

// Un jeton, meme valide, n'obtient rien des cinq routes de l'extension : la
// base n'est jamais ouverte et le corps jamais lu.
const getPool = vi.fn(() => {
  throw new Error('la base ne doit pas etre ouverte');
});
vi.mock('../db', () => ({ getPool }));

const ROUTES = ['next', 'update', 'replies', 'profile', 'watchlist'] as const;

describe('canal extension gele : routes /api/extension/linkedin', () => {
  it.each(ROUTES)('%s refuse en 410 sans toucher la base ni lire le corps', async (nom) => {
    const { POST } = (await import(`../../app/api/extension/linkedin/${nom}/route.ts`)) as {
      POST: (req: Request) => Promise<Response>;
    };
    const req = new Request(`http://localhost/api/extension/linkedin/${nom}`, {
      method: 'POST',
      body: JSON.stringify({ token: 'jeton-valide' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'canal_gele' });
    expect(req.bodyUsed).toBe(false);
    expect(getPool).not.toHaveBeenCalled();
  });
});
