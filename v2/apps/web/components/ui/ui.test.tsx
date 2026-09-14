import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar, Puce, Table, TuileLogo } from './index';

describe('kit', () => {
  it('Avatar : initiales quand pas de photo', () => {
    const html = renderToStaticMarkup(<Avatar nom="Claire Moreau" canal="email" />);
    expect(html).toContain('CM');
    expect(html).toContain('jr-canal em');
  });
  it('TuileLogo : la marque linkedin reprend la tuile bleue du kit (svg inliné, pas de <img>)', () => {
    const html = renderToStaticMarkup(<TuileLogo marque="linkedin" />);
    expect(html).toContain('jr-tuile-logo li');
    expect(html).toContain('<svg');
    expect(html).not.toContain('<img');
  });
  it('Puce : ton bon', () => {
    // Le texte est passé en expression ({'Active'}) : le kit interdit tout
    // texte JSX en dur (règle i18next/no-literal-string, apps/web/**/*.tsx),
    // même dans un test — le rendu est strictement identique.
    expect(renderToStaticMarkup(<Puce ton="bon" point>{'Active'}</Puce>)).toContain('jr-puce bon');
  });
  it('Table : colonnes bornées', () => {
    const html = renderToStaticMarkup(
      <Table colonnes={[{ cle: 'a', titre: 'A' }]} lignes={[{ a: 'x'.repeat(300) }]} />,
    );
    expect(html).toContain('jr-table');
  });
});

// La feuille de styles du kit vit dans apps/web/app/styles ; on la lit telle
// qu'elle sera servie, sans jamais la modifier depuis les tests.
const composants = readFileSync(
  fileURLToPath(new URL('../../app/styles/composants.css', import.meta.url)),
  'utf-8',
);

describe('composants.css', () => {
  it("ne contient aucune couleur hexadécimale (les jetons vivent dans jetons.css)", () => {
    expect(composants).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("n'écrit jamais 1fr nu : c'est toujours le second argument d'un minmax(...)", () => {
    const sansMinmax = composants.replace(/minmax\([^)]*\)/g, '');
    expect(sansMinmax).not.toMatch(/1fr/);

    const appels = composants.match(/minmax\([^)]*\)/g) ?? [];
    for (const appel of appels) {
      if (appel.includes('1fr')) {
        expect(appel).toMatch(/,\s*1fr\)$/);
      }
    }
  });
});
