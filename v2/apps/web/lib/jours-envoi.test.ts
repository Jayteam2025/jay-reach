import { describe, expect, it } from 'vitest';
import { libelleJoursEnvoi } from './jours-envoi';

/** Traducteur factice : préfixe la clé demandée — vérifie que c'est bien `t()` qui produit le texte, jamais une chaîne française câblée en dur ici. */
const tFaux = (cle: string) => `t:${cle}`;

describe('libelleJoursEnvoi', () => {
  it('compacte lundi à vendredi via la clé weekdays', () => {
    expect(libelleJoursEnvoi([1, 2, 3, 4, 5], tFaux)).toBe('t:weekdays');
  });

  it('compacte les sept jours via la clé everyDay', () => {
    expect(libelleJoursEnvoi([1, 2, 3, 4, 5, 6, 7], tFaux)).toBe('t:everyDay');
  });

  it('liste les autres combinaisons, triées, chaque jour traduit par sa propre clé', () => {
    expect(libelleJoursEnvoi([3, 1], tFaux)).toBe('t:mon, t:wed');
  });

  it('liste un seul jour', () => {
    expect(libelleJoursEnvoi([6], tFaux)).toBe('t:sat');
  });
});
