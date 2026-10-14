import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TexteTronque } from './TexteTronque';

const racine = fileURLToPath(new URL('../..', import.meta.url));

function sources(dossier: string, trouves: string[] = []): string[] {
  for (const entree of readdirSync(join(racine, dossier), { withFileTypes: true })) {
    if (entree.name === 'node_modules' || entree.name.startsWith('.')) continue;
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) sources(chemin, trouves);
    else if (/\.tsx$/.test(entree.name) && !/\.test\.tsx$/.test(entree.name)) trouves.push(chemin);
  }
  return trouves;
}

describe('TexteTronque', () => {
  it("reprend le texte complet dans l'infobulle", () => {
    const long = 'Regional Sales Manager | Team Leadership | Grands comptes industriels';
    const html = renderToStaticMarkup(<TexteTronque>{long}</TexteTronque>);
    expect(html).toContain(`title="${long}"`);
    expect(html).toContain('class="jr-tronque"');
  });

  it('accepte une balise et des classes du produit', () => {
    // Le texte passe par une variable : la règle i18n du dépôt refuse toute chaîne écrite
    // directement dans du JSX, y compris en test.
    const nom = 'Alexandre De Clercq';
    const html = renderToStaticMarkup(
      <TexteTronque balise="b" className="jr-petit">
        {nom}
      </TexteTronque>,
    );
    expect(html).toBe(`<b class="jr-petit jr-tronque" title="${nom}">${nom}</b>`);
  });

  // La raison d'être du composant : la classe seule laissait le texte coupé sans recours, et
  // c'est arrivé aux trois endroits qui l'utilisaient.
  it('est le seul moyen de tronquer un texte', () => {
    const coupables = [...sources('app'), ...sources('components')]
      .filter((f) => f !== join('components', 'ui', 'TexteTronque.tsx'))
      .filter((f) => /className="[^"]*jr-tronque/.test(readFileSync(join(racine, f), 'utf8')));
    expect(coupables, `jr-tronque posé à la main dans : ${coupables.join(', ')}`).toEqual([]);
  });
});
