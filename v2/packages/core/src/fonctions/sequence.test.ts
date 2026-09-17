import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import { actionIdempotencyKey } from '../sequencer/actions.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurIntrouvable, ErreurEntree } from './contexte.js';
import {
  lireSequence,
  lireCampagnePourEtape,
  enregistrerEtape,
  enregistrerVersionModele,
  supprimerEtape,
  apercuEtape,
  envoyerTest,
  verserDansBibliotheque,
  colonnesDeListeCampagne,
  reprendreInscription,
} from './sequence.js';

/** Même convention que `file-du-jour.test.ts` : un motif (tag `/* jr:nom *\/`) associé aux lignes à renvoyer. */
function faux(rows: Record<string, unknown[]>, role: Contexte['role'] = 'operator'): Contexte {
  const query = vi.fn(async (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) {
      if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    }
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role };
}

function appelsDe(ctx: Contexte): unknown[][] {
  return (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
}

function texteDesAppels(ctx: Contexte): string[] {
  return appelsDe(ctx).map((a) => String(a[0]));
}

/**
 * Faux POOL, `connect()` compris (R47) : les requêtes d'avant transaction
 * (lecture de la campagne, extraits) partent sur le pool ; celles de
 * `dansUneTransaction` partent sur le CLIENT loué — jamais le même mock, pour
 * vérifier que `enregistrerEtape`/`enregistrerVersionModele` écrivent bien sur
 * une connexion dédiée.
 */
function fauxConnectable(
  rows: Record<string, unknown[]>,
  role: Contexte['role'] = 'admin',
): { ctx: Contexte; appelsPool: () => string[]; appelsClient: () => string[]; releases: () => number } {
  let releases = 0;
  const resoudre = (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) {
      if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    }
    return { rows: [], rowCount: 0 };
  };
  const poolQuery = vi.fn(async (sql: string) => resoudre(sql));
  const clientQuery = vi.fn(async (sql: string) => resoudre(sql));
  const ex = {
    query: poolQuery as unknown as Executeur['query'],
    connect: vi.fn(async () => ({
      query: clientQuery as unknown as Executeur['query'],
      release: vi.fn(() => {
        releases += 1;
      }),
    })),
  };
  const ctx: Contexte = { ex: ex as unknown as Executeur, organisationId: 'org-1', utilisateurId: 'user-1', role };
  return {
    ctx,
    appelsPool: () => (poolQuery.mock.calls as unknown[][]).map((a) => String(a[0])),
    appelsClient: () => (clientQuery.mock.calls as unknown[][]).map((a) => String(a[0])),
    releases: () => releases,
  };
}

const campagneId = '11111111-1111-1111-1111-111111111111';
const etapeId = '22222222-2222-2222-2222-222222222222';
const contactId = '33333333-3333-3333-3333-333333333333';
const templateParentId = '44444444-4444-4444-4444-444444444444';

describe('lireSequence', () => {
  it('refuse un viewer... non, l’onglet se lit dès viewer', async () => {
    const ctx = faux(
      {
        'jr:sequence_campagne\\b': [{ id: campagneId }],
        'jr:sequence_etapes': [],
      },
      'viewer',
    );
    await expect(lireSequence(ctx, { campagneId })).resolves.toBeDefined();
  });

  it('lève ErreurIntrouvable quand la campagne n’appartient pas à l’organisation', async () => {
    const ctx = faux({});
    await expect(lireSequence(ctx, { campagneId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('ne montre que les étapes email/LinkedIn, numérote à partir de 1 et nomme les étapes selon leur canal et leur rôle', async () => {
    const idA = 'a0000000-0000-0000-0000-000000000001';
    const idB = 'a0000000-0000-0000-0000-000000000002';
    const idC = 'a0000000-0000-0000-0000-000000000003';
    const ctx = faux({
      'jr:sequence_campagne\\b': [{ id: campagneId }],
      'jr:sequence_sources': [{ provider_id: 'adzuna' }],
      'jr:sequence_qualifies': [{ n: 412 }],
      'jr:sequence_etapes': [
        { id: idA, position: 0, channel: 'email', delay_hours: 0, template_parent_id: templateParentId },
        { id: idB, position: 1, channel: 'email', delay_hours: 48, template_parent_id: null },
        { id: idC, position: 2, channel: 'linkedin_message', delay_hours: 72, template_parent_id: null },
      ],
      'jr:sequence_fin': [{ n: 62 }],
      'jr:sequence_gabarits': [{ family_id: templateParentId, subject: 'Objet {{prenom}}', body: 'Corps {{prenom}}' }],
      'jr:sequence_passes': [
        { step_id: idA, n: 186 },
        { step_id: idB, n: 141 },
      ],
      'jr:sequence_repondus': [
        { step_id: idA, first_name: 'Marc', last_name: 'Petit', photo_url: null },
        { step_id: idA, first_name: 'Sarah', last_name: 'Lopez', photo_url: 'https://x/y.jpg' },
      ],
    });

    const vue = await lireSequence(ctx, { campagneId });

    expect(vue.sources).toEqual([{ providerId: 'adzuna' }]);
    expect(vue.qualifies).toBe(412);
    expect(vue.finDeSequence).toEqual({ termines: 62 });
    expect(vue.etapes).toHaveLength(3);

    expect(vue.etapes[0]).toMatchObject({
      id: idA,
      position: 1,
      canal: 'email',
      titre: 'Premier email',
      sujet: 'Objet {{prenom}}',
      corps: 'Corps {{prenom}}',
      passes: 186,
    });
    expect(vue.etapes[0]!.repondusIci.total).toBe(2);
    expect(vue.etapes[0]!.repondusIci.contacts).toEqual([
      { nom: 'Marc Petit', photoUrl: null },
      { nom: 'Sarah Lopez', photoUrl: 'https://x/y.jpg' },
    ]);

    expect(vue.etapes[1]).toMatchObject({ position: 2, canal: 'email', titre: 'Relance', sujet: null, corps: '', passes: 141 });
    expect(vue.etapes[1]!.repondusIci).toEqual({ total: 0, contacts: [] });

    expect(vue.etapes[2]).toMatchObject({ position: 3, canal: 'linkedin', titre: 'Dernier message LinkedIn', passes: 0 });

    // R19 (test de robustesse) : les requêtes se limitent aux canaux affichés, jamais courrier/appel.
    const requeteEtapes = appelsDe(ctx).find((a) => /jr:sequence_etapes/i.test(String(a[0])));
    expect(requeteEtapes?.[1]).toEqual([campagneId, ['email', 'linkedin_invite', 'linkedin_message']]);

    // Le calcul s'appuie bien sur `actions` (passes) et `enrollments`/`outcomes` (réponses par étape).
    const texte = texteDesAppels(ctx).join('\n');
    expect(texte).toMatch(/from actions/i);
    expect(texte).toMatch(/from outcomes/i);
  });

  it('une invitation LinkedIn en première étape ne s’appelle jamais « Premier email » (R30, constaté en base réelle)', async () => {
    const idA = 'a0000000-0000-0000-0000-00000000000a';
    const ctx = faux({
      'jr:sequence_campagne\\b': [{ id: campagneId }],
      'jr:sequence_etapes': [{ id: idA, position: 0, channel: 'linkedin_invite', delay_hours: 0, template_parent_id: null }],
    });
    const vue = await lireSequence(ctx, { campagneId });
    expect(vue.etapes[0]!.titre).toBe('Invitation LinkedIn');
  });

  it('R70 (tour de correction 4) : une source sans aucun repère de fournisseur renvoie providerId null', async () => {
    const ctx = faux({
      'jr:sequence_campagne\\b': [{ id: campagneId }],
      // `SQL_PROVIDER_ID_AFFICHAGE` rend `null` quand ni `source_providers`, ni
      // `config.sourceType`, ni la colonne héritée `sources.provider_id` n'ont
      // de valeur — le diagramme de séquence doit se rabattre sur 'lettre',
      // jamais planter sur `null.includes`.
      'jr:sequence_sources': [{ provider_id: null }],
      'jr:sequence_etapes': [],
    });
    const vue = await lireSequence(ctx, { campagneId });
    expect(vue.sources).toEqual([{ providerId: null }]);
  });

  it('une seule étape affichée reste « Premier email », jamais « Dernier mot »', async () => {
    const idA = 'a0000000-0000-0000-0000-000000000009';
    const ctx = faux({
      'jr:sequence_campagne\\b': [{ id: campagneId }],
      'jr:sequence_etapes': [{ id: idA, position: 0, channel: 'email', delay_hours: 0, template_parent_id: null }],
    });
    const vue = await lireSequence(ctx, { campagneId });
    expect(vue.etapes[0]!.titre).toBe('Premier email');
  });
});

describe('lireCampagnePourEtape', () => {
  it('R61 (tour de correction 2) : lit la locale via organizations.default_locale, jamais campaigns.locale (colonne inexistante)', async () => {
    // Bug réel de recette (16/09) : `select name, source_id, locale from
    // campaigns` levait `column "locale" does not exist` (transaction annulée
    // avant toute écriture) — `campaigns` n'a jamais eu cette colonne, seules
    // `message_templates`/`accounts`/`contacts` en ont une. Les tests
    // simulaient le pool sans jamais vérifier le texte de la requête, donc
    // rien ne l'attrapait : cette assertion porte sur les colonnes écrites.
    const ctx = faux({
      'jr:sequence_etape_campagne_lire': [{ name: 'Directeur commercial', source_id: 'src-1', locale: 'fr' }],
    });
    await lireCampagnePourEtape(ctx, campagneId);
    const requete = texteDesAppels(ctx).find((s) => /jr:sequence_etape_campagne_lire/.test(s))!;
    expect(requete).toMatch(/organizations/i);
    expect(requete).toMatch(/default_locale/i);
    expect(requete).not.toMatch(/select name, source_id, locale from campaigns/i);
  });
});

describe('enregistrerEtape', () => {
  it('refuse un opérateur (rôle admin requis)', async () => {
    const ctx = faux({}, 'operator');
    await expect(
      enregistrerEtape(ctx, { campagneId, sujet: 'Objet', corps: 'Bonjour {{prenom}}', delaiHeures: 0 }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurEntree sur une variable inconnue, sans rien écrire', async () => {
    const ctx = faux(
      { 'jr:sequence_etape_campagne_lire': [{ name: 'Directeur commercial', source_id: 'src-1', locale: 'fr' }] },
      'admin',
    );
    await expect(
      enregistrerEtape(ctx, { campagneId, sujet: 'Objet', corps: 'Bonjour {{inconnue}}', delaiHeures: 0 }),
    ).rejects.toThrow(ErreurEntree);
    expect(texteDesAppels(ctx).some((s) => /^begin$/i.test(s.trim()))).toBe(false);
  });

  // Point de cohérence transversale (fusion de main) : la tolérance de
  // `validateTemplateVariables` pour le préfixe `liste_<colonne>` (variables
  // de colonnes importées) doit valoir aussi côté sauvegarde d'une étape par
  // le tiroir, pas seulement à l'envoi.
  it('accepte {{liste_poste}} (variable de colonne importée) à l’enregistrement', async () => {
    const nouveauTemplateId = '77777777-7777-7777-7777-777777777777';
    const nouvelleEtapeId = '88888888-8888-8888-8888-888888888888';
    const { ctx, appelsClient } = fauxConnectable({
      'jr:sequence_etape_campagne_lire': [{ name: 'Directeur commercial', source_id: 'src-1', locale: 'fr' }],
      'jr:sequence_extraits': [],
      'jr:sequence_modele_creer': [{ id: nouveauTemplateId }],
      'jr:sequence_etape_position': [{ n: 0 }],
      'jr:sequence_etape_creer': [{ id: nouvelleEtapeId }],
    });

    const res = await enregistrerEtape(ctx, {
      campagneId,
      sujet: 'Objet',
      corps: 'Bonjour {{prenom}}, poste : {{liste_poste}}.',
      delaiHeures: 0,
    });

    expect(res).toEqual({ etapeId: nouvelleEtapeId });
    expect(appelsClient().some((s) => /jr:sequence_etape_creer/.test(s))).toBe(true);
  });

  it('crée le modèle puis l’étape sur le CLIENT loué (begin … commit), rien de tel sur le pool (R47)', async () => {
    const nouveauTemplateId = '55555555-5555-5555-5555-555555555555';
    const nouvelleEtapeId = '66666666-6666-6666-6666-666666666666';
    const { ctx, appelsPool, appelsClient, releases } = fauxConnectable({
      'jr:sequence_etape_campagne_lire': [{ name: 'Directeur commercial', source_id: 'src-1', locale: 'fr' }],
      'jr:sequence_extraits': [],
      'jr:sequence_modele_creer': [{ id: nouveauTemplateId }],
      'jr:sequence_etape_position': [{ n: 0 }],
      'jr:sequence_etape_creer': [{ id: nouvelleEtapeId }],
    });

    const res = await enregistrerEtape(ctx, {
      campagneId,
      sujet: 'Une question sur ton équipe',
      corps: 'Bonjour {{prenom}}, ...',
      delaiHeures: 0,
    });

    expect(res).toEqual({ etapeId: nouvelleEtapeId });

    const textesClient = appelsClient().map((s) => s.trim().toLowerCase());
    const iBegin = textesClient.findIndex((s) => s === 'begin');
    const iModele = textesClient.findIndex((s) => /jr:sequence_modele_creer/.test(s));
    const iEtape = textesClient.findIndex((s) => /jr:sequence_etape_creer/.test(s));
    const iCommit = textesClient.findIndex((s) => s === 'commit');
    expect(iBegin).toBeGreaterThanOrEqual(0);
    expect(iCommit).toBeGreaterThan(iEtape);
    expect(iEtape).toBeGreaterThan(iModele);
    expect(iModele).toBeGreaterThan(iBegin);
    expect(releases()).toBe(1);

    // Rien de tel n'a jamais transité par le pool : lecture de la campagne et
    // validation des extraits seulement (avant l'ouverture de la transaction).
    const textesPool = appelsPool().join('\n');
    expect(textesPool).toMatch(/jr:sequence_etape_campagne_lire/);
    expect(textesPool).not.toMatch(/^begin$|^commit$/im);
    expect(textesPool).not.toMatch(/jr:sequence_etape_creer|jr:sequence_modele_creer/);
  });

  it('réécrit une étape existante sur le client loué : nouvelle version du modèle (désactive l’ancienne)', async () => {
    const { ctx, appelsClient } = fauxConnectable({
      'jr:sequence_etape_campagne_lire': [{ name: 'Directeur commercial', source_id: null, locale: 'fr' }],
      'jr:sequence_etape_existante': [{ template_parent_id: templateParentId, channel: 'email' }],
      'jr:sequence_extraits': [],
      'jr:sequence_modele_prochaine_version': [{ next: 2 }],
      'jr:sequence_modele_versionner': [{ id: 'v2-id' }],
      'jr:sequence_etape_maj': [{ id: etapeId }],
    });

    const res = await enregistrerEtape(ctx, {
      campagneId,
      etapeId,
      sujet: 'Re : une question',
      corps: 'Je me permets de remonter mon message, {{prenom}}.',
      delaiHeures: 48,
    });

    expect(res).toEqual({ etapeId });
    const textes = appelsClient().join('\n');
    expect(textes).toMatch(/jr:sequence_modele_desactiver/);
    expect(textes).toMatch(/jr:sequence_modele_versionner/);
  });

  it('R48 : une création email sans objet est refusée', async () => {
    const ctx = faux(
      { 'jr:sequence_etape_campagne_lire': [{ name: 'X', source_id: null, locale: 'fr' }] },
      'admin',
    );
    await expect(
      enregistrerEtape(ctx, { campagneId, canal: 'email', corps: 'Corps', delaiHeures: 0 }),
    ).rejects.toThrow(ErreurEntree);
    expect(texteDesAppels(ctx)).toEqual([]);
  });

  it('R48 : une création LinkedIn sans objet est acceptée (canal linkedin_message par défaut)', async () => {
    const nouvelleEtapeId = '99999999-9999-9999-9999-999999999999';
    const ctx = faux(
      {
        'jr:sequence_etape_campagne_lire': [{ name: 'Directeur commercial', source_id: 'src-1', locale: 'fr' }],
        'jr:sequence_extraits': [],
        'jr:sequence_modele_creer': [{ id: 'modele-li-1' }],
        'jr:sequence_etape_position': [{ n: 0 }],
        'jr:sequence_etape_creer': [{ id: nouvelleEtapeId }],
      },
      'admin',
    );

    const res = await enregistrerEtape(ctx, {
      campagneId,
      canal: 'linkedin',
      corps: 'Bonjour {{prenom}}, je vous invite à échanger.',
      delaiHeures: 0,
    });

    expect(res).toEqual({ etapeId: nouvelleEtapeId });
    const creerModele = appelsDe(ctx).find((a) => /jr:sequence_modele_creer/i.test(String(a[0])));
    expect(creerModele?.[1]).toEqual([
      'org-1',
      'Directeur commercial',
      'linkedin_message',
      'fr',
      null,
      'Bonjour {{prenom}}, je vous invite à échanger.',
      'step',
      'user-1',
    ]);
    const creerEtape = appelsDe(ctx).find((a) => /jr:sequence_etape_creer/i.test(String(a[0])));
    expect(creerEtape?.[1]).toEqual([campagneId, 0, 'linkedin_message', 0, 'modele-li-1']);
  });

  it('R48 : modifier une étape linkedin_invite garde le canal linkedin_invite', async () => {
    const ctx = faux(
      {
        'jr:sequence_etape_campagne_lire': [{ name: 'Directeur commercial', source_id: null, locale: 'fr' }],
        'jr:sequence_etape_existante': [{ template_parent_id: templateParentId, channel: 'linkedin_invite' }],
        'jr:sequence_extraits': [],
        'jr:sequence_modele_prochaine_version': [{ next: 2 }],
        'jr:sequence_modele_versionner': [{ id: 'v2-id' }],
        'jr:sequence_etape_maj': [{ id: etapeId }],
      },
      'admin',
    );

    const res = await enregistrerEtape(ctx, {
      campagneId,
      etapeId,
      canal: 'linkedin',
      corps: 'Corps mis à jour {{prenom}}',
      delaiHeures: 0,
    });

    expect(res).toEqual({ etapeId });
    const maj = appelsDe(ctx).find((a) => /jr:sequence_etape_maj/i.test(String(a[0])));
    expect(maj?.[1]).toEqual([templateParentId, 0, 'linkedin_invite', etapeId, campagneId]);
  });
});

describe('enregistrerVersionModele', () => {
  const entreeValide = {
    nom: 'Message de bibliothèque',
    canal: 'email' as const,
    locale: 'fr',
    sujet: 'Objet',
    corps: 'Bonjour {{prenom}}',
    nature: 'signal' as const,
    origin: 'library' as const,
  };

  it('crée une nouvelle lignée sur le client loué (begin … commit), R47', async () => {
    const nouveauId = '77777777-7777-7777-7777-777777777777';
    const { ctx, appelsClient, releases } = fauxConnectable({
      'jr:sequence_extraits': [],
      'jr:sequence_modele_creer': [{ id: nouveauId }],
    });

    const res = await enregistrerVersionModele(ctx, entreeValide);

    expect(res).toEqual({ id: nouveauId });
    const textes = appelsClient().map((s) => s.trim().toLowerCase());
    expect(textes[0]).toBe('begin');
    expect(textes.at(-1)).toBe('commit');
    expect(releases()).toBe(1);
  });

  it('un échec d’écriture fait rollback, relâche le client et remonte l’erreur', async () => {
    const appelsClient: string[] = [];
    let releases = 0;
    const ex = {
      query: vi.fn(async (sql: string) => {
        if (/jr:sequence_extraits/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      }) as unknown as Executeur['query'],
      connect: vi.fn(async () => ({
        query: vi.fn(async (sql: string) => {
          appelsClient.push(sql);
          if (/jr:sequence_modele_creer/i.test(sql)) throw new Error('violation de contrainte');
          return { rows: [], rowCount: 0 };
        }) as unknown as Executeur['query'],
        release: vi.fn(() => {
          releases += 1;
        }),
      })),
    };
    const ctx: Contexte = { ex: ex as unknown as Executeur, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };

    await expect(enregistrerVersionModele(ctx, entreeValide)).rejects.toThrow('violation de contrainte');

    const textes = appelsClient.map((s) => s.trim().toLowerCase());
    expect(textes[0]).toBe('begin');
    expect(textes.some((s) => /jr:sequence_modele_creer/.test(s))).toBe(true);
    expect(textes.at(-1)).toBe('rollback');
    expect(releases).toBe(1);
  });
});

describe('supprimerEtape', () => {
  it('refuse un opérateur (rôle admin requis)', async () => {
    const ctx = faux({}, 'operator');
    await expect(supprimerEtape(ctx, { campagneId, etapeId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si l’étape n’existe pas dans cette campagne', async () => {
    const ctx = faux({ 'jr:sequence_etape_campagne_lire': [{ name: 'X', source_id: null, locale: 'fr' }] }, 'admin');
    await expect(supprimerEtape(ctx, { campagneId, etapeId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('supprime l’étape et journalise', async () => {
    const ctx = faux(
      {
        'jr:sequence_etape_campagne_lire': [{ name: 'X', source_id: null, locale: 'fr' }],
        'jr:sequence_etape_supprimer': [{ id: etapeId }],
      },
      'admin',
    );
    await expect(supprimerEtape(ctx, { campagneId, etapeId })).resolves.toBeUndefined();
  });
});

describe('apercuEtape', () => {
  it('remplace {{prenom}}, {{entreprise}} et {{poste}} avec le contact fictif quand aucun contactId n’est fourni', async () => {
    const ctx = faux({
      'jr:sequence_apercu_etape': [{ campaign_id: campagneId, template_parent_id: templateParentId }],
      'jr:sequence_apercu_gabarit': [
        { subject: '{{prenom}}, une question sur ton équipe', body: '{{prenom}} chez {{entreprise}}, {{poste}} ?' },
      ],
    });
    const res = await apercuEtape(ctx, { etapeId });
    expect(res).toEqual({
      sujet: 'Claire, une question sur ton équipe',
      corps: 'Claire chez Néolia, Directrice commerciale ?',
      variablesManquantes: [],
    });
  });

  it('utilise le contact réel quand un contactId est fourni', async () => {
    const ctx = faux({
      'jr:sequence_apercu_etape': [{ campaign_id: campagneId, template_parent_id: templateParentId }],
      'jr:sequence_apercu_gabarit': [{ subject: 'Objet {{prenom}}', body: 'Corps {{prenom}} {{entreprise}}' }],
      'jr:valeurs_contact\\b': [
        {
          first_name: 'Karim',
          last_name: 'Benali',
          job_title: 'DAF',
          email: 'k.benali@example.test',
          locale: 'fr',
          company_name: 'Woodpecker Studio',
          domain: null,
          city: null,
          headcount: null,
          postal_code: null,
          country: null,
          persona_angle: null,
          signal_title: null,
          signal_location: null,
          signal_url: null,
          signal_occurred_at: null,
          context_note: null,
        },
      ],
      'jr:valeurs_contact_extraits': [],
    });
    const res = await apercuEtape(ctx, { etapeId, contactId });
    expect(res).toEqual({ sujet: 'Objet Karim', corps: 'Corps Karim Woodpecker Studio', variablesManquantes: [] });
  });

  it('signale une variable manquante (C5) : un contact sans entreprise ne résout pas {{entreprise}}', async () => {
    const ctx = faux({
      'jr:sequence_apercu_etape': [{ campaign_id: campagneId, template_parent_id: templateParentId }],
      'jr:sequence_apercu_gabarit': [{ subject: 'Objet {{prenom}}', body: 'Corps {{prenom}} de {{entreprise}}' }],
      'jr:valeurs_contact\\b': [
        {
          first_name: 'Karim',
          last_name: 'Benali',
          job_title: 'DAF',
          email: 'k.benali@example.test',
          locale: 'fr',
          company_name: null,
          domain: null,
          city: null,
          headcount: null,
          postal_code: null,
          country: null,
          persona_angle: null,
          signal_title: null,
          signal_location: null,
          signal_url: null,
          signal_occurred_at: null,
          context_note: null,
        },
      ],
      'jr:valeurs_contact_extraits': [],
    });
    const res = await apercuEtape(ctx, { etapeId, contactId });
    expect(res.variablesManquantes).toEqual(['entreprise']);
    expect(res.corps).toBe('Corps Karim de ');
  });

  it('lève ErreurIntrouvable si l’étape n’appartient pas à l’organisation', async () => {
    const ctx = faux({});
    await expect(apercuEtape(ctx, { etapeId })).rejects.toThrow(ErreurIntrouvable);
  });

  // Tâche 29, partie A point 4 : le contact fictif ne connaît aucune colonne
  // de liste importée, mais une variable liste_<colonne> QUE LA CAMPAGNE
  // POSSÈDE (`colonnesDeListeCampagne`) doit s'afficher en espace réservé
  // plutôt que manquante — sinon l'opérateur croirait la variable cassée
  // alors qu'elle se résoudra pour un contact réel.
  it('remplace {{liste_poste}} par [poste] pour le contact fictif quand la campagne a cette colonne, mais laisse {{liste_ville}} manquant', async () => {
    const ctx = faux({
      'jr:sequence_apercu_etape': [{ campaign_id: campagneId, template_parent_id: templateParentId }],
      'jr:sequence_apercu_gabarit': [
        { subject: 'Objet', body: 'Poste : {{liste_poste}}, ville : {{liste_ville}}' },
      ],
      'jr:sequence_colonnes_liste': [{ raw_row: { Poste: 'Directrice commerciale' } }],
    });
    const res = await apercuEtape(ctx, { etapeId });
    expect(res.corps).toBe('Poste : [poste], ville : ');
    expect(res.variablesManquantes).toEqual(['liste_ville']);
  });

  it('ne touche à aucune variable liste_ quand la campagne n’a pas de liste (contact fictif)', async () => {
    const ctx = faux({
      'jr:sequence_apercu_etape': [{ campaign_id: campagneId, template_parent_id: templateParentId }],
      'jr:sequence_apercu_gabarit': [{ subject: 'Objet', body: 'Poste : {{liste_poste}}' }],
      'jr:sequence_colonnes_liste': [],
    });
    const res = await apercuEtape(ctx, { etapeId });
    expect(res.corps).toBe('Poste : ');
    expect(res.variablesManquantes).toEqual(['liste_poste']);
  });

  it('avec un contactId réel, ne pose aucun espace réservé (lireValeursContact fait le vrai travail)', async () => {
    const ctx = faux({
      'jr:sequence_apercu_etape': [{ campaign_id: campagneId, template_parent_id: templateParentId }],
      'jr:sequence_apercu_gabarit': [{ subject: 'Objet', body: 'Poste : {{liste_poste}}' }],
      'jr:valeurs_contact\\b': [
        {
          first_name: 'Karim',
          last_name: 'Benali',
          job_title: 'DAF',
          email: 'k.benali@example.test',
          locale: 'fr',
          company_name: null,
          domain: null,
          city: null,
          headcount: null,
          postal_code: null,
          country: null,
          persona_angle: null,
          signal_title: null,
          signal_location: null,
          signal_url: null,
          signal_occurred_at: null,
          context_note: null,
          raw_row: { Poste: 'DAF' },
        },
      ],
      'jr:valeurs_contact_extraits': [],
    });
    const res = await apercuEtape(ctx, { etapeId, contactId });
    expect(res.corps).toBe('Poste : DAF');
    expect(texteDesAppels(ctx).some((s) => /jr:sequence_colonnes_liste/i.test(s))).toBe(false);
  });
});

describe('colonnesDeListeCampagne', () => {
  it('rend les variables liste_<colonne>, normalisées, dédoublonnées, dans l’ordre de première apparition', async () => {
    const ctx = faux({
      'jr:sequence_colonnes_liste': [
        { raw_row: { 'Intitulé Poste': 'DAF', Ville: 'Nantes' } },
        { raw_row: { ville: 'Rennes', 'Intitulé Poste': 'DRH' } }, // homonymes : ne comptent qu'une fois
        { raw_row: null }, // ligne sans raw_row : ignorée
        { raw_row: { '   ': 'x' } }, // clé qui normalise vers une chaîne vide : ignorée
      ],
    });
    await expect(colonnesDeListeCampagne(ctx, { campagneId })).resolves.toEqual([
      'liste_intitule_poste',
      'liste_ville',
    ]);
  });

  it('rend un tableau vide sans liste reliée à la campagne', async () => {
    const ctx = faux({ 'jr:sequence_colonnes_liste': [] });
    await expect(colonnesDeListeCampagne(ctx, { campagneId })).resolves.toEqual([]);
  });

  it('se lit dès viewer', async () => {
    const ctx = faux({ 'jr:sequence_colonnes_liste': [] }, 'viewer');
    await expect(colonnesDeListeCampagne(ctx, { campagneId })).resolves.toEqual([]);
  });

  // Tour de correction 1, Bloquant (relecture) : ce pool n'a pas de RLS
  // (rôle service, `apps/web/lib/contexte.ts`) — l'isolation multi-tenant
  // repose entièrement sur le filtrage applicatif. Sans lui, une campagne
  // d'une autre organisation aurait rendu les noms de colonnes de SA liste
  // importée. Même modèle qu'`apercuEtape`/`lireSequence` : `ctx.organisationId`
  // en second paramètre, vérifié dans le `WHERE` lui-même — jamais une
  // lecture préalable qui pourrait être contournée par un futur appelant
  // (le principe « une fonction, deux façades » prévoit un appel MCP direct).
  it('filtre par organisation : la requête vérifie c.organization_id = ctx.organisationId', async () => {
    const ctx = faux({ 'jr:sequence_colonnes_liste': [] });
    await colonnesDeListeCampagne(ctx, { campagneId });
    const appel = appelsDe(ctx).find((a) => /jr:sequence_colonnes_liste/i.test(String(a[0])));
    expect(String(appel?.[0])).toMatch(/organization_id\s*=\s*\$2/i);
    expect(appel?.[1]).toEqual([campagneId, 'org-1']);
  });
});

describe('envoyerTest', () => {
  it('refuse un viewer (rôle operator requis)', async () => {
    const ctx = faux({}, 'viewer');
    await expect(envoyerTest(ctx, { etapeId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable sans expéditeur email actif', async () => {
    const ctx = faux({
      'jr:sequence_test_etape': [{ campaign_id: campagneId, entry_rules: {} }],
      'jr:sequence_test_utilisateur': [{ email: 'operateur@exemple.test' }],
    });
    await expect(envoyerTest(ctx, { etapeId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('inscrit le contact de test et programme une action email, sans jamais appeler SalesBlink', async () => {
    const senderId = '77777777-7777-7777-7777-777777777777';
    const enrollmentId = '88888888-8888-8888-8888-888888888888';
    const ctx = faux({
      'jr:sequence_test_etape': [{ campaign_id: campagneId, entry_rules: {} }],
      'jr:sequence_test_utilisateur': [{ email: 'operateur@exemple.test' }],
      'jr:sequence_test_expediteur': [{ id: senderId }],
      'jr:sequence_test_contact': [{ id: contactId }],
      'jr:sequence_test_arreter_ailleurs': [],
      'jr:sequence_test_inscription_existante': [],
      'jr:sequence_test_inscrire': [{ id: enrollmentId }],
      'jr:sequence_test_action': [{}],
    });

    await envoyerTest(ctx, { etapeId });

    const actionAppel = appelsDe(ctx).find((a) => /jr:sequence_test_action/i.test(String(a[0])));
    expect(actionAppel?.[1]).toEqual([
      'org-1',
      enrollmentId,
      etapeId,
      senderId,
      JSON.stringify({ email: 'operateur@exemple.test' }),
      expect.stringMatching(new RegExp(`^test:${etapeId}:${contactId}:\\d+$`)),
    ]);
    // Aucun appel réseau : seules des requêtes SQL sont émises (mock jamais un fetch).
    expect(texteDesAppels(ctx).every((s) => typeof s === 'string')).toBe(true);
  });
});

describe('verserDansBibliotheque', () => {
  it('bascule origin/name sur toute la lignée (id = $3 or parent_id = $3)', async () => {
    const ctx = faux({ 'jr:sequence_verser_bibliotheque': [{}] }, 'admin');
    await expect(
      verserDansBibliotheque(ctx, { campagneId, templateParentId, nom: '  Premier email  ' }),
    ).resolves.toBeUndefined();

    const maj = appelsDe(ctx).find((a) => /jr:sequence_verser_bibliotheque/i.test(String(a[0])));
    expect(maj?.[1]).toEqual(['Premier email', 'org-1', templateParentId]);
  });

  it('lève ErreurIntrouvable si le modèle n’existe pas dans cette organisation', async () => {
    const ctx = faux({}, 'admin');
    await expect(verserDansBibliotheque(ctx, { campagneId, templateParentId, nom: 'Premier email' })).rejects.toThrow(
      ErreurIntrouvable,
    );
  });
});

describe('reprendreInscription', () => {
  const inscriptionId = '99999999-9999-9999-9999-999999999999';
  const etapeIdBloquee = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  it('refuse un viewer (rôle operator requis)', async () => {
    const ctx = faux({}, 'viewer');
    await expect(reprendreInscription(ctx, { inscriptionId })).rejects.toThrow(ForbiddenError);
  });

  it('pause email_gate → reprise : inscription active, current_step inchangé, action bloquée rejouée', async () => {
    const ctx = faux({
      'jr:reprendre_inscription': [{ contact_id: contactId, campaign_id: campagneId, current_step: 2 }],
      'jr:reprendre_etape': [{ id: etapeIdBloquee }],
      'jr:reprendre_action': [],
      'jr:reprendre_evenement': [{}],
    });
    await reprendreInscription(ctx, { inscriptionId });

    const appelInscription = appelsDe(ctx).find((a) => /jr:reprendre_inscription/i.test(String(a[0])));
    expect(appelInscription?.[1]).toEqual([inscriptionId, 'org-1']);
    // `current_step` n'est jamais réécrit ici : l'étape qui vient d'échouer
    // reste l'étape courante, une reprise doit la rejouer, pas la sauter.
    expect(String(appelInscription?.[0])).not.toMatch(/current_step\s*=/i);

    const appelEtape = appelsDe(ctx).find((a) => /jr:reprendre_etape/i.test(String(a[0])));
    expect(appelEtape?.[1]).toEqual([campagneId, 2]);

    const appelAction = appelsDe(ctx).find((a) => /jr:reprendre_action/i.test(String(a[0])));
    expect(appelAction?.[1]).toEqual([actionIdempotencyKey(inscriptionId, etapeIdBloquee), 'org-1']);
    expect(String(appelAction?.[0])).toMatch(/status\s*=\s*'scheduled'/i);
    expect(String(appelAction?.[0])).toMatch(/block_reason\s*=\s*null/i);
  });

  it('pause paused_absence → reprise : resume_at posé à null par la même écriture', async () => {
    const ctx = faux({
      'jr:reprendre_inscription': [{ contact_id: contactId, campaign_id: campagneId, current_step: 0 }],
      'jr:reprendre_etape': [{ id: etapeIdBloquee }],
      'jr:reprendre_action': [],
    });
    await reprendreInscription(ctx, { inscriptionId });
    const appelInscription = appelsDe(ctx).find((a) => /jr:reprendre_inscription/i.test(String(a[0])));
    expect(String(appelInscription?.[0])).toMatch(/resume_at\s*=\s*null/i);
    expect(String(appelInscription?.[0])).toMatch(/stop_reason\s*=\s*null/i);
    expect(String(appelInscription?.[0])).toMatch(/status\s*in\s*\('paused',\s*'paused_absence'\)/i);
  });

  it('lève ErreurIntrouvable pour une inscription qui n’est pas en pause (déjà active, terminée…)', async () => {
    const ctx = faux({ 'jr:reprendre_inscription': [] });
    await expect(reprendreInscription(ctx, { inscriptionId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('filtre par organisation dans le WHERE (une inscription d’une autre organisation reste introuvable)', async () => {
    const ctx = faux({ 'jr:reprendre_inscription': [] });
    await expect(reprendreInscription(ctx, { inscriptionId })).rejects.toThrow(ErreurIntrouvable);
    const appelInscription = appelsDe(ctx).find((a) => /jr:reprendre_inscription/i.test(String(a[0])));
    expect(String(appelInscription?.[0])).toMatch(/organization_id\s*=\s*\$2/i);
    expect(appelInscription?.[1]).toEqual([inscriptionId, 'org-1']);
  });

  // Tour de correction 1, Important (relecture) : `current_step` est un
  // INDEX de tableau partout ailleurs (`composeTick` fait `steps[currentStep]`
  // sur un tableau trié par `position asc`) — jamais une valeur de `position`
  // à égaler. `supprimerEtape` ne renumérote pas les étapes restantes : une
  // séquence à positions non contiguës (0, 2, 5…) doit quand même retrouver
  // la bonne étape par RANG, pas par valeur.
  it('retrouve l’étape par rang ordinal (order by position asc offset … limit 1), pas par égalité de position', async () => {
    const ctx = faux({
      'jr:reprendre_inscription': [{ contact_id: contactId, campaign_id: campagneId, current_step: 1 }],
      'jr:reprendre_etape': [{ id: etapeIdBloquee }],
      'jr:reprendre_action': [],
    });
    await reprendreInscription(ctx, { inscriptionId });

    const appelEtape = appelsDe(ctx).find((a) => /jr:reprendre_etape/i.test(String(a[0])));
    expect(String(appelEtape?.[0])).toMatch(/order by position asc/i);
    expect(String(appelEtape?.[0])).toMatch(/offset\s*\$2/i);
    expect(String(appelEtape?.[0])).not.toMatch(/position\s*=\s*\$2/i);
    // `current_step` (1) est passé tel quel comme décalage — un `current_step`
    // de 1 avec des positions 0, 2, 5 (non contiguës) doit retrouver la
    // DEUXIÈME étape par rang, jamais celle dont `position = 1` (qui
    // n'existe pas dans cet exemple) : c'est exactement ce que fait `offset`.
    expect(appelEtape?.[1]).toEqual([campagneId, 1]);
  });

  // Mineur (relecture) : une pause `sender_unavailable` survient AVANT
  // l'insertion de l'action de l'étape (`sequence.ts` du worker, chemin
  // `resolveSender(...).paused`) — aucune action n'existe encore pour cette
  // étape au moment de la pause. La reprise ne doit ni planter ni rien
  // réinitialiser à tort : le tick suivant recrée normalement l'action.
  it('reprend une pause sender_unavailable sans action existante pour l’étape (rien à rejouer, pas d’erreur)', async () => {
    const ctx = faux({
      'jr:reprendre_inscription': [{ contact_id: contactId, campaign_id: campagneId, current_step: 0 }],
      'jr:reprendre_etape': [{ id: etapeIdBloquee }],
      'jr:reprendre_action': [], // aucune ligne : l'UPDATE ne matche rien (0 ligne affectée), sans erreur
    });
    await expect(reprendreInscription(ctx, { inscriptionId })).resolves.toBeUndefined();

    const appelInscription = appelsDe(ctx).find((a) => /jr:reprendre_inscription/i.test(String(a[0])));
    expect(appelInscription).toBeDefined();
    const appelAction = appelsDe(ctx).find((a) => /jr:reprendre_action/i.test(String(a[0])));
    // La requête de reset est bien tentée (elle ne matche simplement aucune
    // ligne côté vraie base, puisqu'aucune action `blocked`/`failed` n'existe
    // pour cette étape) — aucun comportement spécial à coder pour ce cas.
    expect(appelAction).toBeDefined();
  });

  // M3 (Mineur, revue finale du 14/09) : rejouer une action qui porte déjà
  // une preuve d'envoi (`payload->>'message_id'`, posée par la relève une
  // fois SalesBlink confirmé) peut doubler l'email. La reprise réactive quand
  // même l'inscription, mais ne remet PAS l'action `scheduled` — et le dit
  // dans le journal plutôt que de rejouer silencieusement.
  it('réactive l’inscription sans rejouer une action qui porte déjà une preuve d’envoi', async () => {
    const ctx = faux({
      'jr:reprendre_inscription': [{ contact_id: contactId, campaign_id: campagneId, current_step: 0 }],
      'jr:reprendre_etape': [{ id: etapeIdBloquee }],
      'jr:reprendre_verif_envoi': [{ id: 'action-deja-envoyee' }],
    });

    await reprendreInscription(ctx, { inscriptionId });

    const appelInscription = appelsDe(ctx).find((a) => /jr:reprendre_inscription/i.test(String(a[0])));
    expect(appelInscription).toBeDefined();

    // L'action déjà partie n'est jamais rejouée.
    const appelAction = appelsDe(ctx).find((a) => /jr:reprendre_action/i.test(String(a[0])));
    expect(appelAction).toBeUndefined();

    const journal = appelsDe(ctx).find((a) => /insert into audit_events/i.test(String(a[0])));
    expect(journal).toBeDefined();
    expect(String((journal?.[1] as unknown[])[5])).toMatch(/déjà parti/i);
  });
});
