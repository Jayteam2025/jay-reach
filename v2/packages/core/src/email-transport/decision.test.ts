import { describe, expect, it } from 'vitest';
import { deciderModeEnvoi, relanceTropVieille, sortDErreur } from './decision.js';

describe('deciderModeEnvoi', () => {
  it('aucun envoi antérieur → premier', () => {
    expect(deciderModeEnvoi({ envoisAnterieurs: [] })).toEqual({ mode: 'premier' });
  });

  it('dernier envoi avec Message-ID → relance sur cet id', () => {
    const decision = deciderModeEnvoi({
      envoisAnterieurs: [{ messageId: '<abc@exemple.fr>', objet: 'Premier objet' }],
    });
    expect(decision).toEqual({ mode: 'relance', messageId: '<abc@exemple.fr>' });
  });

  it('dernier envoi sans Message-ID → relance_repli avec objet préfixé Re:', () => {
    const decision = deciderModeEnvoi({
      envoisAnterieurs: [{ messageId: null, objet: 'Premier objet' }],
    });
    expect(decision).toEqual({ mode: 'relance_repli', objet: 'Re: Premier objet' });
  });
});

describe('sortDErreur', () => {
  it('limite → réessayer', () => {
    expect(sortDErreur('limite', 0)).toBe('reessayer');
    expect(sortDErreur('limite', 5)).toBe('reessayer');
  });

  it('client → échouer', () => {
    expect(sortDErreur('client', 0)).toBe('echouer');
  });

  it('serveur → réessayer deux fois puis échouer au troisième', () => {
    expect(sortDErreur('serveur', 0)).toBe('reessayer');
    expect(sortDErreur('serveur', 1)).toBe('reessayer');
    expect(sortDErreur('serveur', 2)).toBe('echouer');
  });

  it('reseau → réessayer deux fois puis échouer au troisième, comme une erreur serveur', () => {
    expect(sortDErreur('reseau', 0)).toBe('reessayer');
    expect(sortDErreur('reseau', 1)).toBe('reessayer');
    expect(sortDErreur('reseau', 2)).toBe('echouer');
  });
});

describe('relanceTropVieille', () => {
  it('relance de 7 h avec délai 6 → trop vieille', () => {
    const planifieMs = 0;
    const maintenantMs = 7 * 60 * 60 * 1000;
    expect(relanceTropVieille(planifieMs, maintenantMs, 6)).toBe(true);
  });

  it('relance de 5 h avec délai 6 → pas trop vieille', () => {
    const planifieMs = 0;
    const maintenantMs = 5 * 60 * 60 * 1000;
    expect(relanceTropVieille(planifieMs, maintenantMs, 6)).toBe(false);
  });
});
