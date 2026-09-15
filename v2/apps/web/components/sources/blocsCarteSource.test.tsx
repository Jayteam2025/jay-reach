import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SourceCarte } from '@jay-reach/core';
import fr from '@jay-reach/i18n/messages/fr.json';
import { construireBlocsOffres, sousTitreDe } from './blocsCarteSource';

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

function carteDeBase(overrides: Partial<SourceCarte> = {}): SourceCarte {
  return {
    id: 'src-1',
    providerId: 'france_travail',
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
      quand: new Date(2026, 8, 15, 9, 0, 0).toISOString(),
      lus: 58,
      retenus: 6,
      ignores: 52,
    },
    prochainPassage: new Date(2026, 8, 16, 9, 0, 0).toISOString(),
    retenus7j: [0, 0, 0, 0, 0, 0, 6],
    collecteDisponible: true,
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

describe('construireBlocsOffres', () => {
  const t = fabriquerT();

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
});
