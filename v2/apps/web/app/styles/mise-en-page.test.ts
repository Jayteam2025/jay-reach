/**
 * La mise en page ne s'adaptait à rien sous 1180 px (recette produit du 18/09,
 * capture prise à ~570 px). Les points de rupture existants ne traitaient que
 * les grilles INTERNES — colonnes secondaires d'un tableau, fiche de la
 * Réception, menu des Réglages — et aucun ne repliait les grilles de PAGE :
 * `.jr-aujourdhui` gardait ses deux colonnes jusqu'en bas, et la File du jour
 * n'avait plus la largeur de son tableau (552 px demandés) — 435 px à 1024 px,
 * soit 125 px coupés et 17 éléments rognés sur le seul écran d'accueil.
 *
 * Contrôle statique (même idiome que `page.test.tsx` et `cles-utilisees.test.ts`) :
 * un point de rupture CSS ne se teste pas en Vitest, qui ne calcule aucune mise
 * en page — jsdom ne connaît ni les media queries ni les largeurs rendues. Ces
 * trois garde-fous couvrent en revanche exactement ce qui se casserait en
 * silence, sans qu'aucun test ne rougisse :
 *  1. le bloc `max-width: 1240px` existe et replie bien les quatre grilles ;
 *  2. il est déclaré APRÈS tous les blocs `max-width: 1440px` — à spécificité
 *     égale, le dernier déclaré l'emporte, et ces blocs s'appliquent aussi sous
 *     1240 px : remonter le nôtre dans le fichier y reposerait leurs deux
 *     colonnes, sans la moindre erreur visible ;
 *  3. les deux colonnes rendues masquables sur la liste des campagnes le
 *     restent (le tableau demande 865 px pour 742 px disponibles à 1024 px ;
 *     les masquer en libère 175).
 *
 * La preuve que la règle fait son travail est empirique et vit dans le
 * commentaire de `composants.css` : mesure DOM réelle à 1024 px, 17 éléments
 * rognés avant, 0 après, relevée écran par écran pendant la recette.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ici = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(ici, 'composants.css'), 'utf8');
const listeCampagnes = readFileSync(join(ici, '..', '(app)', 'campaigns', 'page.tsx'), 'utf8');

/** Les grilles de PAGE, par opposition aux grilles internes déjà traitées à 1180 px. */
const GRILLES_DE_PAGE = ['.jr-aujourdhui', '.jr-contenu', '.jr-moteur-plafonds', '.jr-boite-blocs'];

function blocMedia(source: string, condition: string): string {
  const debut = source.indexOf(`@media (${condition})`);
  if (debut === -1) return '';
  const ouvrante = source.indexOf('{', debut);
  let profondeur = 0;
  for (let i = ouvrante; i < source.length; i += 1) {
    if (source[i] === '{') profondeur += 1;
    else if (source[i] === '}') {
      profondeur -= 1;
      if (profondeur === 0) return source.slice(debut, i + 1);
    }
  }
  return '';
}

describe('mise en page sous 1240 px', () => {
  it('replie les quatre grilles de page en une seule colonne', () => {
    const bloc = blocMedia(css, 'max-width: 1240px');
    expect(bloc, 'le bloc @media (max-width: 1240px) doit exister dans composants.css').not.toBe('');
    for (const grille of GRILLES_DE_PAGE) {
      expect(bloc, `${grille} doit se replier sous 1240 px`).toContain(grille);
    }
    expect(bloc).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('déclare ce bloc après tous les blocs 1440 px, qui l’emporteraient sinon', () => {
    const position1240 = css.indexOf('@media (max-width: 1240px)');
    expect(position1240).toBeGreaterThan(-1);
    const positions1440: number[] = [];
    let curseur = css.indexOf('@media (max-width: 1440px)');
    while (curseur !== -1) {
      positions1440.push(curseur);
      curseur = css.indexOf('@media (max-width: 1440px)', curseur + 1);
    }
    expect(positions1440.length, 'les blocs 1440 px sont attendus dans ce fichier').toBeGreaterThan(0);
    for (const position of positions1440) {
      expect(
        position,
        'un bloc 1440 px déclaré après le bloc 1240 px y reposerait ses deux colonnes',
      ).toBeLessThan(position1240);
    }
  });

  it('garde masquables les deux colonnes secondaires de la liste des campagnes', () => {
    for (const colonne of ['boites', 'activite']) {
      const declaration = new RegExp(`\\{[^}]*cle: '${colonne}'[^}]*\\}`).exec(listeCampagnes)?.[0] ?? '';
      expect(declaration, `la colonne ${colonne} doit être déclarée`).not.toBe('');
      expect(declaration, `la colonne ${colonne} doit rester masquable sous 1180 px`).toContain(
        "classe: 'masquable'",
      );
    }
  });
});
