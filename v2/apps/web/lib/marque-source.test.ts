import { describe, expect, it } from 'vitest';
import { marqueSource } from './marque-source';

describe('marqueSource', () => {
  it('R70 (tour de correction 4) : source sans provider_id mais avec source_providers -> logo adzuna', () => {
    // Représente la ligne renvoyée par `SQL_PROVIDER_ID_AFFICHAGE` quand
    // `sources.provider_id` (colonne héritée) est null mais qu'une ligne
    // `source_providers` existe : la requête résout déjà 'adzuna', reste à
    // vérifier que la tuile suit.
    expect(marqueSource('adzuna')).toBe('adzuna');
  });

  it('R70 : source sans rien (ni source_providers, ni config.sourceType, ni colonne héritée) -> lettre', () => {
    expect(marqueSource(null)).toBe('lettre');
  });

  it('reconnaît France Travail à la valeur réelle stockée par le worker (sans underscore)', () => {
    // `source_providers.provider_id` vaut `francetravail` (voir
    // `PROVIDER_ID_REEL` dans `packages/core/src/fonctions/sources.ts`),
    // jamais `france_travail` (vocabulaire d'affichage de l'assistant).
    expect(marqueSource('francetravail')).toBe('francetravail');
  });

  it('reconnaît un type LinkedIn quelconque', () => {
    expect(marqueSource('linkedin_post_engagers')).toBe('linkedin');
  });

  it('replie sur lettre pour une valeur inconnue', () => {
    expect(marqueSource('csv')).toBe('lettre');
  });
});
