import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurEntree, ErreurIntrouvable } from './contexte.js';
import {
  ajouterDepuisAnnuaire,
  ajouterDepuisListe,
  activerSource,
  configFormulaireDepuisStockee,
  construireConfigStocke,
  creerSource,
  importerCsv,
  lancerPassage,
  listerListesOrganisation,
  listerSourcesCampagne,
  modifierSource,
  sirensConnus,
  type ConfigAdzuna,
  type ConfigFranceTravail,
} from './sources.js';

/**
 * Contexte factice : même convention que `campagnes.test.ts`/`plafonds.test.ts` —
 * `rows` associe un motif (le tag `/* jr:nom *\/` de la requête) au résultat
 * renvoyé par `query`. `appels` conserve `[sql, values]` de chaque appel, pour
 * vérifier l'ordre des écritures et les valeurs passées (ex. le `provider_id`
 * réel écrit dans `source_providers`).
 */
function faux(rows: Record<string, unknown[]>, role: Contexte['role'] = 'operator') {
  const appels: Array<[string, unknown[] | undefined]> = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    appels.push([sql, values]);
    for (const [motif, r] of Object.entries(rows)) {
      if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    }
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role };
  return { ctx, appels };
}

const CAMPAGNE_ID = '11111111-1111-1111-1111-111111111111';
const SOURCE_ID = '33333333-3333-3333-3333-333333333333';

describe('listerSourcesCampagne', () => {
  it('refuse un rôle insuffisant', async () => {
    const { ctx } = faux({}, null);
    await expect(listerSourcesCampagne(ctx, { campagneId: CAMPAGNE_ID })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('retourne un tableau vide sans requérir de deuxième requête', async () => {
    const { ctx, appels } = faux({ 'jr:sources_lister': [] }, 'viewer');
    const r = await listerSourcesCampagne(ctx, { campagneId: CAMPAGNE_ID });
    expect(r).toEqual([]);
    expect(appels).toHaveLength(1);
  });

  it('mappe une source adzuna (source_providers rattaché) et lit le dernier passage dans source_runs', async () => {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const { ctx } = faux(
      {
        'jr:sources_lister': [
          {
            id: 'src-1',
            name: 'Adzuna · Test',
            config: {
              sourceType: 'adzuna',
              motsCles: ['directeur commercial'],
              lieux: [],
              keywords: ['directeur commercial'],
            },
            is_active: true,
            schedule: 'every 6h',
          },
        ],
        'jr:sources_dernier_passage': [
          {
            source_id: 'src-1',
            started_at: '2026-09-10T09:00:00.000Z',
            items_found: 58,
            items_new: 6,
          },
        ],
        'jr:sources_retenus_7j': [{ source_id: 'src-1', jour: aujourdhui, n: 6 }],
        'jr:sources_providers_rattaches': [{ source_id: 'src-1', provider_id: 'adzuna' }],
      },
      'viewer',
    );
    const [carte] = await listerSourcesCampagne(ctx, { campagneId: CAMPAGNE_ID });
    expect(carte).toBeDefined();
    expect(carte!.providerId).toBe('adzuna');
    expect(carte!.collecteDisponible).toBe(true);
    expect(carte!.dernierPassage).toEqual({
      quand: '2026-09-10T09:00:00.000Z',
      lus: 58,
      retenus: 6,
      ignores: 52,
    });
    expect(carte!.retenus7j).toHaveLength(7);
    expect(carte!.retenus7j[6]).toBe(6);
  });

  it('une source linkedin_* sans source_providers reste identifiable par `config.sourceType`, collecte indisponible', async () => {
    const { ctx } = faux(
      {
        'jr:sources_lister': [
          {
            id: 'src-2',
            name: 'LinkedIn · Engageurs',
            config: {
              sourceType: 'linkedin_post_engagers',
              urlPost: 'https://exemple.fr/post',
              garder: ['commente'],
            },
            is_active: true,
            schedule: 'every 24h',
          },
        ],
        'jr:sources_dernier_passage': [],
        'jr:sources_retenus_7j': [],
        'jr:sources_providers_rattaches': [],
      },
      'viewer',
    );
    const [carte] = await listerSourcesCampagne(ctx, { campagneId: CAMPAGNE_ID });
    expect(carte!.providerId).toBe('linkedin_post_engagers');
    expect(carte!.collecteDisponible).toBe(false);
    expect(carte!.dernierPassage).toBeNull();
    expect(carte!.prochainPassage).toBeNull();
  });

  it('une source rattachée à plusieurs fournisseurs (thème hérité, R30) ne produit qu’UNE carte', async () => {
    // Reproduit « France Travail » de la campagne « Directeur commercial »
    // sur la base OSS (vérifié le 15/09) : un thème créé avant ce lot, rattaché
    // à la fois à `adzuna` et `francetravail`. Sans agrégation dédiée, la
    // jointure aurait produit deux lignes pour le même `id`.
    const { ctx } = faux(
      {
        'jr:sources_lister': [
          {
            id: 'src-3',
            name: 'France Travail',
            config: { keywords: ['commercial'] },
            is_active: true,
            schedule: 'daily',
          },
        ],
        'jr:sources_dernier_passage': [],
        'jr:sources_retenus_7j': [],
        'jr:sources_providers_rattaches': [
          { source_id: 'src-3', provider_id: 'adzuna' },
          { source_id: 'src-3', provider_id: 'francetravail' },
        ],
      },
      'viewer',
    );
    const cartes = await listerSourcesCampagne(ctx, { campagneId: CAMPAGNE_ID });
    expect(cartes).toHaveLength(1);
    // R44 (tour de correction 2) : le principal est celui dont le libellé
    // apparaît dans le NOM de la source (« France Travail »), pas le premier
    // alphabétique (« adzuna ») — c'est exactement le bug constaté en
    // recette : la carte « France Travail » portait la tuile Adzuna.
    expect(cartes[0]!.providerId).toBe('france_travail');
    expect(cartes[0]!.providerIds).toEqual(['france_travail', 'adzuna']);
  });

  it('résume tous les passages (pas seulement le dernier) pour la puce d’en-tête du tiroir', async () => {
    const { ctx } = faux(
      {
        'jr:sources_lister': [
          {
            id: 'src-4',
            name: 'Adzuna',
            config: { keywords: ['commercial'] },
            is_active: true,
            schedule: 'every 6h',
          },
        ],
        'jr:sources_dernier_passage': [
          { source_id: 'src-4', started_at: '2026-09-15T09:00:00.000Z', items_found: 58, items_new: 6 },
        ],
        'jr:sources_resume_passages': [
          { source_id: 'src-4', total: 312, premier: '2026-09-10T08:00:00.000Z' },
        ],
        'jr:sources_retenus_7j': [],
        'jr:sources_providers_rattaches': [{ source_id: 'src-4', provider_id: 'adzuna' }],
      },
      'viewer',
    );
    const [carte] = await listerSourcesCampagne(ctx, { campagneId: CAMPAGNE_ID });
    expect(carte!.totalLu).toBe(312);
    expect(carte!.premierPassage).toBe('2026-09-10T08:00:00.000Z');
  });

  it('sans aucun passage, totalLu est nul et premierPassage est null', async () => {
    const { ctx } = faux(
      {
        'jr:sources_lister': [
          {
            id: 'src-5',
            name: 'Adzuna',
            config: { keywords: ['commercial'] },
            is_active: true,
            schedule: 'every 6h',
          },
        ],
        'jr:sources_dernier_passage': [],
        'jr:sources_resume_passages': [],
        'jr:sources_retenus_7j': [],
        'jr:sources_providers_rattaches': [{ source_id: 'src-5', provider_id: 'adzuna' }],
      },
      'viewer',
    );
    const [carte] = await listerSourcesCampagne(ctx, { campagneId: CAMPAGNE_ID });
    expect(carte!.totalLu).toBe(0);
    expect(carte!.premierPassage).toBeNull();
  });
});

describe('configFormulaireDepuisStockee', () => {
  const FORM_ADZUNA: ConfigAdzuna = {
    motsCles: ['directeur commercial', 'head of sales'],
    lieux: ['Île-de-France', 'Lyon'],
    contrat: 'cdi',
    taille: '10 à 250 salariés',
    exclusions: ['cabinet de recrutement', 'intérim'],
    ageMaxJours: 14,
  };
  const FORM_FRANCE_TRAVAIL: ConfigFranceTravail = {
    motsCles: ['chef des ventes'],
    lieux: [],
    typeContrat: 'tous',
    departement: '69',
    exclusions: [],
  };

  it('aller-retour exact via construireConfigStocke, pour Adzuna', () => {
    const stocke = construireConfigStocke('adzuna', FORM_ADZUNA);
    expect(configFormulaireDepuisStockee('adzuna', stocke)).toEqual(FORM_ADZUNA);
  });

  it('aller-retour exact via construireConfigStocke, pour France Travail (lieux vides → pas de `location`)', () => {
    const stocke = construireConfigStocke('france_travail', FORM_FRANCE_TRAVAIL);
    expect(stocke.location).toBeUndefined();
    expect(configFormulaireDepuisStockee('france_travail', stocke)).toEqual(FORM_FRANCE_TRAVAIL);
  });

  it('lit une config réelle migrée avant ce lot (clés du worker uniquement, R30/R43)', () => {
    // Config exacte du thème « France Travail » de la campagne « Directeur
    // commercial » sur la base OSS (constat du tour de correction 2) : aucune
    // des clés du formulaire n'existe, seulement celles du worker.
    const configReelle = {
      keywords: ['commercial', 'sales'],
      location: 'Île-de-France, Lyon',
      exclude_keywords: ['stagiaire'],
      scoring_prompt: 'Instructions détaillées…',
      match_threshold: 60,
    };
    const f = configFormulaireDepuisStockee('france_travail', configReelle) as ConfigFranceTravail;
    expect(f.motsCles).toEqual(['commercial', 'sales']);
    expect(f.lieux).toEqual(['Île-de-France', 'Lyon']);
    expect(f.exclusions).toEqual(['stagiaire']);
    // Clés inconnues du formulaire : ignorées à la lecture, jamais recopiées
    // dans `ConfigFormulaire` (mais préservées à l'écriture par `modifierSource`).
    expect((f as Record<string, unknown>).scoring_prompt).toBeUndefined();
    expect((f as Record<string, unknown>).match_threshold).toBeUndefined();
  });

  it('sans aucune donnée, retourne des valeurs par défaut plutôt que de planter', () => {
    const f = configFormulaireDepuisStockee('adzuna', {}) as ConfigAdzuna;
    expect(f.motsCles).toEqual([]);
    expect(f.lieux).toEqual([]);
    expect(f.contrat).toBe('tous');
    expect(f.exclusions).toEqual([]);
  });
});

describe('creerSource', () => {
  const entreeAdzuna = {
    campagneId: CAMPAGNE_ID,
    providerId: 'adzuna' as const,
    nom: 'Adzuna · Test',
    config: { motsCles: ['directeur commercial'], lieux: ['Lyon'] },
  };

  it('refuse un rôle insuffisant', async () => {
    const { ctx } = faux({}, 'viewer');
    await expect(creerSource(ctx, entreeAdzuna)).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable quand la campagne n’existe pas', async () => {
    const { ctx } = faux({ 'jr:sources_campagne': [] });
    await expect(creerSource(ctx, entreeAdzuna)).rejects.toThrow(ErreurIntrouvable);
  });

  it('refuse csv/list/directory (pas de veille persistante pour ces types)', async () => {
    const { ctx, appels } = faux({ 'jr:sources_campagne': [{ id: 'camp-1' }] });
    await expect(creerSource(ctx, { ...entreeAdzuna, providerId: 'csv' })).rejects.toThrow(
      ErreurEntree,
    );
    expect(appels).toHaveLength(0);
  });

  it('rejette une config incomplète (motsCles manquants) avant toute écriture', async () => {
    const { ctx, appels } = faux({ 'jr:sources_campagne': [{ id: 'camp-1' }] });
    await expect(creerSource(ctx, { ...entreeAdzuna, config: {} })).rejects.toThrow(ErreurEntree);
    expect(appels.filter(([sql]) => /insert into sources/i.test(sql))).toHaveLength(0);
  });

  it('écrit `sources` puis `campaign_sources` puis `source_providers` (adzuna, provider_id réel sans underscore pour France Travail)', async () => {
    const { ctx, appels } = faux({
      'jr:sources_campagne': [{ id: 'camp-1' }],
      'jr:sources_creer': [{ id: 'src-1' }],
    });
    const { id } = await creerSource(ctx, {
      ...entreeAdzuna,
      providerId: 'france_travail',
      config: { motsCles: ['chef des ventes'] },
    });
    expect(id).toBe('src-1');

    const motifs = appels.map(([sql]) => sql);
    const iSources = motifs.findIndex((s) => /insert into sources/i.test(s));
    const iCampaignSources = motifs.findIndex((s) => /insert into campaign_sources/i.test(s));
    const iProviders = motifs.findIndex((s) => /insert into source_providers/i.test(s));
    expect(iSources).toBeGreaterThanOrEqual(0);
    expect(iCampaignSources).toBeGreaterThan(iSources);
    expect(iProviders).toBeGreaterThan(iCampaignSources);

    // Le `provider_id` réellement écrit est celui que le worker route
    // (`francetravail`, apps/worker/src/handlers/discover.ts), pas le type
    // d'affichage `france_travail`.
    const [, valeursProviders] = appels[iProviders]!;
    expect(valeursProviders).toContain('francetravail');
  });

  it('ne crée aucun `source_providers` pour un type linkedin_* (collecte indisponible avant le lot 4)', async () => {
    const { ctx, appels } = faux({
      'jr:sources_campagne': [{ id: 'camp-1' }],
      'jr:sources_creer': [{ id: 'src-1' }],
    });
    await creerSource(ctx, {
      campagneId: CAMPAGNE_ID,
      providerId: 'linkedin_post_engagers',
      nom: 'LinkedIn · Engageurs',
      config: { urlPost: 'https://exemple.fr/post', garder: ['commente'], compteId: 'compte-1' },
    });
    expect(appels.some(([sql]) => /insert into source_providers/i.test(sql))).toBe(false);
  });
});

describe('modifierSource', () => {
  it('refuse un rôle insuffisant', async () => {
    const { ctx } = faux({}, 'viewer');
    await expect(
      modifierSource(ctx, { sourceId: SOURCE_ID, nom: 'X', config: {}, schedule: 'every 6h' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable quand la source n’existe pas', async () => {
    const { ctx } = faux({ 'jr:sources_lire_pour_modifier': [] });
    await expect(
      modifierSource(ctx, { sourceId: SOURCE_ID, nom: 'X', config: {}, schedule: 'every 6h' }),
    ).rejects.toThrow(ErreurIntrouvable);
  });

  it('valide la config contre le schéma du type déjà stocké', async () => {
    const { ctx, appels } = faux({
      'jr:sources_lire_pour_modifier': [{ config: { sourceType: 'adzuna', motsCles: ['x'] } }],
      'jr:sources_modifier': [{}],
    });
    await modifierSource(ctx, {
      sourceId: SOURCE_ID,
      nom: 'Adzuna renommé',
      config: { motsCles: ['head of sales'], lieux: [] },
      schedule: 'every 12h',
    });
    expect(
      appels.some(([sql]) => /update sources/i.test(sql) && !/source_providers/i.test(sql)),
    ).toBe(true);
  });

  it('résout le type via source_providers pour une source héritée sans config.sourceType, et préserve ses clés inconnues (R30)', async () => {
    // Reproduit « France Travail » de la campagne « Directeur commercial »
    // sur la base OSS (vérifié le 15/09) : config sans `sourceType`,
    // `scoring_prompt`/`match_threshold` posés par un autre chantier.
    const { ctx, appels } = faux({
      'jr:sources_lire_pour_modifier': [
        {
          config: {
            keywords: ['commercial'],
            scoring_prompt: 'Instructions détaillées…',
            match_threshold: 60,
          },
        },
      ],
      'jr:sources_provider_pour_modifier': [{ provider_id: 'francetravail' }],
      'jr:sources_modifier': [{}],
    });
    await modifierSource(ctx, {
      sourceId: SOURCE_ID,
      nom: 'France Travail',
      config: { motsCles: ['commercial', 'sales'], lieux: [] },
      schedule: 'daily',
    });
    const appelUpdate = appels.find(
      ([sql]) => /update sources\b/i.test(sql) && !/source_providers/i.test(sql),
    );
    expect(appelUpdate).toBeDefined();
    const configEcrite = JSON.parse(appelUpdate![1]![2] as string) as Record<string, unknown>;
    // Champs gérés par ce formulaire : mis à jour.
    expect(configEcrite.keywords).toEqual(['commercial', 'sales']);
    // Champs hérités, hors du formulaire : jamais perdus.
    expect(configEcrite.scoring_prompt).toBe('Instructions détaillées…');
    expect(configEcrite.match_threshold).toBe(60);
  });
});

describe('activerSource', () => {
  it('lève ErreurIntrouvable quand la source n’existe pas, sans toucher source_providers', async () => {
    const { ctx, appels } = faux({});
    await expect(activerSource(ctx, { sourceId: SOURCE_ID, active: false })).rejects.toThrow(
      ErreurIntrouvable,
    );
    expect(appels.some(([sql]) => /update source_providers/i.test(sql))).toBe(false);
  });

  it('répercute is_active sur `sources` ET `source_providers`', async () => {
    const { ctx, appels } = faux({ 'jr:sources_activer': [{}] });
    await activerSource(ctx, { sourceId: SOURCE_ID, active: false });
    expect(appels.some(([sql]) => /update sources\b/i.test(sql) && /is_active/.test(sql))).toBe(
      true,
    );
    expect(appels.some(([sql]) => /update source_providers/i.test(sql))).toBe(true);
  });
});

describe('lancerPassage', () => {
  it('refuse une source inactive (ou hors organisation)', async () => {
    const { ctx } = faux({});
    await expect(lancerPassage(ctx, { sourceId: SOURCE_ID })).rejects.toThrow(ErreurIntrouvable);
  });

  it('pose run_requested_at sur une source active', async () => {
    const { ctx, appels } = faux({ 'jr:sources_lancer_passage': [{}] });
    await lancerPassage(ctx, { sourceId: SOURCE_ID });
    expect(appels.some(([sql]) => /run_requested_at\s*=\s*now\(\)/i.test(sql))).toBe(true);
  });
});

describe('importerCsv', () => {
  const base = {
    campagneId: CAMPAGNE_ID,
    nom: 'Import · Test',
    fileName: 'test.csv',
    mapping: { Prenom: 'first_name', Nom: 'last_name', Email: 'email' },
  };

  it('refuse un rôle insuffisant', async () => {
    const { ctx } = faux({}, 'viewer');
    await expect(importerCsv(ctx, { ...base, parsed: { headers: [], rows: [] } })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('lève ErreurIntrouvable quand la campagne n’existe pas', async () => {
    const { ctx } = faux({ 'jr:sources_campagne': [] });
    await expect(importerCsv(ctx, { ...base, parsed: { headers: [], rows: [] } })).rejects.toThrow(
      ErreurIntrouvable,
    );
  });

  it('compte les contacts nouveaux/déjà connus/sans email valide', async () => {
    const { ctx } = faux({
      'jr:sources_campagne': [{ id: 'camp-1' }],
      'jr:sources_csv_liste': [{ id: 'list-1' }],
      'jr:sources_csv_contact_email': [{ id: 'contact-1', inserted: true }],
      'jr:sources_csv_contact_sans_email': [{ id: 'contact-2' }],
    });
    const r = await importerCsv(ctx, {
      ...base,
      parsed: {
        headers: ['Prenom', 'Nom', 'Email'],
        rows: [
          { Prenom: 'Camille', Nom: 'Marchal', Email: 'camille@exemple.fr' },
          { Prenom: 'Theo', Nom: 'Lambert', Email: '' },
        ],
      },
    });
    expect(r).toEqual({ lignesLues: 2, contactsNouveaux: 2, dejaConnus: 0, sansEmailValide: 1 });
  });
});

describe('ajouterDepuisAnnuaire', () => {
  const entree = {
    campagneId: CAMPAGNE_ID,
    entreprises: [
      { siren: '111111111', name: 'Nordwave', naf: '62.01Z', city: 'Lyon', postalCode: '69000' },
      {
        siren: '222222222',
        name: 'Kairn',
        naf: '62.01Z',
        city: 'Villeurbanne',
        postalCode: '69100',
      },
    ],
  };

  it('refuse un rôle insuffisant', async () => {
    const { ctx } = faux({}, 'viewer');
    await expect(ajouterDepuisAnnuaire(ctx, entree)).rejects.toThrow(ForbiddenError);
  });

  it('compte les entreprises retenues (nouvelles) sans jamais créer de contact', async () => {
    const { ctx, appels } = faux({
      'jr:sources_campagne': [{ id: 'camp-1' }],
      'jr:sources_annuaire_upsert': [{ inserted: true }],
    });
    const r = await ajouterDepuisAnnuaire(ctx, entree);
    expect(r).toEqual({ entreprisesRetenues: 2, dejaConnues: 0 });
    expect(appels.some(([sql]) => /insert into contacts/i.test(sql))).toBe(false);
  });

  it('compte les entreprises déjà connues quand l’upsert ne fait qu’une mise à jour', async () => {
    const { ctx } = faux({
      'jr:sources_campagne': [{ id: 'camp-1' }],
      'jr:sources_annuaire_upsert': [{ inserted: false }],
    });
    const r = await ajouterDepuisAnnuaire(ctx, entree);
    expect(r).toEqual({ entreprisesRetenues: 0, dejaConnues: 2 });
  });
});

describe('sirensConnus', () => {
  it('refuse un rôle insuffisant', async () => {
    const { ctx } = faux({}, null);
    await expect(sirensConnus(ctx, { sirens: ['111111111'] })).rejects.toThrow(ForbiddenError);
  });

  it('ne requête pas la base pour une liste vide', async () => {
    const { ctx, appels } = faux({}, 'viewer');
    const r = await sirensConnus(ctx, { sirens: [] });
    expect(r).toEqual([]);
    expect(appels).toHaveLength(0);
  });

  it('retourne les SIREN déjà présents dans accounts (R42, annotation avant ajout)', async () => {
    const { ctx } = faux(
      { 'jr:sources_annuaire_connus': [{ siren: '111111111' }] },
      'viewer',
    );
    const r = await sirensConnus(ctx, { sirens: ['111111111', '222222222'] });
    expect(r).toEqual(['111111111']);
  });
});

describe('ajouterDepuisListe', () => {
  const entree = { campagneId: CAMPAGNE_ID, listId: '22222222-2222-2222-2222-222222222222' };

  it('refuse un rôle insuffisant', async () => {
    const { ctx } = faux({}, 'viewer');
    await expect(ajouterDepuisListe(ctx, entree)).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable quand la liste n’existe pas', async () => {
    const { ctx } = faux({
      'jr:sources_campagne': [{ id: 'camp-1' }],
      'jr:sources_liste_verifier': [],
    });
    await expect(ajouterDepuisListe(ctx, entree)).rejects.toThrow(ErreurIntrouvable);
  });

  it('inscrit les contacts candidats de la liste dans la campagne', async () => {
    const { ctx } = faux({
      'jr:sources_campagne': [{ id: 'camp-1' }],
      'jr:sources_liste_verifier': [{ id: 'list-1' }],
      'jr:sources_liste_candidats': [{ id: 'contact-1' }],
      'jr:sources_liste_inscrire': [{}],
    });
    const r = await ajouterDepuisListe(ctx, entree);
    expect(r).toEqual({ ajoutes: 1 });
  });
});

describe('listerListesOrganisation', () => {
  it('refuse un rôle insuffisant', async () => {
    const { ctx } = faux({}, null);
    await expect(listerListesOrganisation(ctx, {})).rejects.toThrow(ForbiddenError);
  });

  it('retourne les listes de l’organisation avec leur nombre de contacts', async () => {
    const { ctx } = faux(
      {
        'jr:sources_listes_organisation': [
          { id: 'list-1', name: 'Participants webinaire de juin', n: 62 },
        ],
      },
      'viewer',
    );
    const r = await listerListesOrganisation(ctx, {});
    expect(r).toEqual([
      { id: 'list-1', nom: 'Participants webinaire de juin', nombreContacts: 62 },
    ]);
  });
});
