import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../roles.js';
import { ErreurEntree, ErreurIntrouvable } from './contexte.js';
import type { Contexte } from './contexte.js';
import type { Executeur } from '../executeur.js';
import { VARIABLES_DE_POST } from '../messages/variables.js';
import {
  AUTEUR_POST_MAX_CARACTERES,
  CHAMPS_ACCROCHE,
  VARIABLES_DE_POST_RELEVEES,
  compterPostsAValiderDeCampagne,
  corrigerAuteurDePost,
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

/** Valider se fait depuis une campagne : c'est elle qui dit ce que la fiche doit porter. */
const DEPUIS_CAMPAGNE = { postId: POST, campagneId: CAMPAGNE };

/**
 * La campagne nommée en entrée est bien de l'organisation. À poser dans tout contexte qui doit
 * ATTEINDRE le diagnostic : sans elle, `validerPost` s'arrête avant, sur « Campagne introuvable ».
 */
const CAMPAGNE_A_NOUS = { 'from campaigns where id': { rows: [{}] } };

describe('validerPost', () => {
  it('écrit en une seule requête conditionnelle sur ce que la campagne ÉCRIT, pas sur le sujet seul', async () => {
    const { ctx, appels } = contexte({ 'set review_status = \'approved\'': { rowCount: 1 } });
    await validerPost(ctx, DEPUIS_CAMPAGNE);
    expect(appels).toHaveLength(1);
    // Les quatre exigences de la garde, chacune conditionnée à la variable réellement écrite.
    expect(appels[0]?.sql).toMatch(/coalesce\(btrim\(p\.subject\), ''\) <> ''/);
    expect(appels[0]?.sql).toMatch(/coalesce\(btrim\(p\.author_display_name\), ''\) <> ''/);
    expect(appels[0]?.sql).toMatch(/not exists[^]*post_sujet/);
    expect(appels[0]?.sql).toMatch(/organization_id = \$1/);
    expect(appels[0]?.valeurs).toEqual(['org-1', POST, 'user-1', CAMPAGNE]);
  });

  it('refuse quand une variable écrite par la campagne manque, et NOMME laquelle', async () => {
    const { ctx } = contexte({
      ...CAMPAGNE_A_NOUS,
      'select review_status': { rows: [{ review_status: 'pending', expired: false }] },
      'from linkedin_posts p where': { rows: [{ post_auteur: true, post_sujet: false, post_url: false, post_date: false }] },
    });
    await expect(validerPost(ctx, DEPUIS_CAMPAGNE)).rejects.toMatchObject({
      details: { formErrors: [expect.stringMatching(/nom de l'auteur/)] },
    });
  });

  it('dit les deux quand il en manque deux', async () => {
    const { ctx } = contexte({
      ...CAMPAGNE_A_NOUS,
      'select review_status': { rows: [{ review_status: 'pending', expired: false }] },
      'from linkedin_posts p where': { rows: [{ post_auteur: true, post_sujet: true, post_url: false, post_date: false }] },
    });
    await expect(validerPost(ctx, DEPUIS_CAMPAGNE)).rejects.toMatchObject({
      details: { formErrors: [expect.stringMatching(/nom de l'auteur.*le sujet|le sujet.*nom de l'auteur/)] },
    });
  });

  it('refuse un post rejeté : il faut le rouvrir', async () => {
    const { ctx } = contexte({ ...CAMPAGNE_A_NOUS, 'select review_status': { rows: [{ review_status: 'rejected', expired: false }] } });
    await expect(validerPost(ctx, DEPUIS_CAMPAGNE)).rejects.toMatchObject({ details: { formErrors: [expect.stringMatching(/rouvrez/)] } });
  });

  it('refuse un post en attente dont l échéance est passée, avec le même message que la réouverture', async () => {
    const { ctx } = contexte({ ...CAMPAGNE_A_NOUS, 'select review_status': { rows: [{ review_status: 'pending', expired: true }] } });
    await expect(validerPost(ctx, DEPUIS_CAMPAGNE)).rejects.toMatchObject({
      details: { formErrors: [expect.stringMatching(/échéance.*passée.*plus en attente/)] },
    });
  });

  it('ne dit rien d un post déjà validé', async () => {
    const { ctx } = contexte({ ...CAMPAGNE_A_NOUS, 'select review_status': { rows: [{ review_status: 'approved', expired: false }] } });
    await expect(validerPost(ctx, DEPUIS_CAMPAGNE)).resolves.toBeUndefined();
  });

  it('dit introuvable pour un post hors de l organisation', async () => {
    const { ctx } = contexte(CAMPAGNE_A_NOUS);
    await expect(validerPost(ctx, DEPUIS_CAMPAGNE)).rejects.toBeInstanceOf(ErreurIntrouvable);
  });

  it('joint la campagne sur l organisation : un uuid étranger n approuve rien', async () => {
    const { ctx, appels } = contexte({ 'set review_status = \'approved\'': { rowCount: 1 } });
    await validerPost(ctx, DEPUIS_CAMPAGNE);
    // Sans cette jointure, un uuid absent ou d'une autre organisation rend vraies TOUTES les
    // exigences (aucune étape ne nomme le post) et la fiche est approuvée sans relecture utile.
    expect(appels[0]?.sql).toMatch(/from campaigns c\s*\n?\s*where c\.id = \$4::uuid and c\.organization_id = \$1/);
  });

  it('dit introuvable quand la campagne n est pas de l organisation, sans toucher au post', async () => {
    // L'update n'a rien touché, et la campagne n'existe pas chez nous : rien à diagnostiquer.
    const { ctx, appels } = contexte({ 'select review_status': { rows: [{ review_status: 'pending', expired: false }] } });
    await expect(validerPost(ctx, DEPUIS_CAMPAGNE)).rejects.toBeInstanceOf(ErreurIntrouvable);
    expect(appels.map((a) => a.sql).join(' ')).not.toMatch(/select review_status/);
  });

  it('ne demande PAS d écrire une variable que l opérateur ne peut pas écrire', async () => {
    const { ctx } = contexte({
      ...CAMPAGNE_A_NOUS,
      'select review_status': { rows: [{ review_status: 'pending', expired: false }] },
      'from linkedin_posts p where': { rows: [{ post_auteur: false, post_sujet: false, post_url: false, post_date: true }] },
    });
    // La date est un horodatage que la capture relève : aucun champ de l'écran ne la porte, et
    // « écrivez-le dans la phrase » serait un ordre impossible à exécuter.
    await expect(validerPost(ctx, DEPUIS_CAMPAGNE)).rejects.toMatchObject({
      details: { formErrors: [expect.stringMatching(/date de publication.*pas pu être lue.*rattrapage/)] },
    });
    await expect(validerPost(ctx, DEPUIS_CAMPAGNE)).rejects.toMatchObject({
      details: { formErrors: [expect.not.stringMatching(/écrivez/i)] },
    });
  });

  it('dit les deux natures quand il manque une valeur relevée ET un champ à écrire', async () => {
    const { ctx } = contexte({
      ...CAMPAGNE_A_NOUS,
      'select review_status': { rows: [{ review_status: 'pending', expired: false }] },
      'from linkedin_posts p where': { rows: [{ post_auteur: false, post_sujet: true, post_url: false, post_date: true }] },
    });
    await expect(validerPost(ctx, DEPUIS_CAMPAGNE)).rejects.toMatchObject({
      details: { formErrors: [expect.stringMatching(/date de publication.*rattrapage.*le sujet/)] },
    });
  });

  it('refuse un identifiant qui n est pas un uuid, une campagne absente, et un lecteur', async () => {
    await expect(validerPost(contexte().ctx, { postId: 'abc', campagneId: CAMPAGNE })).rejects.toBeInstanceOf(ErreurEntree);
    await expect(validerPost(contexte().ctx, { postId: POST })).rejects.toBeInstanceOf(ErreurEntree);
    await expect(validerPost(contexte({}, 'viewer').ctx, DEPUIS_CAMPAGNE)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('corrigerAuteurDePost', () => {
  it('écrit le nom affiché sans toucher à l état de relecture', async () => {
    const { ctx, appels } = contexte({ 'update linkedin_posts': { rowCount: 1 } });
    await corrigerAuteurDePost(ctx, { postId: POST, auteur: '  Christelle  ' });
    expect(appels[0]?.sql).toContain('author_display_name = $3');
    expect(appels[0]?.sql).not.toMatch(/review_status\s*=/);
    // `author_name` porte l'identifiant technique (le slug d'une page) : il ne doit pas bouger.
    expect(appels[0]?.sql).not.toMatch(/\bauthor_name\s*=/);
    expect(appels[0]?.valeurs).toEqual(['org-1', POST, 'Christelle']);
  });

  it('refuse un nom vide ou plus long que ce qui tient dans une phrase', async () => {
    const { ctx, appels } = contexte();
    await expect(corrigerAuteurDePost(ctx, { postId: POST, auteur: '  ' })).rejects.toBeInstanceOf(ErreurEntree);
    await expect(
      corrigerAuteurDePost(ctx, { postId: POST, auteur: 'x'.repeat(AUTEUR_POST_MAX_CARACTERES + 1) }),
    ).rejects.toBeInstanceOf(ErreurEntree);
    expect(appels).toHaveLength(0);
  });

  it('dit introuvable pour un post hors de l organisation', async () => {
    const { ctx } = contexte();
    await expect(corrigerAuteurDePost(ctx, { postId: POST, auteur: 'Ana' })).rejects.toBeInstanceOf(ErreurIntrouvable);
  });
});

describe('corrigerSujetDePost', () => {
  it('pose subject_origin operator sans toucher à l état de relecture : un post validé reste validé', async () => {
    const { ctx, appels } = contexte({ 'update linkedin_posts': { rowCount: 1 } });
    await corrigerSujetDePost(ctx, { postId: POST, sujet: '  l\'adoption du CRM  ' });
    expect(appels[0]?.sql).toContain("subject_origin = 'operator'");
    expect(appels[0]?.sql).not.toMatch(/review_status\s*=/);
    expect(appels[0]?.sql).not.toMatch(/reviewed_(at|by)\s*=/);
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
    await expect(reouvrirPost(ctx, { postId: POST })).rejects.toMatchObject({
      details: { formErrors: [expect.stringMatching(/échéance.*passée.*plus en attente/)] },
    });
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
    expect(appels[0]?.sql).toMatch(/cs_sa\.campaign_id = \$2::uuid/);
    expect(appels[0]?.valeurs).toEqual(['org-1', CAMPAGNE, null]);
  });

  it('voit les DEUX liens source-campagne, comme la garde : la liaison et le lien historique', async () => {
    const { ctx, appels } = contexte({ 'from linkedin_posts lp': { rows: [brut] } });
    await listerPostsDeCampagne(ctx, { campagneId: CAMPAGNE });
    // Sans le lien historique, une campagne reliée par `campaigns.source_id` retiendrait ses
    // personnes avec un onglet Posts vide : la garde la voit, l'écran ne la verrait pas.
    expect(appels[0]?.sql).toMatch(/cp_sa\.source_id = s\.source_id/);
    expect(appels[0]?.sql).toMatch(/cs_sa\.source_id = s\.source_id/);
  });

  it('compose l accroche à partir du gabarit en vigueur, auteur ET sujet laissés en place', async () => {
    const { ctx } = contexte({
      'from linkedin_posts lp': { rows: [brut] },
      'from sequence_steps': { rows: [{ body: 'Bonjour {{prenom}}. Je vous ai vu réagir au post de {{post_auteur}} sur {{post_sujet}}. À bientôt.' }] },
    });
    const [ligne] = await listerPostsDeCampagne(ctx, { campagneId: CAMPAGNE });
    // L'auteur reste un jeton : c'est un champ que l'opérateur écrit DANS la phrase. Résolu, il
    // laissait « {{post_auteur}} » en clair quand le nom manquait, sans moyen de le corriger.
    expect(ligne?.apercuAccroche).toBe('Je vous ai vu réagir au post de {{post_auteur}} sur {{post_sujet}}.');
    expect(decouperAccroche(ligne?.apercuAccroche ?? null)).toEqual([
      { texte: 'Je vous ai vu réagir au post de ' },
      { champ: 'auteur' },
      { texte: ' sur ' },
      { champ: 'sujet' },
      { texte: '.' },
    ]);
  });

  it('prend la phrase qui nomme l AUTEUR même sans sujet : la campagne n écrit que lui', async () => {
    const { ctx } = contexte({
      'from linkedin_posts lp': { rows: [brut] },
      'from sequence_steps': { rows: [{ body: 'Bonjour. Vu votre réaction au post de {{post_auteur}}. À bientôt.' }] },
    });
    const [ligne] = await listerPostsDeCampagne(ctx, { campagneId: CAMPAGNE });
    expect(decouperAccroche(ligne?.apercuAccroche ?? null)).toEqual([
      { texte: 'Vu votre réaction au post de ' },
      { champ: 'auteur' },
      { texte: '.' },
    ]);
  });

  it('une accroche qui ne cite que l adresse ne rend AUCUN champ à écrire', async () => {
    const { ctx } = contexte({
      'from linkedin_posts lp': { rows: [brut] },
      'from sequence_steps': { rows: [{ body: 'Bonjour. Vu votre réaction à {{post_url}}. À bientôt.' }] },
    });
    const [ligne] = await listerPostsDeCampagne(ctx, { campagneId: CAMPAGNE });
    expect(decouperAccroche(ligne?.apercuAccroche ?? null)).toEqual([
      { texte: 'Vu votre réaction à https://www.linkedin.com/feed/update/urn:li:activity:1.' },
    ]);
  });

  it('rend null quand aucune étape ne nomme le post', async () => {
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

  it('ne compte rien quand la campagne ne nomme aucun post : le badge annonce du TRAVAIL', async () => {
    const { ctx, appels } = contexte({ 'count\\(\\*\\)': { rows: [{ n: '3' }] } });
    await compterPostsAValiderDeCampagne(ctx, { campagneId: CAMPAGNE });
    // Le motif des quatre variables de post, le même que la garde : sans accroche, relire ces
    // posts ne débloque personne. Le harnais le joue sur un vrai Postgres (contrôles 23i et 23j).
    expect(appels[0]?.sql).toMatch(/post_auteur\|post_sujet\|post_url\|post_date/);
  });
});

describe('decouperAccroche', () => {
  it('tolère les espaces et la casse du jeton, et un repli', () => {
    expect(decouperAccroche('sur {{ POST_SUJET | ceci }} fin')).toEqual([
      { texte: 'sur ' },
      { champ: 'sujet' },
      { texte: ' fin' },
    ]);
  });
  it('rend un seul morceau de texte quand rien n est à écrire', () => {
    expect(decouperAccroche('rien')).toEqual([{ texte: 'rien' }]);
  });
  it('rend null seulement quand il n y a pas d accroche du tout', () => {
    expect(decouperAccroche(null)).toBeNull();
  });
  it('coupe deux champs collés sans texte entre eux', () => {
    expect(decouperAccroche('{{post_auteur}}{{post_sujet}}')).toEqual([{ champ: 'auteur' }, { champ: 'sujet' }]);
  });

  it('rend un morceau MANQUANT pour une variable relevée que l aperçu n a pas résolue', () => {
    // `renderTemplatePartial` garde le gabarit quand la valeur est cherchée mais vide : sans ce
    // morceau, « votre réaction du {{post_date}} » s'affichait tel quel dans la phrase relue.
    expect(decouperAccroche('votre réaction du {{post_date}} m\'a interpellé.')).toEqual([
      { texte: 'votre réaction du ' },
      { manquant: 'post_date' },
      { texte: ' m\'a interpellé.' },
    ]);
    expect(decouperAccroche('vu {{ POST_URL }}')).toEqual([{ texte: 'vu ' }, { manquant: 'post_url' }]);
  });
});

describe('les quatre variables de post', () => {
  it('choisissent toutes leur camp : écrite dans la phrase, ou relevée par la capture', () => {
    // Une cinquième variable de post ajoutée sans choisir tomberait du côté « relevée » en
    // silence : elle n'aurait ni champ à l'écran, ni libellé de morceau manquant.
    const classees = [...CHAMPS_ACCROCHE.map((c) => `post_${c}`), ...VARIABLES_DE_POST_RELEVEES].sort();
    expect(classees).toEqual([...VARIABLES_DE_POST].sort());
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
