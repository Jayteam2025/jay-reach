import { describe, expect, it } from 'vitest';
import { parametresScoringTexte, parametresValeurConsommation, pourcentageJauge, tonJauge } from './plafonds-affichage';

// Constat recette du 18/09 : « 300 / 0 » illisible sur Réglages › Plafonds — `placesRestantes`
// (`packages/core/src/plafonds.ts`) le dit sans détour : un plafond nul vaut pause, jamais
// illimité.
describe('parametresValeurConsommation', () => {
  it('plafond positif : réglé, valeurs inchangées', () => {
    expect(parametresValeurConsommation(128, 300)).toEqual({ utilise: 128, plafond: 300, etat: 'regle' });
  });

  it('plafond nul : en pause, même avec une consommation réelle au compteur', () => {
    expect(parametresValeurConsommation(300, 0)).toEqual({ utilise: 300, plafond: 0, etat: 'pause' });
  });

  it('plafond négatif (donnée invalide) : traité comme en pause, comme `placesRestantes`', () => {
    expect(parametresValeurConsommation(0, -1)).toEqual({ utilise: 0, plafond: -1, etat: 'pause' });
  });

  // Revue de cohérence du lot 2 : `senders.daily_quota` est nullable et le moteur lit ce NULL
  // comme « aucune limite » (`quotaSenderRestant` rend Infinity). L'afficher comme une pause
  // faisait dire à l'écran l'inverse de ce que faisait le moteur.
  it('plafond absent : aucune limite réglée, surtout pas une pause', () => {
    expect(parametresValeurConsommation(42, null)).toEqual({ utilise: 42, plafond: 0, etat: 'sansLimite' });
  });
});

// Les trois écrans qui montrent cette jauge (accueil, fiche de campagne, Réglages › Plafonds)
// en avaient chacun leur copie ; seul Réglages traitait le zéro comme une pause. Une seule
// définition, testée ici.
describe('tonJauge', () => {
  it('sous 90 % : normal', () => {
    expect(tonJauge(50, 100)).toBe('normal');
  });

  it('à partir de 90 % : attention', () => {
    expect(tonJauge(90, 100)).toBe('attention');
  });

  it('plafond atteint : erreur', () => {
    expect(tonJauge(100, 100)).toBe('erreur');
  });

  it('en pause avec des envois déjà partis : erreur', () => {
    expect(tonJauge(3, 0)).toBe('erreur');
  });

  it('en pause et rien de parti : normal', () => {
    expect(tonJauge(0, 0)).toBe('normal');
  });

  it('aucune limite réglée : jamais une alerte, quel que soit le compteur', () => {
    expect(tonJauge(10_000, null)).toBe('normal');
  });
});

describe('pourcentageJauge', () => {
  it('proportion arrondie, bornée à 100', () => {
    expect(pourcentageJauge(25, 200)).toBe(13);
    expect(pourcentageJauge(300, 200)).toBe(100);
  });

  it('plafond nul ou absent : barre vide, jamais pleine', () => {
    expect(pourcentageJauge(42, 0)).toBe(0);
    expect(pourcentageJauge(42, null)).toBe(0);
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
