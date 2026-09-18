import { describe, expect, it } from 'vitest';
import { compterPartis } from './file-du-jour';

describe('compterPartis', () => {
  it(
    'F12 : compte le départ RÉEL (`livre`), pas la simple remise au transporteur (`envoye`) — ' +
      'un email remis à SalesBlink mais pas encore envoyé n’est pas « déjà parti »',
    () => {
      const fileDuJour = [
        { livre: true }, // parti (email livré, ou canal sans transporteur asynchrone)
        { livre: false }, // remis, pas encore parti
      ];
      expect(compterPartis(fileDuJour)).toBe(1);
    },
  );

  it('aucun envoi parti : zéro', () => {
    expect(compterPartis([{ livre: false }, { livre: false }])).toBe(0);
  });

  it('file vide : zéro', () => {
    expect(compterPartis([])).toBe(0);
  });
});
