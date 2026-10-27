import { beforeEach, describe, expect, it, vi } from 'vitest';

const valeurs = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (nom: string) => (valeurs.has(nom) ? { name: nom, value: valeurs.get(nom) ?? '' } : undefined) }),
}));

import { demarrageFerme, nomCookieDemarrageFerme } from './demarrage-fermeture';

describe('la fermeture du guide de démarrage', () => {
  beforeEach(() => valeurs.clear());

  it('est mémorisée par utilisateur : le nom du cookie porte son identifiant', () => {
    expect(nomCookieDemarrageFerme('u1')).not.toBe(nomCookieDemarrageFerme('u2'));
  });

  it('ouverte par défaut', async () => {
    expect(await demarrageFerme('u1')).toBe(false);
  });

  it('fermée pour celui qui l’a fermée, pas pour un autre sur le même navigateur', async () => {
    valeurs.set(nomCookieDemarrageFerme('u1'), '1');
    expect(await demarrageFerme('u1')).toBe(true);
    expect(await demarrageFerme('u2')).toBe(false);
  });

  it('sans utilisateur identifié, jamais fermée', async () => {
    expect(await demarrageFerme(null)).toBe(false);
  });
});
