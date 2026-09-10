import { describe, expect, it } from 'vitest';
import { bornerParCampagne, normaliserPlafond, placesRestantes, reduireLotAuReste } from './plafonds.js';

describe('placesRestantes', () => {
  it('rend le reste quand le plafond est positif', () => {
    expect(placesRestantes(300, 120)).toBe(180);
  });
  it('rend zero quand le plafond est atteint ou depasse', () => {
    expect(placesRestantes(300, 300)).toBe(0);
    expect(placesRestantes(300, 350)).toBe(0);
  });
  it('rend zero quand le plafond vaut zero (pause) ou est invalide', () => {
    expect(placesRestantes(0, 0)).toBe(0);
    expect(placesRestantes(Number.NaN, 0)).toBe(0);
    expect(placesRestantes(-5, 0)).toBe(0);
  });
});

describe('reduireLotAuReste', () => {
  it('garde le lot entier quand le reste suffit', () => {
    expect(reduireLotAuReste(50, 180)).toBe(50);
  });
  it('reduit le lot au reste', () => {
    expect(reduireLotAuReste(50, 7)).toBe(7);
  });
  it('rend zero sans reste', () => {
    expect(reduireLotAuReste(50, 0)).toBe(0);
  });
});

describe('bornerParCampagne', () => {
  const lignes = [
    { campaign_id: 'A', contact_id: '1' },
    { campaign_id: 'A', contact_id: '2' },
    { campaign_id: 'A', contact_id: '3' },
    { campaign_id: 'B', contact_id: '4' },
    { campaign_id: 'C', contact_id: '5' },
  ];
  it('retient au plus les places restantes par campagne, dans l\'ordre', () => {
    const { retenues, reportees } = bornerParCampagne(lignes, new Map([['A', 2], ['B', 0], ['C', null]]));
    expect(retenues.map((l) => l.contact_id)).toEqual(['1', '2', '5']);
    expect([...reportees.entries()]).toEqual([['A', 1], ['B', 1]]);
  });
  it('laisse tout passer pour une campagne sans plafond ou inconnue', () => {
    const { retenues, reportees } = bornerParCampagne(lignes, new Map());
    expect(retenues).toHaveLength(5);
    expect(reportees.size).toBe(0);
  });
});

describe('normaliserPlafond', () => {
  const defaut = 42;
  it('rend le defaut si la valeur est absente', () => {
    expect(normaliserPlafond(null, defaut)).toBe(defaut);
    expect(normaliserPlafond(undefined, defaut)).toBe(defaut);
  });
  it('rend le defaut pour une chaine vide', () => {
    expect(normaliserPlafond('', defaut)).toBe(defaut);
  });
  it('accepte zero (pause voulue)', () => {
    expect(normaliserPlafond('0', defaut)).toBe(0);
  });
  it('accepte un entier positif', () => {
    expect(normaliserPlafond('300', defaut)).toBe(300);
  });
  it('tronque une valeur non entiere', () => {
    expect(normaliserPlafond('300.5', defaut)).toBe(300);
  });
  it('rend le defaut pour une valeur negative', () => {
    expect(normaliserPlafond('-1', defaut)).toBe(defaut);
  });
  it('rend le defaut pour une valeur non numerique', () => {
    expect(normaliserPlafond('abc', defaut)).toBe(defaut);
  });
  it('borne a la valeur max d\'un entier Postgres', () => {
    expect(normaliserPlafond('9999999999', defaut)).toBe(2147483647);
  });
});
