/**
 * L'onglet Posts rendu pour de bon, avec un traducteur réel : seules les lectures de données sont
 * substituées, par des objets du type réel de `@jay-reach/core`.
 *
 * Deux défauts que seul ce niveau attrape, parce qu'ils vivent dans la COMPOSITION de la page et
 * pas dans une fonction :
 *
 *  - « N posts attendent votre relecture » annoncé par une campagne qui ne nomme aucun post. Le
 *    bandeau et l'échéance s'y subordonnaient déjà, pas ce résumé-là : l'opérateur relisait des
 *    posts qui ne débloquent personne, et le jour où la rétention sera vraie il ne le lira plus
 *    (« une alerte fausse en éteint une vraie ». La barre ne se tait pas pour autant : elle dit
 *    maintenant que la relecture faite ici sert aux campagnes qui, elles, nomment ce post) ;
 *  - le jeton brut d'une variable de post que la capture n'a pas pu lire, affiché tel quel dans
 *    la phrase relue (« votre réaction du {{post_date}} »).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import type { LignePost, RetenuesParPost } from '@jay-reach/core';

const etat = vi.hoisted(() => ({
  posts: [] as unknown[],
  retenues: null as unknown,
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator: creer } = await import('next-intl');
  const messages = (await import('@jay-reach/i18n/messages/fr.json')).default;
  return {
    getTranslations: async (namespace: string) => creer({ locale: 'fr', messages, namespace }),
    getLocale: async () => 'fr',
  };
});
vi.mock('../../../../../lib/contexte', () => ({
  contexteCourant: async () => ({ role: 'admin', organisationId: 'o', utilisateurId: 'u', ex: {} }),
}));
vi.mock('../../../../actions/posts', () => ({
  actionCorrigerAuteur: async () => ({ ok: true }),
  actionCorrigerSujet: async () => ({ ok: true }),
  actionRejeterPost: async () => ({ ok: true }),
  actionReouvrirPost: async () => ({ ok: true }),
  actionValiderPost: async () => ({ ok: true }),
  actionValiderPosts: async () => ({ ok: true }),
}));
vi.mock('@jay-reach/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fuseauDeLOrganisation: async () => 'Europe/Paris',
  listerPostsDeCampagne: async () => etat.posts,
  compterRetenuesParPost: async () => etat.retenues,
}));

import CampagnePostsPage from './page';

const ACCROCHE = 'Je vous ai vu réagir au post de {{post_auteur}} sur {{post_sujet}}.';
/** Ce que rend `listerPostsDeCampagne` quand la capture n'a pas pu lire la date du post. */
const ACCROCHE_SANS_DATE = 'Votre réaction du {{post_date}} m\'a interpellé.';
/**
 * Une accroche dont la seule variable de post portait un repli, telle que l'aperçu la rend : le
 * repli ne sert jamais (`url` existe dès la création de la fiche), et la campagne nomme QUAND
 * MÊME le post — le harnais le prouve sur Postgres (contrôles 31 et 31a).
 */
const ACCROCHE_REPLI_RENDUE = 'J\'ai vu votre réaction à ce post : https://www.linkedin.com/feed/update/urn:li:activity:1.';

function post(apercuAccroche: string | null): LignePost {
  return {
    id: 'p1',
    url: 'https://www.linkedin.com/feed/update/urn:li:activity:1',
    auteur: 'Christelle Moreau',
    sujet: 'l\'adoption du CRM',
    posteLe: new Date('2026-10-12T08:00:00.000Z'),
    etat: 'pending',
    personnesEnAttente: 47,
    expireLe: new Date('2026-11-28T08:00:00.000Z'),
    apercuAccroche,
  };
}

const RETENUES: RetenuesParPost = {
  nommeUnPost: true,
  aUneSourceDePost: true,
  enAttenteDeValidation: 47,
  postInexploitable: 0,
};

/** L'apostrophe des libellés français sort échappée du rendu statique. */
const echappe = (texte: string) => texte.replace(/'/g, '&#x27;');

const rendre = async () =>
  renderToStaticMarkup(await CampagnePostsPage({ params: Promise.resolve({ id: 'camp-1' }) }));

beforeEach(() => {
  etat.posts = [post(ACCROCHE)];
  etat.retenues = RETENUES;
});

describe('le résumé de la barre', () => {
  it('annonce la relecture quand la campagne nomme un post', async () => {
    expect(await rendre()).toContain('post attend');
  });

  it('n\'annonce AUCUNE relecture quand la campagne ne nomme aucun post', async () => {
    etat.retenues = { ...RETENUES, nommeUnPost: false };
    etat.posts = [post(null), { ...post(null), id: 'p2' }];
    const html = await rendre();
    expect(html).not.toContain('post attend');
    // Et pas « Aucun post n'attend votre relecture » non plus : ce serait affirmer qu'il n'y a
    // rien à faire au-dessus de lignes qui proposent de faire quelque chose d'utile.
    expect(html).toContain(echappe(fr.campagne.posts.bar.sansAccroche));
    // Le lot reste offert : la barre vient de dire que relire ici sert aux campagnes qui nomment
    // ce post, et le dire pour ensuite obliger à cliquer ligne par ligne serait se dédire.
    expect(html).toContain('Tout valider (2)');
  });
});

/**
 * L'invariant de la barre : elle parle POUR les lignes qu'elle surmonte, jamais contre elles.
 *
 * Ce que ce test N'EXERCE PAS : `compterRetenuesParPost` est simulé ici, donc rien ne prouve à ce
 * niveau QUELLE écriture fait qu'une campagne nomme un post — un repli, le nom du gabarit, un
 * corps. C'est le harnais qui le prouve, sur Postgres (contrôles 31, 31a, 33, 33a). Ici on ne
 * juge que la composition : les trois éléments de l'écran disent-ils la même chose.
 */
describe('la barre et les lignes ne se contredisent pas', () => {
  it('quand la campagne nomme le post, la barre annonce ce que les lignes proposent', async () => {
    etat.posts = [post(ACCROCHE_REPLI_RENDUE), { ...post(ACCROCHE_REPLI_RENDUE), id: 'p2' }];
    const html = await rendre();
    expect(html).toContain('posts attendent votre relecture');
    expect(html).toContain('Tout valider (2)');
    expect(html).toMatch(/<button[^>]*>Valider<\/button>/);
  });
});

describe('la phrase relue', () => {
  it('n\'affiche jamais un jeton brut : une date non lue se dit en toutes lettres', async () => {
    etat.posts = [post(ACCROCHE_SANS_DATE)];
    const html = await rendre();
    expect(html).not.toContain('{{');
    expect(html).toContain('date indisponible');
  });

  it('et cette ligne-là n\'entre pas dans « Tout valider » : rien de ce que l\'opérateur écrit ne la débloque', async () => {
    etat.posts = [post(ACCROCHE), { ...post(ACCROCHE), id: 'p2' }];
    expect(await rendre()).toContain('Tout valider (2)');
    // La même paire, la date de l'une illisible : il n'en reste qu'un de validable, donc plus de
    // lot du tout. Comptée validable, elle aurait fait buter « Tout valider » sur le refus du
    // serveur à chaque passage.
    etat.posts = [post(ACCROCHE_SANS_DATE), { ...post(ACCROCHE), id: 'p2' }];
    expect(await rendre()).not.toContain('Tout valider');
  });
});
