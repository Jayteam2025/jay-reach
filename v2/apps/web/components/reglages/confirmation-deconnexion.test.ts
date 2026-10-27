import { describe, expect, it } from 'vitest';
import { synchroniserConfirmation } from './confirmation-deconnexion';

describe('la confirmation de déconnexion suit la session', () => {
  it('tant que la session ne change pas, la confirmation ouverte reste ouverte', () => {
    const etat = { demandee: true, sessionVue: true };
    expect(synchroniserConfirmation(etat, true)).toBe(etat);
  });

  it('quand la session change, la confirmation ouverte se referme', () => {
    expect(synchroniserConfirmation({ demandee: true, sessionVue: true }, false)).toEqual({
      demandee: false,
      sessionVue: false,
    });
  });

  it('elle ne réapparaît pas toute seule quand une session se rouvre ensuite', () => {
    const fermee = synchroniserConfirmation({ demandee: true, sessionVue: true }, false);
    const apres = synchroniserConfirmation(fermee, true);
    expect(apres.demandee).toBe(false);
  });
});
