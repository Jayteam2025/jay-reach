import { describe, expect, it, vi } from 'vitest';
import type { Executeur } from '../executeur.js';
import { construireValeursContact, lireValeursContact, type LigneValeursContact } from './valeurs-contact.js';

function ligne(overrides: Partial<LigneValeursContact> = {}): LigneValeursContact {
  return {
    first_name: 'Nadia',
    last_name: 'Lemaire',
    job_title: 'Directrice du développement',
    company_name: 'Kairn',
    city: 'Nantes',
    headcount: 40,
    persona_angle: 'gains de temps commercial',
    signal_title: 'A commenté le post du 8 sept.',
    signal_location: 'Nantes',
    signal_url: 'https://exemple.fr/post/1',
    context_note: null,
    domain: 'kairn.example',
    postal_code: '44000',
    country: 'France',
    signal_occurred_at: '2026-09-08T10:00:00.000Z',
    ...overrides,
  };
}

describe('construireValeursContact', () => {
  it('assemble les valeurs standard depuis la ligne', () => {
    const v = construireValeursContact(ligne());
    expect(v).toMatchObject({
      prenom: 'Nadia',
      salutation: 'Bonjour Nadia',
      nom: 'Lemaire',
      poste: 'Directrice du développement',
      entreprise: 'Kairn',
      ville: 'Nantes',
      effectif: '40',
      persona_angle: 'gains de temps commercial',
      signal_titre: 'A commenté le post du 8 sept.',
      signal_zone: 'Nantes',
      lien_offre: 'https://exemple.fr/post/1',
      site: 'kairn.example',
      departement: '44',
      pays: 'France',
    });
  });

  it('salue sans prénom, sans jamais remonter de repli sur `prenom`', () => {
    const v = construireValeursContact(ligne({ first_name: null }));
    expect(v.salutation).toBe('Bonjour');
    expect(v.prenom).toBeUndefined();
  });

  it('calcule signal_date et signal_mois depuis signal_occurred_at', () => {
    const v = construireValeursContact(ligne());
    expect(v.signal_date).toBe(new Date('2026-09-08T10:00:00.000Z').toLocaleDateString('fr-FR'));
    expect(v.signal_mois).toBe(new Date('2026-09-08T10:00:00.000Z').toLocaleDateString('fr-FR', { month: 'long' }));
  });

  it('les extraits complètent sans écraser une valeur déjà connue', () => {
    const extraits = new Map([
      ['signature', 'Alexandre'],
      ['prenom', 'FANTOME'],
    ]);
    const v = construireValeursContact(ligne(), extraits);
    expect(v.signature).toBe('Alexandre');
    expect(v.prenom).toBe('Nadia');
  });

  it('sans code postal, departement reste indéfini', () => {
    expect(construireValeursContact(ligne({ postal_code: null })).departement).toBeUndefined();
  });
});

describe('lireValeursContact', () => {
  function faux(rows: Record<string, unknown[]>): Executeur {
    const query = vi.fn(async (sql: string) => {
      for (const [motif, r] of Object.entries(rows)) {
        if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
      }
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    return { query };
  }

  it('renvoie `null` quand le contact est introuvable', async () => {
    const ex = faux({ 'jr:valeurs_contact\\b': [] });
    await expect(lireValeursContact(ex, 'org-1', 'contact-1')).resolves.toBeNull();
  });

  it('assemble les valeurs, le nom et l’email à partir de la ligne lue', async () => {
    const ex = faux({
      'jr:valeurs_contact\\b': [
        {
          first_name: 'Nadia',
          last_name: 'Lemaire',
          job_title: 'Directrice du développement',
          email: 'n.lemaire@kairn.example',
          locale: 'fr',
          company_name: 'Kairn',
          domain: 'kairn.example',
          city: 'Nantes',
          headcount: 40,
          postal_code: '44000',
          country: 'France',
          persona_angle: null,
          signal_title: null,
          signal_location: null,
          signal_url: null,
          signal_occurred_at: null,
          context_note: null,
        },
      ],
      'jr:valeurs_contact_extraits': [{ name: 'signature', body: 'Alexandre' }],
    });
    const r = await lireValeursContact(ex, 'org-1', 'contact-1', 'camp-1');
    expect(r).not.toBeNull();
    expect(r?.nom).toBe('Nadia Lemaire');
    expect(r?.email).toBe('n.lemaire@kairn.example');
    expect(r?.locale).toBe('fr');
    expect(r?.valeurs.prenom).toBe('Nadia');
    expect(r?.valeurs.signature).toBe('Alexandre');
  });

  it('passe `campagneId` en troisième paramètre de la requête (null par défaut)', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 })) as unknown as Executeur['query'];
    const ex: Executeur = { query };
    await lireValeursContact(ex, 'org-1', 'contact-1');
    const appel = (query as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(appel[1]).toEqual(['contact-1', 'org-1', null]);
  });
});
