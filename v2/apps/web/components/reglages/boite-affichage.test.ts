import { describe, expect, it } from 'vitest';
import { puceEtatBoite } from './boite-affichage';

describe('puceEtatBoite', () => {
  it('boîte non reliée à SalesBlink : priorité absolue, même active', () => {
    expect(puceEtatBoite({ active: true, sante: { etat: 'sans_objet' } })).toEqual({ ton: 'gris', cle: 'notLinked' });
  });

  it('santé indisponible (délai dépassé ou erreur) prime sur l’activation', () => {
    expect(puceEtatBoite({ active: true, sante: { etat: 'indisponible' } })).toEqual({
      ton: 'attention',
      cle: 'healthUnavailable',
    });
  });

  it('santé connue mais déconnectée', () => {
    expect(puceEtatBoite({ active: true, sante: { etat: 'connue', connectee: false, score: null } })).toEqual({
      ton: 'attention',
      cle: 'disconnected',
    });
  });

  it('active et connectée', () => {
    expect(puceEtatBoite({ active: true, sante: { etat: 'connue', connectee: true, score: 90 } })).toEqual({
      ton: 'bon',
      cle: 'active',
    });
  });

  it('inactive et connectée : l’activation prime (aucun blocage technique)', () => {
    expect(puceEtatBoite({ active: false, sante: { etat: 'connue', connectee: true, score: 90 } })).toEqual({
      ton: 'gris',
      cle: 'inactive',
    });
  });
});
