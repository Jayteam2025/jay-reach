import { describe, expect, it } from 'vitest';
import { parametresScoringTexte, parametresValeurConsommation } from './plafonds-affichage';

// Constat recette du 18/09 : « 300 / 0 » illisible sur Réglages › Plafonds — `placesRestantes`
// (`packages/core/src/plafonds.ts`) le dit sans détour : un plafond nul vaut pause, jamais
// illimité.
describe('parametresValeurConsommation', () => {
  it('plafond positif : pas en pause, valeurs inchangées', () => {
    expect(parametresValeurConsommation(128, 300)).toEqual({ utilise: 128, plafond: 300, enPause: 'non' });
  });

  it('plafond nul : en pause, même avec une consommation réelle au compteur', () => {
    expect(parametresValeurConsommation(300, 0)).toEqual({ utilise: 300, plafond: 0, enPause: 'oui' });
  });

  it('plafond négatif (donnée invalide) : traité comme en pause, comme `placesRestantes`', () => {
    expect(parametresValeurConsommation(0, -1)).toEqual({ utilise: 0, plafond: -1, enPause: 'oui' });
  });
});

describe('parametresScoringTexte', () => {
  it('plafond positif : pas en pause', () => {
    expect(parametresScoringTexte(300)).toEqual({ plafond: 300, enPause: 'non' });
  });

  it('plafond nul : en pause — « 0 par jour absorbent une dizaine de passages » n’a plus de sens', () => {
    expect(parametresScoringTexte(0)).toEqual({ plafond: 0, enPause: 'oui' });
  });
});
