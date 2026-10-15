import { describe, expect, it } from 'vitest';
import { dateDeLActivite, lireFicheDuHtml, lireFichePost, nomAffichePourAuteur, TEXTE_MAX } from './fiche-post.js';
import type { Pilote } from './navigateur.js';

/**
 * Fixtures INVENTEES : le depot interdit les vraies personnes et les vraies entreprises. Leur
 * FORME vient du code existant (JSON embarque dans le HTML, `<title>`, liens `/in/` et
 * `/company/`, identifiants d'activite) ; elle n'a PAS ete confrontee a une page vivante.
 * Voir le rapport de la tache 2, tableau des certitudes.
 */
const DATE = new Date('2026-10-12T08:30:00.000Z');
const ID_ACTIVITE = (BigInt(DATE.getTime()) << 22n).toString();
const URL_POST = `https://www.linkedin.com/feed/update/urn:li:activity:${ID_ACTIVITE}/`;

function jsonLd(auteur: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const doc = {
    '@context': 'https://schema.org',
    '@type': 'SocialMediaPosting',
    articleBody: 'Comment nous avons fait adopter le CRM par toute l equipe commerciale.',
    datePublished: '2026-10-12T08:30:00.000Z',
    author: auteur,
    ...extra,
  };
  return `<script type="application/ld+json">${JSON.stringify(doc)}</script>`;
}

const PAGE_PERSONNE = `<html><head><title>Christelle Dupont sur LinkedIn : Comment nous avons fait adopter le CRM</title>
${jsonLd({ '@type': 'Person', name: 'Christelle Dupont', url: 'https://fr.linkedin.com/in/christelle-dupont-exemple?trk=x' })}
</head><body></body></html>`;

const PAGE_PAGE = `<html><head>${jsonLd({
  '@type': 'Organization',
  name: 'Societe Exemple',
  url: 'https://www.linkedin.com/company/societe-exemple',
})}</head><body></body></html>`;

// Sans JSON-LD : seul le titre, la description et les liens du corps servent.
const PAGE_SANS_JSONLD = `<html><head>
<title>Marc Martin on LinkedIn: Trois erreurs de prospection</title>
<meta property="og:description" content="Trois erreurs de prospection &amp; comment les eviter." />
</head><body>
<a href="https://www.linkedin.com/in/profil-suggere-exemple/">Autre Personne</a>
<div><a href="https://www.linkedin.com/in/marc-martin-exemple/?miniProfile=1"><span>Marc Martin</span></a></div>
</body></html>`;

function pilote(reponses: { url?: string; statut?: number; corps?: string; lever?: boolean }): Pilote {
  return {
    aller: async () => {
      if (reponses.lever) throw new Error('navigation impossible');
    },
    url: async () => reponses.url ?? URL_POST,
    requete: async () => {
      if (reponses.lever) throw new Error('reseau');
      return { statut: reponses.statut ?? 200, corps: reponses.corps ?? '' };
    },
  } as unknown as Pilote;
}

describe('nomAffichePourAuteur', () => {
  it('rend le prenom d une personne', () => {
    expect(nomAffichePourAuteur('person', 'Christelle Dupont')).toBe('Christelle');
  });
  it('garde le nom entier d une page', () => {
    expect(nomAffichePourAuteur('page', 'Societe Exemple')).toBe('Societe Exemple');
  });
  it('rend un prenom seul tel quel', () => {
    expect(nomAffichePourAuteur('person', 'Christelle')).toBe('Christelle');
  });
  it('ignore les espaces autour et entre les mots', () => {
    expect(nomAffichePourAuteur('person', '  Jean   Pierre Durand ')).toBe('Jean');
  });
});

describe('dateDeLActivite', () => {
  it('relit la date dans l identifiant d activite', () => {
    expect(dateDeLActivite(`urn:li:activity:${ID_ACTIVITE}`)?.toISOString()).toBe(DATE.toISOString());
  });
  it('refuse un identifiant qui ne donne pas une date plausible', () => {
    expect(dateDeLActivite('urn:li:activity:12345')).toBeNull();
    expect(dateDeLActivite('urn:li:share:abc')).toBeNull();
  });
});

describe('lireFichePost', () => {
  it('lit une personne, son nom public, le texte et la date', async () => {
    const fiche = await lireFichePost(pilote({ corps: PAGE_PERSONNE }), URL_POST);
    expect(fiche.urn).toBe(`urn:li:activity:${ID_ACTIVITE}`);
    expect(fiche.url).toBe(URL_POST);
    expect(fiche.auteur).toEqual({
      kind: 'person',
      nom: 'Christelle Dupont',
      nomAffiche: 'Christelle',
      nomPublic: 'christelle-dupont-exemple',
      url: 'https://www.linkedin.com/in/christelle-dupont-exemple/',
    });
    expect(fiche.texte).toContain('adopter le CRM');
    expect(fiche.date?.toISOString()).toBe(DATE.toISOString());
  });

  it('reconnait une page', async () => {
    const fiche = await lireFichePost(pilote({ corps: PAGE_PAGE }), URL_POST);
    expect(fiche.auteur).toMatchObject({
      kind: 'page',
      nom: 'Societe Exemple',
      nomAffiche: 'Societe Exemple',
      nomPublic: 'societe-exemple',
      url: 'https://www.linkedin.com/company/societe-exemple/',
    });
  });

  it('se rabat sur le titre, la description et le lien le plus proche du nom', async () => {
    const fiche = await lireFichePost(pilote({ corps: PAGE_SANS_JSONLD }), URL_POST);
    expect(fiche.auteur).toMatchObject({ kind: 'person', nom: 'Marc Martin', nomPublic: 'marc-martin-exemple' });
    expect(fiche.texte).toBe('Trois erreurs de prospection & comment les eviter.');
    // Pas de date dans la page : celle de l'identifiant d'activite.
    expect(fiche.date?.toISOString()).toBe(DATE.toISOString());
  });

  it('borne le texte', async () => {
    const long = jsonLd({ '@type': 'Person', name: 'Lea Test' }, { articleBody: 'mot '.repeat(1000) });
    const fiche = await lireFichePost(pilote({ corps: `<html><head>${long}</head></html>` }), URL_POST);
    expect(fiche.texte?.length).toBeLessThanOrEqual(TEXTE_MAX);
  });

  it('rend des champs nuls sur une page vide, sans lever', async () => {
    const fiche = await lireFichePost(pilote({ corps: '' }), 'https://www.linkedin.com/feed/');
    expect(fiche).toEqual({ urn: null, url: 'https://www.linkedin.com/feed/', auteur: null, texte: null, date: null });
  });

  it('ne leve pas quand le navigateur echoue', async () => {
    const fiche = await lireFichePost(pilote({ lever: true }), URL_POST);
    expect(fiche.auteur).toBeNull();
    expect(fiche.texte).toBeNull();
    expect(fiche.urn).toBe(`urn:li:activity:${ID_ACTIVITE}`);
  });

  it('ne lit rien sur une page de friction ou un statut d erreur', async () => {
    const mur = await lireFichePost(pilote({ url: 'https://www.linkedin.com/checkpoint/challenge/x', corps: PAGE_PERSONNE }), URL_POST);
    expect(mur.auteur).toBeNull();
    const erreur = await lireFichePost(pilote({ statut: 404, corps: PAGE_PERSONNE }), URL_POST);
    expect(erreur.auteur).toBeNull();
  });
});

describe('lireFicheDuHtml', () => {
  it('ne leve pas sur du JSON-LD casse', () => {
    const fiche = lireFicheDuHtml('<script type="application/ld+json">{pas du json</script>', URL_POST);
    expect(fiche.auteur).toBeNull();
  });
});
