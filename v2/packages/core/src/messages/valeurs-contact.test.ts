import { describe, expect, it, vi, afterEach } from 'vitest';
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

describe('construireValeursContact — colonnes du CSV importé (liste_*)', () => {
  it('ajoute liste_<colonne normalisée> pour chaque clé non vide de raw_row', () => {
    const v = construireValeursContact(
      ligne({ raw_row: { 'Intitulé Poste': 'Commercial terrain', vide: '', nb: 3 } }),
    );
    expect(v.liste_intitule_poste).toBe('Commercial terrain');
    expect(v.liste_nb).toBe('3');
    expect(v.liste_vide).toBeUndefined();
  });

  it('ignore une valeur nulle ou faite uniquement d’espaces', () => {
    const v = construireValeursContact(ligne({ raw_row: { blanc: '   ', nulle: null } }));
    expect(v.liste_blanc).toBeUndefined();
    expect(v.liste_nulle).toBeUndefined();
  });

  it('ne pose aucune clé liste_ quand raw_row est nul ou absent (pas de repli sur une autre liste)', () => {
    expect(Object.keys(construireValeursContact(ligne({ raw_row: null }))).some((k) => k.startsWith('liste_'))).toBe(
      false,
    );
    expect(Object.keys(construireValeursContact(ligne())).some((k) => k.startsWith('liste_'))).toBe(false);
  });

  it('ignore une colonne qui normalise vers une clé vide', () => {
    const v = construireValeursContact(ligne({ raw_row: { '???': 'valeur', poste: 'CTO' } }));
    expect(v.liste_poste).toBe('CTO');
    expect(Object.keys(v)).not.toContain('liste_');
  });

  it('coupe les espaces de tête et de queue de la valeur', () => {
    expect(construireValeursContact(ligne({ raw_row: { ville: '  Nantes  ' } })).liste_ville).toBe('Nantes');
  });

  it('ignore un objet ou un tableau plutôt que de poser "[object Object]"', () => {
    const v = construireValeursContact(ligne({ raw_row: { meta: { a: 1 }, tags: ['a', 'b'], poste: 'CTO' } }));
    expect(v.liste_meta).toBeUndefined();
    expect(v.liste_tags).toBeUndefined();
    expect(v.liste_poste).toBe('CTO');
  });

  it('accepte number et boolean, convertis en texte', () => {
    const v = construireValeursContact(ligne({ raw_row: { nb: 3, actif: true } }));
    expect(v.liste_nb).toBe('3');
    expect(v.liste_actif).toBe('true');
  });
});

describe('construireValeursContact — colonnes homonymes après normalisation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('valeurs différentes : la variable reste absente (manquante → bloque l’envoi) et un avertissement est journalisé', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = construireValeursContact(ligne({ raw_row: { Poste: 'Commercial', POSTE: 'Directeur' } }));
    expect(v.liste_poste).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('liste_poste'));
    expect(warn.mock.calls[0]?.[0]).not.toContain('Commercial');
    expect(warn.mock.calls[0]?.[0]).not.toContain('Directeur');
  });

  it('valeurs identiques : une seule variable posée, aucun avertissement', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = construireValeursContact(ligne({ raw_row: { Ville: 'Nantes', VILLE: 'Nantes' } }));
    expect(v.liste_ville).toBe('Nantes');
    expect(warn).not.toHaveBeenCalled();
  });

  it('une seule des deux clés homonymes porte une valeur : pas une collision, la valeur est posée', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = construireValeursContact(ligne({ raw_row: { Poste: 'Commercial', POSTE: '' } }));
    expect(v.liste_poste).toBe('Commercial');
    expect(warn).not.toHaveBeenCalled();
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

  // Point de cohérence transversale (fusion de main) : l'aperçu avant envoi
  // (apercuEnvoi) ne doit jamais diverger de l'email réellement envoyé par le
  // worker — un contact inscrit via une liste importée voit ses colonnes
  // liste_<colonne> résolues dans l'aperçu, un contact sans liste les voit
  // manquantes (aucun repli).
  it('résout liste_<colonne> depuis raw_row pour un contact inscrit via une liste importée', async () => {
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
          raw_row: { 'Intitulé Poste': 'Commercial terrain' },
        },
      ],
      'jr:valeurs_contact_extraits': [],
    });
    const r = await lireValeursContact(ex, 'org-1', 'contact-1', 'camp-1');
    expect(r?.valeurs.liste_intitule_poste).toBe('Commercial terrain');
  });

  it('laisse liste_<colonne> manquant pour un contact sans liste (raw_row nul, pas de repli)', async () => {
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
          raw_row: null,
        },
      ],
      'jr:valeurs_contact_extraits': [],
    });
    const r = await lireValeursContact(ex, 'org-1', 'contact-1', 'camp-1');
    expect(Object.keys(r?.valeurs ?? {}).some((k) => k.startsWith('liste_'))).toBe(false);
  });
});
