import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pose, revalide, etat } = vi.hoisted(() => ({
  pose: vi.fn(),
  revalide: vi.fn(),
  etat: { utilisateurId: 'u1' as string | null },
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ set: pose }) }));
vi.mock('next/cache', () => ({ revalidatePath: revalide }));
vi.mock('../../lib/contexte', () => ({ contexteCourant: async () => ({ utilisateurId: etat.utilisateurId }) }));

import { fermerDemarrage } from './demarrage';
import { DUREE_FERMETURE_DEMARRAGE_SECONDES, nomCookieDemarrageFerme } from '../../lib/demarrage-fermeture';

describe("l'action qui ferme le guide de démarrage", () => {
  beforeEach(() => {
    pose.mockReset();
    revalide.mockReset();
    etat.utilisateurId = 'u1';
  });

  it('pose un cookie dont le nom vient de la session, pas d’un paramètre', async () => {
    await fermerDemarrage();
    expect(pose).toHaveBeenCalledTimes(1);
    expect(pose.mock.calls[0]?.[0]).toBe(nomCookieDemarrageFerme('u1'));
    expect(pose.mock.calls[0]?.[1]).toBe('1');
  });

  it('pose un cookie d’un an, illisible du navigateur, pour tout le site', async () => {
    await fermerDemarrage();
    expect(pose.mock.calls[0]?.[2]).toMatchObject({
      maxAge: DUREE_FERMETURE_DEMARRAGE_SECONDES,
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
    });
  });

  it('redessine l’écran Aujourd’hui', async () => {
    await fermerDemarrage();
    expect(revalide).toHaveBeenCalledWith('/');
  });

  it('sans utilisateur identifié, ne fait rien', async () => {
    etat.utilisateurId = null;
    await fermerDemarrage();
    expect(pose).not.toHaveBeenCalled();
    expect(revalide).not.toHaveBeenCalled();
  });
});
