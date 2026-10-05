import { describe, expect, it } from 'vitest';
import { comparerInstantsDesc, versInstant } from './temps.js';

describe('versInstant', () => {
  it('convertit une chaîne ISO en epoch ms', () => {
    expect(versInstant('2026-09-10T00:00:00.000Z')).toBe(new Date('2026-09-10T00:00:00.000Z').getTime());
  });

  it('convertit un objet Date (comme le renvoie pg pour un timestamptz) en le même epoch ms', () => {
    const date = new Date('2026-09-10T00:00:00.000Z');
    expect(versInstant(date)).toBe(date.getTime());
  });

  it('une chaîne ISO et un Date représentant le même instant donnent le même epoch ms', () => {
    const iso = '2026-09-10T08:30:00.000Z';
    expect(versInstant(iso)).toBe(versInstant(new Date(iso)));
  });

  it('rend null pour null, undefined, une chaîne invalide ou un Date invalide', () => {
    expect(versInstant(null)).toBeNull();
    expect(versInstant(undefined)).toBeNull();
    expect(versInstant('pas-une-date')).toBeNull();
    expect(versInstant(new Date('pas-une-date'))).toBeNull();
  });
});

describe('comparerInstantsDesc', () => {
  it('place le plus récent en premier (ordre décroissant)', () => {
    const ancien = '2026-09-01T00:00:00.000Z';
    const recent = '2026-09-14T00:00:00.000Z';
    expect(comparerInstantsDesc(recent, ancien)).toBeLessThan(0);
    expect(comparerInstantsDesc(ancien, recent)).toBeGreaterThan(0);
  });

  it('compare correctement un mélange de chaînes et d’objets Date', () => {
    const ancien = new Date('2026-09-01T00:00:00.000Z');
    const recent = '2026-09-14T00:00:00.000Z';
    expect(comparerInstantsDesc(recent, ancien)).toBeLessThan(0);
    expect(comparerInstantsDesc(ancien, recent)).toBeGreaterThan(0);
  });

  it('place null/undefined en dernier, quel que soit le côté', () => {
    const present = '2026-09-14T00:00:00.000Z';
    expect(comparerInstantsDesc(present, null)).toBeLessThan(0);
    expect(comparerInstantsDesc(null, present)).toBeGreaterThan(0);
    expect(comparerInstantsDesc(undefined, present)).toBeGreaterThan(0);
  });

  it('rend 0 pour deux instants égaux (le départage revient à l’appelant)', () => {
    const quand = '2026-09-14T00:00:00.000Z';
    expect(comparerInstantsDesc(quand, new Date(quand))).toBe(0);
  });

  it('rend 0 pour deux absences (deux null)', () => {
    expect(comparerInstantsDesc(null, undefined)).toBe(0);
  });
});
