import { describe, expect, it } from 'vitest';
import { allocateWithinQuota, requiresSendQuota } from './quota.js';

// Revue F5, point 10 : cette fonction existait déjà (moteur) mais n'était appelée par personne,
// et n'avait donc aucun test — activée pour la projection de la file du jour
// (`projeterEnvoisDuJour`, `packages/core/src/fonctions/campagnes.ts`).
describe('allocateWithinQuota', () => {
  it('borne au plafond journalier restant, le reste est reporté', () => {
    const r = allocateWithinQuota(['a', 'b', 'c'], { dailyQuota: 2, usedToday: 0 });
    expect(r.dispatch).toEqual(['a', 'b']);
    expect(r.deferred).toEqual(['c']);
  });

  it('prend en compte ce qui est déjà utilisé aujourd’hui', () => {
    const r = allocateWithinQuota(['a', 'b', 'c'], { dailyQuota: 2, usedToday: 1 });
    expect(r.dispatch).toEqual(['a']);
    expect(r.deferred).toEqual(['b', 'c']);
  });

  it('un plafond déjà dépassé aujourd’hui reporte tout, jamais un nombre négatif d’éléments', () => {
    const r = allocateWithinQuota(['a', 'b'], { dailyQuota: 2, usedToday: 5 });
    expect(r.dispatch).toEqual([]);
    expect(r.deferred).toEqual(['a', 'b']);
  });

  it('le plafond horaire, s’il est plus contraignant que le journalier, l’emporte', () => {
    const r = allocateWithinQuota(['a', 'b', 'c'], { dailyQuota: 10, usedToday: 0, hourlyQuota: 1, usedThisHour: 0 });
    expect(r.dispatch).toEqual(['a']);
    expect(r.deferred).toEqual(['b', 'c']);
  });

  it('sans plafond horaire réglé, seul le journalier borne', () => {
    const r = allocateWithinQuota(['a', 'b'], { dailyQuota: 5, usedToday: 0 });
    expect(r.dispatch).toEqual(['a', 'b']);
    expect(r.deferred).toEqual([]);
  });

  it('une liste vide ne produit ni dispatch ni report', () => {
    const r = allocateWithinQuota([], { dailyQuota: 5, usedToday: 0 });
    expect(r).toEqual({ dispatch: [], deferred: [] });
  });
});

describe('requiresSendQuota', () => {
  it('un appel téléphonique ne consomme aucun quota d’envoi', () => {
    expect(requiresSendQuota('call')).toBe(false);
  });

  it('email, LinkedIn et courrier consomment tous un quota', () => {
    expect(requiresSendQuota('email')).toBe(true);
    expect(requiresSendQuota('linkedin_message')).toBe(true);
    expect(requiresSendQuota('letter')).toBe(true);
  });
});
