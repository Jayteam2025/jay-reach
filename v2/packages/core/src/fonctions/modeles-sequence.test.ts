import { describe, expect, it } from 'vitest';
import { MODELES_SEQUENCE, modeleSequenceParCle } from './modeles-sequence.js';

describe('MODELES_SEQUENCE', () => {
  it('expose exactement deux modèles, tous deux entièrement email', () => {
    expect(MODELES_SEQUENCE).toHaveLength(2);
    for (const modele of MODELES_SEQUENCE) {
      for (const etape of modele.etapes) {
        expect(etape.canal).toBe('email');
        expect(etape.sujet.trim().length).toBeGreaterThan(0);
        expect(etape.corps.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('« Question puis trois relances » : quatre étapes, délais 2, 3, 5 jours depuis l’étape précédente', () => {
    const modele = modeleSequenceParCle('question_relances');
    expect(modele).toBeDefined();
    expect(modele!.etapes).toHaveLength(4);
    expect(modele!.etapes.map((e) => e.delaiHeures)).toEqual([0, 48, 72, 120]);
  });

  it('R64 (tour de correction 2) : la description en jours correspond à la somme des délais, pas un nombre inventé', () => {
    const modele = modeleSequenceParCle('question_relances')!;
    const totalJours = modele.etapes.reduce((somme, e) => somme + e.delaiHeures / 24, 0);
    expect(totalJours).toBe(10);
    expect(modele.description).toContain('10 jours');
    expect(modele.description).not.toContain('12 jours');
  });

  it('« Un seul email » : une seule étape, envoyée immédiatement', () => {
    const modele = modeleSequenceParCle('email_unique');
    expect(modele).toBeDefined();
    expect(modele!.etapes).toHaveLength(1);
    expect(modele!.etapes[0]!.delaiHeures).toBe(0);
  });

  it('modeleSequenceParCle renvoie undefined pour une clé inconnue', () => {
    expect(modeleSequenceParCle('inconnue')).toBeUndefined();
  });

  it('aucun corps ne contient de personne, entreprise ou domaine réels (fictif, neutre)', () => {
    const texteInterdit = /get-jay|jay-assistant|@[a-z0-9.-]+\.(fr|com)|alexandre|declercq|jean-baptiste/i;
    for (const modele of MODELES_SEQUENCE) {
      for (const etape of modele.etapes) {
        expect(etape.sujet).not.toMatch(texteInterdit);
        expect(etape.corps).not.toMatch(texteInterdit);
      }
    }
  });
});
