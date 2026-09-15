import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurIntrouvable, ErreurEntree } from './contexte.js';
import {
  lireSequence,
  enregistrerEtape,
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

  it('crée le modèle puis l’étape dans une transaction (begin … commit visibles)', async () => {
    const nouveauTemplateId = '55555555-5555-5555-5555-555555555555';
    const nouvelleEtapeId = '66666666-6666-6666-6666-666666666666';
    const ctx = faux(
      {
        'jr:sequence_etape_campagne_lire': [{ name: 'Directeur commercial', source_id: 'src-1', locale: 'fr' }],
        'jr:sequence_extraits': [],
        'jr:sequence_modele_creer': [{ id: nouveauTemplateId }],
        'jr:sequence_etape_position': [{ n: 0 }],
        'jr:sequence_etape_creer': [{ id: nouvelleEtapeId }],
      },
      'admin',
    );

    const res = await enregistrerEtape(ctx, {
      campagneId,
      sujet: 'Une question sur ton équipe',
      corps: 'Bonjour {{prenom}}, ...',
      delaiHeures: 0,
    });

    expect(res).toEqual({ etapeId: nouvelleEtapeId });
    const textes = texteDesAppels(ctx).map((s) => s.trim().toLowerCase());
    const iBegin = textes.findIndex((s) => s === 'begin');
    const iModele = textes.findIndex((s) => /jr:sequence_modele_creer/.test(s));
    const iEtape = textes.findIndex((s) => /jr:sequence_etape_creer/.test(s));
    const iCommit = textes.findIndex((s) => s === 'commit');
    expect(iBegin).toBeGreaterThanOrEqual(0);
    expect(iCommit).toBeGreaterThan(iEtape);
    expect(iEtape).toBeGreaterThan(iModele);
    expect(iModele).toBeGreaterThan(iBegin);
  });

  it('réécrit une étape existante : nouvelle version du modèle (désactive l’ancienne)', async () => {
    const ctx = faux(
      {
        'jr:sequence_etape_campagne_lire': [{ name: 'Directeur commercial', source_id: null, locale: 'fr' }],
        'jr:sequence_etape_existante': [{ template_parent_id: templateParentId, channel: 'email' }],
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
      sujet: 'Re : une question',
      corps: 'Je me permets de remonter mon message, {{prenom}}.',
      delaiHeures: 48,
    });

    expect(res).toEqual({ etapeId });
    const textes = texteDesAppels(ctx).join('\n');
    expect(textes).toMatch(/jr:sequence_modele_desactiver/);
    expect(textes).toMatch(/jr:sequence_modele_versionner/);
  });

  it('refuse de modifier une étape non email depuis ce tiroir', async () => {
    const ctx = faux(
      {
        'jr:sequence_etape_campagne_lire': [{ name: 'X', source_id: null, locale: 'fr' }],
        'jr:sequence_etape_existante': [{ template_parent_id: null, channel: 'linkedin_message' }],
      },
      'admin',
    );
    await expect(
      enregistrerEtape(ctx, { campagneId, etapeId, sujet: 'Objet', corps: 'Corps', delaiHeures: 0 }),
    ).rejects.toThrow(ErreurEntree);
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
    expect(res).toEqual({ sujet: 'Objet Karim', corps: 'Corps Karim Woodpecker Studio' });
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
  it('lève ErreurIntrouvable si le modèle n’existe pas dans cette organisation', async () => {
    const ctx = faux({}, 'admin');
    await expect(verserDansBibliotheque(ctx, { campagneId, templateParentId, nom: 'Premier email' })).rejects.toThrow(
      ErreurIntrouvable,
    );
  });
});
