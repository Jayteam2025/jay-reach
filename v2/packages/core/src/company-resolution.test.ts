import { describe, expect, it } from 'vitest';
import {
  normalizeCompanyName,
  resolveCompany,
  type ResolutionLookups,
} from './company-resolution.js';

describe('normalizeCompanyName', () => {
  it('retire accents, casse et suffixe juridique', () => {
    expect(normalizeCompanyName('Éléctricité Générale SAS')).toBe('electricite generale');
    expect(normalizeCompanyName('SARL Boulangerie Müller')).toBe('boulangerie muller');
  });

  it('rapproche une filiale de son groupe après normalisation partielle', () => {
    // « Groupe Vantel » et « Vantel France » se normalisent vers un noyau commun.
    expect(normalizeCompanyName('Groupe Vantel')).toBe('vantel');
    expect(normalizeCompanyName('Vantel France')).toBe('vantel');
  });

  it('gère les sigles et la ponctuation', () => {
    expect(normalizeCompanyName('C.C.E.P.')).toBe('c c e p');
    expect(normalizeCompanyName('AT&T')).toBe('at t');
  });
});

function lookups(over: Partial<ResolutionLookups>): ResolutionLookups {
  return {
    byDomain: async () => null,
    byLegalRegistry: async () => null,
    byTrigram: async () => [],
    ...over,
  };
}

describe('resolveCompany — les 4 passes', () => {
  it('passe 1 : domaine exact', async () => {
    const r = await resolveCompany(
      { name: 'X', domain: 'x.fr' },
      lookups({ byDomain: async () => ({ accountId: 'a1', name: 'X' }) }),
    );
    expect(r).toMatchObject({ status: 'resolved', accountId: 'a1', pass: 'domain' });
  });

  it('passe 2 : annuaire légal → SIREN', async () => {
    const r = await resolveCompany(
      { name: 'Boulangerie Muller', postalCode: '69003' },
      lookups({ byLegalRegistry: async () => ({ accountId: 'a2', siren: '123456789' }) }),
    );
    expect(r).toMatchObject({ status: 'resolved', accountId: 'a2', pass: 'legal_registry', siren: '123456789' });
  });

  it('passe 3 : trigram au-dessus du seuil', async () => {
    const r = await resolveCompany(
      { name: 'Vantel' },
      lookups({ byTrigram: async () => [{ accountId: 'a3', name: 'Vantel', similarity: 0.8 }] }),
    );
    expect(r).toMatchObject({ status: 'resolved', accountId: 'a3', pass: 'trigram' });
  });

  it('trigram sous le seuil → non résolu (pas de faux rattachement / homonymes)', async () => {
    const r = await resolveCompany(
      { name: 'Martin' },
      lookups({ byTrigram: async () => [{ accountId: 'a4', name: 'Martin BTP', similarity: 0.3 }] }),
    );
    expect(r).toMatchObject({ status: 'unresolved', pass: 'unresolved' });
  });

  it('aucune correspondance → arbitrage humain', async () => {
    const r = await resolveCompany({ name: 'Inconnu SARL' }, lookups({}));
    expect(r.status).toBe('unresolved');
  });
});
