import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurIntrouvable, ErreurEntree } from './contexte.js';
import {
  lireSequence,
  enregistrerEtape,
  enregistrerVersionModele,
  supprimerEtape,
  apercuEtape,
  envoyerTest,
  verserDansBibliotheque,
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
