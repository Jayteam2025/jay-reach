import { describe, it, expect } from 'vitest';
import { looksLikeJobTitleFragment } from './company-name-validator.js';

describe('looksLikeJobTitleFragment — rejette les faux noms d\'entreprise', () => {
  it('rejette les en-têtes de section / bénéfices d\'offre', () => {
    // Cas réel observé au run (offre France Travail anonymisée) :
    expect(looksLikeJobTitleFragment('Rémunération attractive')).toBe(true);
    expect(looksLikeJobTitleFragment('Avantages')).toBe(true);
    expect(looksLikeJobTitleFragment('Salaire selon profil')).toBe(true);
    expect(looksLikeJobTitleFragment('Poste à pourvoir')).toBe(true);
    expect(looksLikeJobTitleFragment('Profil recherché')).toBe(true);
    expect(looksLikeJobTitleFragment('Télétravail partiel')).toBe(true);
  });

  it('rejette les job titles et types de contrat', () => {
    expect(looksLikeJobTitleFragment('KEY ACCOUNT MANAGER H/F Rattaché')).toBe(true);
    expect(looksLikeJobTitleFragment('CDI temps plein - Toulon')).toBe(true);
    expect(looksLikeJobTitleFragment('Directeur commercial')).toBe(true);
    expect(looksLikeJobTitleFragment('Technico-commercial itinérant')).toBe(true);
  });

  it('rejette les fragments de paragraphe d\'offre', () => {
    expect(looksLikeJobTitleFragment('Vos missions Rattaché')).toBe(true);
    expect(looksLikeJobTitleFragment('Notre client')).toBe(true);
    expect(looksLikeJobTitleFragment('Participer aux projets')).toBe(true);
    expect(looksLikeJobTitleFragment('Gestion de Portefeuilles existants')).toBe(true);
  });

  it('rejette les mots isolés stop-words et troncatures', () => {
    expect(looksLikeJobTitleFragment('Elle')).toBe(true);
    expect(looksLikeJobTitleFragment('ANGLAIS')).toBe(true);
    expect(looksLikeJobTitleFragment("Caisse d'Epargne Grand")).toBe(true);
  });

  it('accepte les VRAIS noms d\'entreprise', () => {
    expect(looksLikeJobTitleFragment('Decathlon')).toBe(false);
    expect(looksLikeJobTitleFragment('Areas France')).toBe(false);
    expect(looksLikeJobTitleFragment('STI FRANCE')).toBe(false);
    expect(looksLikeJobTitleFragment('NOVAHE')).toBe(false);
    expect(looksLikeJobTitleFragment('BNP PARIBAS')).toBe(false);
    expect(looksLikeJobTitleFragment('AIR FRANCE')).toBe(false);
    expect(looksLikeJobTitleFragment('Boulangerie Martin')).toBe(false);
    expect(looksLikeJobTitleFragment("L'Oréal")).toBe(false);
  });

  it('gère les entrées vides', () => {
    expect(looksLikeJobTitleFragment('')).toBe(false);
    expect(looksLikeJobTitleFragment(null)).toBe(false);
    expect(looksLikeJobTitleFragment(undefined)).toBe(false);
  });
});
