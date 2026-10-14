import { describe, expect, it } from 'vitest';
import { jugerIntitule } from './exclusions.js';

describe('jugerIntitule', () => {
  it('garde tout sans liste', () => {
    expect(jugerIntitule('Directeur commercial', {})).toEqual({ garde: true });
    expect(jugerIntitule('Directeur commercial', { intitulesExclus: [], intitulesObligatoires: [] })).toEqual({ garde: true });
  });

  it('exclut sur un terme, insensible à la casse', () => {
    expect(jugerIntitule('FREELANCE | Commercial B2B', { intitulesExclus: ['freelance'] })).toEqual({
      garde: false,
      motif: 'intitule_exclu',
      terme: 'freelance',
    });
  });

  it('ignore les accents dans les deux sens', () => {
    expect(jugerIntitule('Étudiant en école de commerce', { intitulesExclus: ['etudiant'] }).garde).toBe(false);
    expect(jugerIntitule('Etudiant en école de commerce', { intitulesExclus: ['étudiant'] }).garde).toBe(false);
    expect(jugerIntitule('A l\'écoute du marché', { intitulesExclus: ['à l\'écoute'] }).garde).toBe(false);
  });

  it('renvoie le terme tel qu\'il est dans la liste', () => {
    const v = jugerIntitule('Commercial, indépendant', { intitulesExclus: ['Indépendant'] });
    expect(v).toEqual({ garde: false, motif: 'intitule_exclu', terme: 'Indépendant' });
  });

  it('compare sur sous-chaîne : #OpenToWork est attrapé par « opentowork »', () => {
    expect(jugerIntitule('Sales | #OpenToWork', { intitulesExclus: ['opentowork'] }).garde).toBe(false);
  });

  it('faux positif connu : « consultant » exclut aussi un ancien consultant devenu directeur', () => {
    expect(jugerIntitule('Directeur, ancien consultant', { intitulesExclus: ['consultant'] }).garde).toBe(false);
    // Un terme plus précis épargne ce profil.
    expect(jugerIntitule('Directeur, ancien consultant', { intitulesExclus: ['consultant indépendant'] }).garde).toBe(true);
  });

  it('obligatoires : OU, un seul terme suffit', () => {
    const exclusions = { intitulesObligatoires: ['directeur', 'responsable'] };
    expect(jugerIntitule('Responsable des ventes', exclusions)).toEqual({ garde: true });
    expect(jugerIntitule('Directeur des ventes', exclusions)).toEqual({ garde: true });
    expect(jugerIntitule('Commercial junior', exclusions)).toEqual({
      garde: false,
      motif: 'intitule_non_obligatoire',
      terme: '',
    });
  });

  it('obligatoires : casse et accents ignorés', () => {
    expect(jugerIntitule('DIRECTEUR GÉNÉRAL', { intitulesObligatoires: ['general'] })).toEqual({ garde: true });
  });

  it('les deux listes : obligatoires jugé d\'abord', () => {
    const exclusions = { intitulesObligatoires: ['directeur'], intitulesExclus: ['freelance'] };
    // Ne satisfait pas les obligatoires : le motif est celui-là, même s'il contient un exclu.
    expect(jugerIntitule('Freelance commercial', exclusions)).toEqual({
      garde: false,
      motif: 'intitule_non_obligatoire',
      terme: '',
    });
    // Satisfait les obligatoires mais porte un exclu.
    expect(jugerIntitule('Directeur freelance', exclusions)).toEqual({
      garde: false,
      motif: 'intitule_exclu',
      terme: 'freelance',
    });
    expect(jugerIntitule('Directeur commercial', exclusions)).toEqual({ garde: true });
  });

  it('un intitulé vide ne satisfait jamais les obligatoires', () => {
    expect(jugerIntitule('', { intitulesObligatoires: ['directeur'] })).toEqual({
      garde: false,
      motif: 'intitule_non_obligatoire',
      terme: '',
    });
    expect(jugerIntitule('   ', { intitulesObligatoires: ['directeur'] }).garde).toBe(false);
  });

  it('un intitulé vide n\'est jamais exclu', () => {
    expect(jugerIntitule('', { intitulesExclus: ['freelance', 'étudiant'] })).toEqual({ garde: true });
  });

  it('un terme vide est ignoré dans les exclus (sinon il exclurait tout le monde)', () => {
    expect(jugerIntitule('Directeur commercial', { intitulesExclus: ['', '   '] })).toEqual({ garde: true });
    expect(jugerIntitule('Freelance', { intitulesExclus: ['', 'freelance'] }).garde).toBe(false);
  });

  it('une liste d\'obligatoires faite de termes vides équivaut à une liste vide', () => {
    expect(jugerIntitule('Commercial', { intitulesObligatoires: ['', ' '] })).toEqual({ garde: true });
  });

  it('un terme vide parmi les obligatoires ne fait pas garder tout le monde', () => {
    expect(jugerIntitule('Commercial', { intitulesObligatoires: ['', 'directeur'] }).garde).toBe(false);
  });
});
