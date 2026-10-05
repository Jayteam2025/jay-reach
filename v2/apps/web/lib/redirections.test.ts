import { describe, expect, it } from 'vitest';
import { REDIRECTIONS } from './redirections';
import nextConfig from '../next.config';

describe('redirections des anciens écrans (tâche 24)', () => {
  it('chaque ancienne route a une destination non vide, distincte d’elle-même', () => {
    for (const { source, destination } of REDIRECTIONS) {
      expect(source.startsWith('/')).toBe(true);
      expect(destination.startsWith('/')).toBe(true);
      expect(destination).not.toBe(source);
    }
  });

  it('aucune source n’est dupliquée', () => {
    const sources = REDIRECTIONS.map((r) => r.source);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('aucune destination n’est elle-même une ancienne route (pas de chaîne de redirections)', () => {
    const sources = new Set(REDIRECTIONS.map((r) => r.source));
    for (const { destination } of REDIRECTIONS) {
      // Une destination peut porter une query string (`?onglet=...`) : seul le
      // chemin compte pour ce contrôle.
      const chemin = destination.split('?')[0]!;
      expect(sources.has(chemin)).toBe(false);
    }
  });

  it('next.config.ts consomme bien la table (redirections permanentes)', async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toEqual(REDIRECTIONS.map((r) => ({ ...r, permanent: true })));
  });
});
