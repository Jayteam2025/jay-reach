import { describe, expect, it } from 'vitest';
import { clePost, ficheIncomplete } from './posts-fiches.js';

const ID = '7271000000000000001';

describe('clePost', () => {
  it("rend la meme cle pour l'URL et pour l'URN du meme post", () => {
    const url = `https://www.linkedin.com/feed/update/urn:li:activity:${ID}/`;
    expect(clePost(url)).toBe(clePost(`urn:li:activity:${ID}`));
    expect(clePost(url)).toBe(`linkedin:${ID}`);
  });

  it("rend la meme cle pour deux formes d'adresse du meme post", () => {
    expect(clePost(`https://fr.linkedin.com/posts/ana-test_sujet-activity-${ID}-AbCd`)).toBe(
      clePost(`https://www.linkedin.com/feed/update/urn:li:activity:${ID}`),
    );
  });

  it("accepte une adresse sans identifiant d'activite et rend une cle stable", () => {
    const cle = clePost('https://www.linkedin.com/company/acme-test/');
    expect(cle).not.toBe('');
    expect(clePost('https://www.linkedin.com/company/acme-test')).toBe(cle);
  });
});

describe('ficheIncomplete', () => {
  const complete = { author_name: 'Ana', text_excerpt: 'Un texte', posted_at: new Date('2026-10-01T00:00:00Z') };

  it('est fausse quand les trois champs sont la', () => {
    expect(ficheIncomplete(complete)).toBe(false);
  });

  it.each([
    ['auteur', { ...complete, author_name: null }],
    ['texte', { ...complete, text_excerpt: null }],
    ['date', { ...complete, posted_at: null }],
  ])('est vraie quand le champ %s manque', (_nom, ligne) => {
    expect(ficheIncomplete(ligne)).toBe(true);
  });
});
