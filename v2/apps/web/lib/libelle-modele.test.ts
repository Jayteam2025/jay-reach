import { describe, expect, it } from 'vitest';
import { SCORING_MODELS } from '@jay-reach/core';
import { libelleModele } from './libelle-modele';

describe('libelleModele', () => {
  it('rend les deux modèles par défaut du moteur en noms lisibles', () => {
    // Lus de la constante du cœur : si le défaut change, ce test dit ce que l'écran affichera.
    expect(libelleModele(SCORING_MODELS.smart)).toBe('Claude Sonnet 5');
    expect(libelleModele(SCORING_MODELS.fast)).toBe('Claude Haiku 4.5');
  });

  it('retire la date de publication et pose la version avec un point', () => {
    expect(libelleModele('claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5');
    expect(libelleModele('claude-haiku-4-20251001')).toBe('Claude Haiku 4');
    expect(libelleModele('claude-opus-5')).toBe('Claude Opus 5');
  });

  it('lit aussi l’ancienne forme, version devant la famille', () => {
    expect(libelleModele('claude-3-5-sonnet-20241022')).toBe('Claude Sonnet 3.5');
    expect(libelleModele('claude-3-opus-20240229')).toBe('Claude Opus 3');
  });

  it('garde tel quel un identifiant qui n’est pas un modèle Claude connu', () => {
    expect(libelleModele('gpt-5')).toBe('gpt-5');
    expect(libelleModele('claude-mon-modele-maison')).toBe('claude-mon-modele-maison');
    expect(libelleModele('  claude-sonnet-5  ')).toBe('Claude Sonnet 5');
  });
});
