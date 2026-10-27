import { describe, expect, it } from 'vitest';
import { ENTREES_NAV_REGLAGES } from './nav-reglages';

describe('l’ordre des onglets de Réglages', () => {
  it('suit l’ordre de mise en route : canaux, destinataires, messages, limites, services, moteur, compte', () => {
    expect(ENTREES_NAV_REGLAGES.map((e) => e.cle)).toEqual([
      'linkedin',
      'senders',
      'personas',
      'messages',
      'limits',
      'providers',
      'engine',
      'account',
    ]);
  });

  it('chaque entrée mène à sa page', () => {
    for (const entree of ENTREES_NAV_REGLAGES) {
      expect(entree.href).toBe(`/settings/${entree.cle}`);
    }
  });
});
