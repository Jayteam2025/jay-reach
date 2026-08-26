import { describe, expect, it } from 'vitest';
import { isProspectingOpposition } from './insee-sirene.js';

describe('opposition au démarchage (statut de diffusion Sirene)', () => {
  it("'O' (ou 'diffusible') → pas d'opposition", () => {
    expect(isProspectingOpposition('O')).toBe(false);
    expect(isProspectingOpposition('o')).toBe(false);
    expect(isProspectingOpposition('diffusible')).toBe(false);
  });

  it("toute autre valeur → opposition (P, protected, N…)", () => {
    expect(isProspectingOpposition('P')).toBe(true);
    expect(isProspectingOpposition('protected')).toBe(true);
    expect(isProspectingOpposition('N')).toBe(true);
    expect(isProspectingOpposition('partiellement diffusible')).toBe(true);
  });

  it("absence de statut → pas d'opposition (on ne bloque pas sur l'inconnu)", () => {
    expect(isProspectingOpposition(null)).toBe(false);
    expect(isProspectingOpposition(undefined)).toBe(false);
    expect(isProspectingOpposition('')).toBe(false);
  });
});
