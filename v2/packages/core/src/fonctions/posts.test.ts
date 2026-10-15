import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../roles.js';
import { ErreurEntree, ErreurIntrouvable } from './contexte.js';
import type { Contexte } from './contexte.js';
import type { Executeur } from '../executeur.js';
import {
  compterPostsAValiderDeCampagne,
  corrigerSujetDePost,
  decouperAccroche,
  echeanceDePost,
  listerPostsDeCampagne,
  rejeterPost,
  reouvrirPost,
  validerPost,
} from './posts.js';

const POST = '11111111-1111-4111-8111-111111111111';
const CAMPAGNE = '22222222-2222-4222-8222-222222222222';

interface Appel {
  sql: string;
  valeurs: unknown[];
}

/**
 * Un exécuteur qui enregistre ce qu'on lui envoie et répond par motif. Les lignes passent par
 * JSON : `query<T>` est générique, et un double typé sur un `T` concret ne lui est pas assignable
 * sans `as` (que ce dépôt refuse dans les tests). Le SQL, lui, n'est jamais exécuté ici : le
 * harnais `test/pg-verify/accroche-post.mjs` le joue sur un vrai Postgres.
 */
function contexte(
  reponses: Record<string, { rows?: object[]; rowCount?: number }> = {},
  role: Contexte['role'] = 'operator',
): { ctx: Contexte; appels: Appel[] } {
  const appels: Appel[] = [];
  const ex: Executeur = {
    async query(sql, valeurs = []) {
      appels.push({ sql, valeurs });
      for (const [motif, r] of Object.entries(reponses)) {
        if (new RegExp(motif, 'i').test(sql)) {
          const rows = JSON.parse(JSON.stringify(r.rows ?? []));
          return { rows, rowCount: r.rowCount ?? rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { ctx: { ex, organisationId: 'org-1', utilisateurId: 'user-1', role }, appels };
}

describe('validerPost', () => {
  it('écrit en une seule requête conditionnelle sur le sujet', async () => {
    const { ctx, appels } = contexte({ 'set review_status = \'approved\'': { rowCount: 1 } });
    await validerPost(ctx, { postId: POST });
    expect(appels).toHaveLength(1);
    expect(appels[0]?.sql).toMatch(/coalesce\(btrim\(subject\), ''\) <> ''/);
    expect(appels[0]?.sql).toMatch(/organization_id = \$1/);
  });

  it('refuse un post sans sujet', async () => {
    const { ctx } = contexte({ 'select review_status': { rows: [{ review_status: 'pending', subject: null, expired: false }] } });
    await expect(validerPost(ctx, { postId: POST })).rejects.toBeInstanceOf(ErreurEntree);
  });

  it('refuse un post rejeté : il faut le rouvrir', async () => {
    const { ctx } = contexte({ 'select review_status': { rows: [{ review_status: 'rejected', subject: 'x', expired: false }] } });
    await expect(validerPost(ctx, { postId: POST })).rejects.toMatchObject({ details: { formErrors: [expect.stringMatching(/rouvrez/)] } });
  });

  it('ne dit rien d un post déjà validé', async () => {
    const { ctx } = contexte({ 'select review_status': { rows: [{ review_status: 'approved', subject: 'x', expired: false }] } });
    await expect(validerPost(ctx, { postId: POST })).resolves.toBeUndefined();
  });

  it('dit introuvable pour un post hors de l organisation', async () => {
    const { ctx } = contexte();
    await expect(validerPost(ctx, { postId: POST })).rejects.toBeInstanceOf(ErreurIntrouvable);
  });

  it('refuse un identifiant qui n est pas un uuid, et un lecteur', async () => {
    await expect(validerPost(contexte().ctx, { postId: 'abc' })).rejects.toBeInstanceOf(ErreurEntree);
    await expect(validerPost(contexte({}, 'viewer').ctx, { postId: POST })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('corrigerSujetDePost', () => {
  it('pose subject_origin operator et ramène un post validé en attente', async () => {
    const { ctx, appels } = contexte({ 'update linkedin_posts': { rowCount: 1 } });
    await corrigerSujetDePost(ctx, { postId: POST, sujet: '  l\'adoption du CRM  ' });
    expect(appels[0]?.sql).toContain("subject_origin = 'operator'");
    expect(appels[0]?.sql).toMatch(/case when review_status = 'approved' then 'pending'/);
    expect(appels[0]?.valeurs).toEqual(['org-1', POST, 'l\'adoption du CRM']);
  });

  it('refuse un sujet vide ou blanc', async () => {
    const { ctx, appels } = contexte();
    await expect(corrigerSujetDePost(ctx, { postId: POST, sujet: '   ' })).rejects.toBeInstanceOf(ErreurEntree);
    expect(appels).toHaveLength(0);
  });
});

describe('rejeterPost et reouvrirPost', () => {
  it('rejeter ne supprime rien', async () => {
    const { ctx, appels } = contexte({ 'update linkedin_posts': { rowCount: 1 } });
    await rejeterPost(ctx, { postId: POST });
    expect(appels.map((a) => a.sql).join('\n')).not.toMatch(/\bdelete\b/i);
    expect(appels[0]?.sql).toContain("review_status = 'rejected'");
  });

  it('rouvrir ramène un post rejeté en attente sans toucher à l échéance', async () => {
    const { ctx, appels } = contexte({ 'update linkedin_posts': { rowCount: 1 } });
    await reouvrirPost(ctx, { postId: POST });
    expect(appels[0]?.sql).toContain("review_status = 'pending'");
    expect(appels[0]?.sql).not.toMatch(/set[^]*expires_at\s*=/i);
  });

  it('rouvrir refuse un post dont la fenêtre est passée', async () => {
    const { ctx } = contexte({ 'select review_status': { rows: [{ review_status: 'rejected', subject: 'x', expired: true }] } });
    await expect(reouvrirPost(ctx, { postId: POST })).rejects.toMatchObject({ details: { formErrors: [expect.stringMatching(/fenêtre/)] } });
  });
});

describe('listerPostsDeCampagne', () => {
  const brut = {
    id: POST,
    url: 'https://www.linkedin.com/feed/update/urn:li:activity:1',
    author_display_name: 'Christelle Moreau',
    subject: 'l\'adoption du CRM',
    posted_at: '2026-10-12T08:00:00.000Z',
    review_status: 'pending',
    expires_at: '2026-10-28T08:00:00.000Z',
    personnes: '47',
  };

  it('borne la requête à la campagne et à l organisation, et compte les personnes', async () => {
    const { ctx, appels } = contexte({ 'from linkedin_posts lp': { rows: [brut] } });
    const lignes = await listerPostsDeCampagne(ctx, { campagneId: CAMPAGNE });
    expect(lignes[0]?.personnesEnAttente).toBe(47);
    expect(lignes[0]?.auteur).toBe('Christelle Moreau');
    expect(appels[0]?.sql).toMatch(/cs\.campaign_id = \$2/);
    expect(appels[0]?.valeurs).toEqual(['org-1', CAMPAGNE, null]);
  });

  it('compose l accroche à partir du gabarit en vigueur, sujet laissé en place', async () => {
    const { ctx } = contexte({
      'from linkedin_posts lp': { rows: [brut] },
      'from sequence_steps': { rows: [{ body: 'Bonjour {{prenom}}. Je vous ai vu réagir au post de {{post_auteur}} sur {{post_sujet}}. À bientôt.' }] },
    });
    const [ligne] = await listerPostsDeCampagne(ctx, { campagneId: CAMPAGNE });
    expect(ligne?.apercuAccroche).toBe('Je vous ai vu réagir au post de Christelle Moreau sur {{post_sujet}}.');
    expect(decouperAccroche(ligne?.apercuAccroche ?? null)).toEqual({
      avant: 'Je vous ai vu réagir au post de Christelle Moreau sur ',
      apres: '.',
    });
  });

  it('rend null quand aucune étape ne cite le sujet', async () => {
    const { ctx } = contexte({
      'from linkedin_posts lp': { rows: [brut] },
      'from sequence_steps': { rows: [{ body: 'Bonjour {{prenom}}' }] },
    });
    const [ligne] = await listerPostsDeCampagne(ctx, { campagneId: CAMPAGNE });
    expect(ligne?.apercuAccroche).toBeNull();
  });
});

describe('compterPostsAValiderDeCampagne', () => {
  it('lit le compte', async () => {
    const { ctx } = contexte({ 'count\\(\\*\\)': { rows: [{ n: '3' }] } });
    expect(await compterPostsAValiderDeCampagne(ctx, { campagneId: CAMPAGNE })).toBe(3);
  });
});

describe('decouperAccroche', () => {
  it('tolère les espaces et la casse du jeton, et un repli', () => {
    expect(decouperAccroche('sur {{ POST_SUJET | ceci }} fin')).toEqual({ avant: 'sur ', apres: ' fin' });
  });
  it('rend null sans jeton', () => {
    expect(decouperAccroche('rien')).toBeNull();
    expect(decouperAccroche(null)).toBeNull();
  });
});

describe('echeanceDePost', () => {
  const t0 = new Date('2026-10-15T09:00:00Z');
  const dans = (heures: number) => new Date(t0.getTime() + heures * 3_600_000);
  it('reste neutre loin de l échéance', () => {
    expect(echeanceDePost(dans(24 * 13), t0)).toMatchObject({ cle: 'loin', ton: 'loin' });
    expect(echeanceDePost(dans(24 * 8), t0).ton).toBe('loin');
  });
  it('passe en attention à quelques jours', () => {
    expect(echeanceDePost(dans(24 * 4), t0)).toMatchObject({ cle: 'bientot', jours: 4, ton: 'bientot' });
    expect(echeanceDePost(dans(24 * 7), t0).ton).toBe('bientot');
  });
  it('n est en erreur qu au dernier moment', () => {
    expect(echeanceDePost(dans(24 * 2), t0).ton).toBe("bientot");
    expect(echeanceDePost(dans(24), t0)).toMatchObject({ cle: 'demain', ton: 'urgent' });
    expect(echeanceDePost(dans(3), t0)).toMatchObject({ cle: 'aujourdhui', ton: 'urgent' });
    expect(echeanceDePost(dans(-1), t0)).toMatchObject({ cle: 'passee', ton: 'urgent' });
  });
});

describe('borne du sujet', () => {
  it('refuse un sujet plus long que celui que le modèle aurait le droit d écrire', async () => {
    const { ctx, appels } = contexte();
    await expect(corrigerSujetDePost(ctx, { postId: POST, sujet: 'x'.repeat(71) })).rejects.toBeInstanceOf(ErreurEntree);
    expect(appels).toHaveLength(0);
  });
});
