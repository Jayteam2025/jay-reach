import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { creerCampagneComplete } from './assistant-campagne.js';

/** Même convention que `sequence.test.ts` : un faux POOL, `connect()` compris (R47). */
function fauxConnectable(
  rows: Record<string, unknown[]>,
  role: Contexte['role'] = 'admin',
): { ctx: Contexte; appelsClient: () => string[]; appelsPool: () => string[]; releases: () => number } {
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
    appelsClient: () => (clientQuery.mock.calls as unknown[][]).map((a) => String(a[0])),
    appelsPool: () => (poolQuery.mock.calls as unknown[][]).map((a) => String(a[0])),
    releases: () => releases,
  };
}

const CAMP_ID = '11111111-1111-1111-1111-111111111111';
const SOURCE_ID = '22222222-2222-2222-2222-222222222222';
const TEMPLATE_ID = '33333333-3333-3333-3333-333333333333';
const ETAPE_ID = '44444444-4444-4444-4444-444444444444';

/** Lignes couvrant un aller simple : 1 campagne, 1 source Adzuna, 2 étapes email, réglages. */
function lignesHeureux(): Record<string, unknown[]> {
  return {
    'jr:creer_campagne\\b': [{ id: CAMP_ID }],
    'jr:sources_campagne': [{ id: CAMP_ID }],
    'jr:sources_creer': [{ id: SOURCE_ID }],
    'jr:sequence_etape_campagne_lire': [{ name: 'Test', source_id: null, locale: 'fr' }],
    'jr:sequence_extraits': [],
    'jr:sequence_modele_creer': [{ id: TEMPLATE_ID }],
    'jr:sequence_etape_position': [{ n: 0 }],
    'jr:sequence_etape_creer': [{ id: ETAPE_ID }],
    'jr:reglages_lire': [{ entry_rules: {}, status: 'draft' }],
    'jr:reglages_ecrire': [{}],
  };
}

const entreeDeBase = {
  nom: 'CEO de scale-ups tech',
  personaIds: [] as string[],
  minScore: 70,
  dailyCap: 30,
  sources: [
    {
      providerId: 'adzuna' as const,
      nom: 'Adzuna · CEO',
      config: { motsCles: ['ceo', 'fondateur'], lieux: [] },
    },
  ],
  etapes: [
    { sujet: 'Objet 1', corps: 'Bonjour {{prenom}}', delaiHeures: 0 },
    { sujet: 'Objet 2', corps: 'Bonjour {{prenom}}, relance', delaiHeures: 48 },
  ],
};

describe('creerCampagneComplete', () => {
  it('refuse un opérateur (admin requis, même seuil qu’enregistrerEtape)', async () => {
    const { ctx } = fauxConnectable({}, 'operator');
    await expect(creerCampagneComplete(ctx, entreeDeBase)).rejects.toThrow(ForbiddenError);
  });

  it('écrit dans l’ordre campagne → sources → étapes → réglages, sur le CLIENT loué (begin … commit)', async () => {
    const { ctx, appelsClient, releases } = fauxConnectable(lignesHeureux());

    const resultat = await creerCampagneComplete(ctx, entreeDeBase);

    expect(resultat).toEqual({ campagneId: CAMP_ID, lancee: false, manques: [] });
    expect(releases()).toBe(1);

    const textes = appelsClient().map((s) => s.trim().toLowerCase());
    const pos = (motif: string) => textes.findIndex((s) => new RegExp(motif, 'i').test(s));

    const iBegin = pos('^begin$');
    const iCampagne = pos('jr:creer_campagne\\b');
    const iSource = pos('jr:sources_creer');
    const iEtape1 = textes.findIndex((s) => /jr:sequence_etape_creer/i.test(s));
    const indicesEtapes = textes.reduce<number[]>((acc, s, i) => (/jr:sequence_etape_creer/i.test(s) ? [...acc, i] : acc), []);
    const iEtape2 = indicesEtapes[indicesEtapes.length - 1] ?? -1;
    const iReglages = pos('jr:reglages_ecrire');
    const iCommit = pos('^commit$');

    expect(iBegin).toBeGreaterThanOrEqual(0);
    expect(iCampagne).toBeGreaterThan(iBegin);
    expect(iSource).toBeGreaterThan(iCampagne);
    expect(iEtape1).toBeGreaterThan(iSource);
    expect(iEtape2).toBeGreaterThan(iEtape1);
    expect(iReglages).toBeGreaterThan(iEtape2);
    expect(iCommit).toBeGreaterThan(iReglages);

    // Deux étapes réellement écrites (pas une seule répétée).
    const nbEtapes = textes.filter((s) => /jr:sequence_etape_creer/i.test(s)).length;
    expect(nbEtapes).toBe(2);
  });

  it('tout ou rien : une étape invalide (variable inconnue) annule toute la transaction (rollback, aucun commit)', async () => {
    const { ctx, appelsClient } = fauxConnectable(lignesHeureux());

    await expect(
      creerCampagneComplete(ctx, {
        ...entreeDeBase,
        etapes: [{ sujet: 'Objet', corps: 'Bonjour {{inconnue}}', delaiHeures: 0 }],
      }),
    ).rejects.toThrow();

    const textes = appelsClient().map((s) => s.trim().toLowerCase());
    expect(textes.some((s) => s === 'rollback')).toBe(true);
    expect(textes.some((s) => s === 'commit')).toBe(false);
    // La campagne a bien été créée sur la connexion (avant l'échec), mais
    // jamais validée : aucune source, aucune réglage n'a suivi non plus.
    expect(textes.some((s) => /jr:reglages_ecrire/.test(s))).toBe(false);
  });

  it('« Créer et lancer » avec un manque (aucun expéditeur actif) renvoie les manques et laisse la campagne en brouillon', async () => {
    const rows = {
      ...lignesHeureux(),
      'jr:lancer_lire': [{ entry_rules: {} }],
      'jr:manques_etapes': [
        { position: 0, channel: 'email', template_parent_id: TEMPLATE_ID },
        { position: 1, channel: 'email', template_parent_id: TEMPLATE_ID },
      ],
      'jr:manques_genres': [], // aucun expéditeur actif, ni email ni linkedin
      'jr:manques_cle': [],
      'jr:manques_boites': [],
    };
    const { ctx, appelsClient, appelsPool } = fauxConnectable(rows);

    const resultat = await creerCampagneComplete(ctx, { ...entreeDeBase, lancer: true });

    expect(resultat.campagneId).toBe(CAMP_ID);
    expect(resultat.lancee).toBe(false);
    expect(resultat.manques.length).toBeGreaterThan(0);

    // La transaction de création, elle, a bien été validée : la campagne
    // existe en brouillon malgré le lancement refusé (jamais d'écriture
    // partielle : ce qui a réussi est réellement enregistré).
    const textesClient = appelsClient().map((s) => s.trim().toLowerCase());
    expect(textesClient.some((s) => s === 'commit')).toBe(true);
    // `lancer` tourne APRÈS la transaction, sur le CONTEXTE D'ORIGINE (le
    // pool) — jamais sur le client déjà relâché.
    const textesPool = appelsPool().map((s) => s.trim().toLowerCase());
    expect(textesPool.some((s) => /jr:lancer_lire/.test(s))).toBe(true);
    expect(textesPool.some((s) => /jr:lancer_activer/.test(s))).toBe(false);
  });
});
