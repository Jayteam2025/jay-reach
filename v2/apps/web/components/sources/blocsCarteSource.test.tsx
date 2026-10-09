import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BilanCollecte, SourceCarte } from '@jay-reach/core';
import fr from '@jay-reach/i18n/messages/fr.json';
import { construireBlocsLinkedIn, construireBlocsOffres, marquesDe, sousTitreDe } from './blocsCarteSource';

/**
 * Traducteur factice : lit les vraies chaînes de `campagne.sources` dans
 * `fr.json` et interpole les `{placeholder}` simples (pas la syntaxe ICU
 * `plural`, non nécessaire ici) — assez pour vérifier qu'on obtient bien
 * « Une fois par jour » plutôt qu'un texte réinventé dans le test.
 */
function fabriquerT() {
  const sources = (fr as { campagne: { sources: Record<string, unknown> } }).campagne.sources;
  return ((cle: string, valeurs?: Record<string, unknown>) => {
    let texte = cle.split('.').reduce<unknown>((node, part) => {
      return typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
    }, sources);
    if (typeof texte !== 'string') return cle;
    for (const [k, v] of Object.entries(valeurs ?? {})) {
      texte = (texte as string).replaceAll(`{${k}}`, String(v));
    }
    return texte as string;
  }) as unknown as Parameters<typeof construireBlocsOffres>[1];
}

/**
 * `heureAvecJour` (appelée par `construireBlocsOffres`, sans `maintenant`
 * explicite) compare l'horloge figée par `vi.useFakeTimers` (ci-dessous) au
 * jour calendaire de chaque instant, DANS `Europe/Paris` (fuseau par défaut
 * de `heureAvecJour`, R67) — jamais dans le fuseau du PROCESS qui exécute le
 * test. Toutes les dates de cette fixture sont donc des ISO UTC explicites
 * (`Z`), jamais `new Date(année, mois, jour, heure, …)` : cette dernière
 * construit un instant dans le fuseau LOCAL du process, un chiffre d'heure
 * identique désignant alors un instant réel différent selon que le test
 * tourne sous `TZ=Europe/Paris` ou `TZ=UTC` — exactement l'ambiguïté que ce
 * correctif élimine.
 */
function carteDeBase(overrides: Partial<SourceCarte> = {}): SourceCarte {
  return {
    id: 'src-1',
    providerId: 'france_travail',
    providerIds: ['france_travail'],
    nom: 'France Travail',
    // Config réelle constatée sur la base OSS (campagne « Directeur commercial »,
    // tour de correction 2) : clés du worker uniquement.
    config: {
      keywords: ['commercial', 'sales'],
      location: 'Île-de-France, Lyon',
      exclude_keywords: ['stagiaire'],
      scoring_prompt: 'Instructions détaillées…',
      match_threshold: 60,
    },
    schedule: 'daily',
    active: true,
    dernierPassage: {
      quand: '2026-09-15T07:00:00.000Z', // 09:00 Paris le 15 (même jour que « maintenant », 10:00 Paris)
      lus: 58,
      retenus: 6,
      ignores: 52,
    },
    prochainPassage: '2026-09-16T07:00:00.000Z', // 09:00 Paris le 16 -> « demain 09:00 »
    retenus7j: [0, 0, 0, 0, 0, 0, 6],
    totalLu: 312,
    premierPassage: '2026-09-01T06:00:00.000Z', // 08:00 Paris le 1er
    derniereCollecte: null,
    collecteDisponible: true,
    campagneActive: true,
    ...overrides,
  };
}

describe('sousTitreDe', () => {
  const t = fabriquerT();

  it('lit les lieux via configFormulaireDepuisStockee (config réelle, clés worker)', () => {
    expect(sousTitreDe(carteDeBase(), t)).toBe('Île-de-France, Lyon');
  });

  it('« France entière » plutôt qu’un tiret seul sans lieu', () => {
    const carte = carteDeBase({ config: { keywords: ['commercial'] } });
    expect(sousTitreDe(carte, t)).toBe('France entière');
  });
});

describe('marquesDe', () => {
  it('une tuile par fournisseur réel, dans l’ordre déjà posé par le core (R44)', () => {
    expect(marquesDe(['france_travail', 'adzuna'])).toEqual(['francetravail', 'adzuna']);
    expect(marquesDe(['adzuna'])).toEqual(['adzuna']);
  });
});

describe('construireBlocsOffres', () => {
  const t = fabriquerT();

  // `heureAvecJour` (apps/web/lib/dates.ts) compare `carte.prochainPassage` à
  // `new Date()` par défaut (`construireBlocsOffres` ne lui passe pas de
  // `maintenant`) : sans horloge figée, le test devient faux un jour après
  // avoir été écrit — le « prochain » du 16/09 n'est « demain » que vu du
  // 15/09. Figée à 10:00 Paris le 15/09 (après le « dernier passage » de la
  // fixture, 09:00 le même jour), jamais après le code de production. ISO UTC
  // explicite (`Z`), pas `new Date(année, mois, jour, …)` : un instant fixé en
  // heure LOCALE désignerait un moment réel différent selon le fuseau du
  // process qui exécute le test (R67).
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-09-15T08:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('les intitulés de la config réelle apparaissent en puces (Requête)', () => {
    const [requete] = construireBlocsOffres(carteDeBase(), t);
    const html = renderToStaticMarkup(<>{requete!.contenu}</>);
    expect(html).toContain('commercial');
    expect(html).toContain('sales');
  });

  it('les exclusions de la config réelle apparaissent en puces (Filtres)', () => {
    const [, filtres] = construireBlocsOffres(carteDeBase(), t);
    const html = renderToStaticMarkup(<>{filtres!.contenu}</>);
    expect(html).toContain('stagiaire');
  });

  it('cadence « daily » -> « Une fois par jour », et prochain ≠ dernier', () => {
    const [, , passages] = construireBlocsOffres(carteDeBase(), t);
    const html = renderToStaticMarkup(<>{passages!.contenu}</>);
    expect(html).toContain('Une fois par jour');
    expect(html).not.toContain('Toutes les 24 heures');
    // Dernier passage : 09:00 le 15 ; prochain : 09:00 le 16 -> « demain 09:00 »,
    // jamais la même heure nue que le dernier.
    expect(html).toContain('demain 09:00');
    expect(html).not.toMatch(/dernier 09:00.*prochain 09:00(?!.*demain)/);
  });

  it('R72 : une source active sans AUCUNE campagne rattachée active annonce « au lancement », jamais l’heure calculée', () => {
    const [, , passages] = construireBlocsOffres(carteDeBase({ campagneActive: false }), t);
    const html = renderToStaticMarkup(<>{passages!.contenu}</>);
    expect(html).toContain('au lancement');
    expect(html).not.toContain('demain 09:00');
  });

  it('une source active avec une campagne rattachée active continue d’annoncer l’heure calculée', () => {
    const [, , passages] = construireBlocsOffres(carteDeBase({ campagneActive: true }), t);
    const html = renderToStaticMarkup(<>{passages!.contenu}</>);
    expect(html).toContain('demain 09:00');
    expect(html).not.toContain('au lancement');
  });
});

describe('construireBlocsLinkedIn : une source d’engageurs', () => {
  const t = fabriquerT();
  const bilan: BilanCollecte = {
    quand: '2026-09-15T07:00:00.000Z',
    statut: 'error',
    erreur: 'La session LinkedIn n’est pas active : reconnectez le compte.',
    requetes: 0,
    vus: 0,
    nouveaux: 0,
    doublons: 0,
    dejaEnCampagne: 0,
    ecartes: 0,
    ignores: 0,
    opposes: 0,
    adressesDeduites: 0,
    plafondPersonnesAtteint: false,
  };
  const engageurs = (o: Partial<SourceCarte> = {}) =>
    carteDeBase({ providerId: 'linkedin_post_engagers', providerIds: ['linkedin_post_engagers'], config: { urlPost: 'https://x' }, ...o });
  const rendu = (carte: SourceCarte) =>
    construireBlocsLinkedIn(carte, t)
      .map((b) => renderToStaticMarkup(<>{b.contenu}</>))
      .join('|');

  it('annonce « à la demande », jamais une cadence que rien n’applique', () => {
    const html = rendu(engageurs({ schedule: 'every 6h' }));
    expect(html).toContain('À la demande');
    expect(html).not.toContain('Toutes les 6 heures');
  });

  it('affiche la cause d’un passage qui n’a rien produit : c’est le seul endroit où l’opérateur la lit', () => {
    const html = rendu(engageurs({ derniereCollecte: bilan }));
    expect(html).toContain('La session LinkedIn n’est pas active');
    expect(html).toContain('arrêté');
  });

  it('un passage réussi qui s’est arrêté sur un plafond n’est pas rendu comme une erreur', () => {
    const html = rendu(engageurs({ derniereCollecte: { ...bilan, statut: 'success', erreur: 'Plafond de personnes par passage atteint.' } }));
    expect(html).toContain('Plafond de personnes par passage atteint.');
    expect(html).not.toContain('jr-texte-erreur');
  });

  it('un passage arrêté sans rien avoir vu n’affiche que sa cause, aucun compteur à zéro', () => {
    const html = rendu(engageurs({ derniereCollecte: bilan }));
    expect(html).toContain('La session LinkedIn n’est pas active');
    expect(html).not.toContain('par le scoring');
    expect(html).not.toContain('sans adresse publique');
  });

  it('un passage qui a vu des personnes montre ses compteurs', () => {
    const html = rendu(engageurs({ derniereCollecte: { ...bilan, statut: 'success', erreur: null, vus: 12, nouveaux: 12 } }));
    expect(html).toContain('par le scoring');
    expect(html).toContain('sans adresse publique');
  });

  it('l’adresse du post tient sur une ligne, avec l’adresse complète au survol', () => {
    const html = rendu(engageurs());
    expect(html).toContain('class="jr-url-tronquee"');
    expect(html).toContain('title="https://x"');
  });

  it('une adresse qui n’est pas en https n’est jamais un lien', () => {
    const html = rendu(engageurs({ config: { urlPost: 'javascript:alert(1)' } }));
    expect(html).not.toContain('<a ');
  });

  it('sans passage : « Jamais lancé »', () => {
    expect(rendu(engageurs())).toContain('Jamais lancé');
  });
});

describe('le sous-titre d’une source « posts d’un concurrent »', () => {
  const carte = (config: Record<string, unknown>) =>
    ({ providerId: 'linkedin_competitor_posts', config }) as unknown as SourceCarte;

  // Elle n'a plus de `compteId` : la carte affichait un tiret la ou l'operateur attend de voir
  // QUI il suit. Mesure sur la premiere source reelle.
  it('nomme les pages suivies, pas un tiret', () => {
    expect(sousTitreDe(carte({ pagesConcurrentes: ['https://www.linkedin.com/company/une-page/'] }), fabriquerT())).toBe('une-page');
  });

  it('les nomme toutes quand il y en a plusieurs', () => {
    const s = sousTitreDe(
      carte({ pagesConcurrentes: ['https://www.linkedin.com/company/une-page/', 'linkedin.com/showcase/une-vitrine'] }),
      fabriquerT(),
    );
    expect(s).toBe('une-page, une-vitrine');
  });

  it('une source sans page garde le tiret', () => {
    expect(sousTitreDe(carte({ pagesConcurrentes: [] }), fabriquerT())).toBe('—');
  });
});
