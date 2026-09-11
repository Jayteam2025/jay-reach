import { describe, it, expect, vi, afterEach } from 'vitest';
import { listerBoitesSalesBlink } from './salesblink';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('listerBoitesSalesBlink', () => {
  it('un fetch qui expire (AbortSignal.timeout) renvoie le code générique "reseau", jamais la clé', async () => {
    // `ENCRYPTION_KEY` vide : la résolution retombe directement sur la
    // variable d'environnement, sans toucher le pool `pg`.
    vi.stubEnv('ENCRYPTION_KEY', '');
    vi.stubEnv('SALESBLINK_API_KEY', 'cle-de-test-tres-secrete');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('Le délai est dépassé', 'TimeoutError');
      }),
    );

    const resultat = await listerBoitesSalesBlink('org-1');

    expect(resultat).toEqual({ ok: false, error: 'reseau' });
  });

  it('sans clé configurée (ni coffre ni environnement), renvoie "no_key" sans appeler fetch', async () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    vi.stubEnv('SALESBLINK_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const resultat = await listerBoitesSalesBlink('org-1');

    expect(resultat).toEqual({ ok: false, error: 'no_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
