/**
 * Un squelette doit avoir l'ossature de l'écran qu'il précède, sinon la mise en
 * page saute au remplacement — c'est le reproche remonté en recette et confirmé
 * par l'audit du 05/10 : l'accueil annonçait quatre cartes d'indicateurs puis
 * deux colonnes `1.6fr 1fr` pour un écran qui est une grille `1fr 1fr 320px`, et
 * la liste des campagnes une grille de cartes 2×2 pour ce qui est un tableau.
 * Six écrans de réglages et Contacts affichaient en plus le squelette de
 * l'accueil, faute d'en avoir un.
 *
 * Le correctif tient en une règle : un squelette REPREND LA CLASSE DE MISE EN
 * PAGE de son écran au lieu de la redessiner. Ce test la fait tenir dans le
 * temps, et il attrape les deux façons de la perdre :
 *  1. un squelette qui n'emploie plus la classe de son écran ;
 *  2. un écran sans `loading.tsx`, qui hériterait silencieusement de celui d'un
 *     parent — c'est ainsi que Contacts affichait le squelette de l'accueil.
 *
 * Contrôle statique (même idiome que `page.test.tsx` et `cles-utilisees.test.ts`) :
 * jsdom ne calcule aucune mise en page, donc un rendu ne prouverait rien de plus
 * ici, et les classes sont justement ce qui porte l'ossature.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ici = dirname(fileURLToPath(import.meta.url));
const squelettes = readFileSync(join(ici, 'squelette.tsx'), 'utf8');

/** Les classes qui portent la grille d'un écran (`app/styles/composants.css`). */
const CLASSES_DE_PAGE = ['jr-aujourdhui', 'jr-contenu', 'jr-reception'];

/** Écran, son `loading.tsx`, et le squelette qu'il doit employer. */
const ECRANS = [
  { page: 'page.tsx', chargement: 'loading.tsx', squelette: 'SqueletteTableauDeBord' },
  { page: 'campaigns/page.tsx', chargement: 'campaigns/loading.tsx', squelette: 'SqueletteCampagnes' },
  { page: 'inbox/page.tsx', chargement: 'inbox/loading.tsx', squelette: 'SqueletteReception' },
  { page: 'contacts/page.tsx', chargement: 'contacts/loading.tsx', squelette: 'SqueletteTableauFiltre' },
] as const;

/** Corps d'une fonction exportée de `squelette.tsx`, jusqu'à l'export suivant. */
function corpsDuSquelette(nom: string): string {
  const debut = squelettes.indexOf(`export function ${nom}(`);
  if (debut === -1) return '';
  const suivant = squelettes.indexOf('\nexport function ', debut + 1);
  return squelettes.slice(debut, suivant === -1 ? undefined : suivant);
}

function classesDeMiseEnPage(source: string): string[] {
  return CLASSES_DE_PAGE.filter((classe) => new RegExp(`className="${classe}\\b`).test(source));
}

describe('un squelette a l’ossature de son écran', () => {
  for (const ecran of ECRANS) {
    it(`${ecran.chargement} reprend la grille de ${ecran.page}`, () => {
      const page = readFileSync(join(ici, ecran.page), 'utf8');
      const attendues = classesDeMiseEnPage(page);
      expect(attendues, `${ecran.page} doit porter une classe de mise en page connue`).not.toHaveLength(0);

      const corps = corpsDuSquelette(ecran.squelette);
      expect(corps, `${ecran.squelette} doit exister dans squelette.tsx`).not.toBe('');
      for (const classe of attendues) {
        expect(
          classesDeMiseEnPage(corps),
          `${ecran.squelette} doit employer « ${classe} » comme ${ecran.page}, pas redessiner sa grille`,
        ).toContain(classe);
      }
    });

    it(`${ecran.page} a son propre loading.tsx`, () => {
      const chemin = join(ici, ecran.chargement);
      expect(existsSync(chemin), `sans ce fichier, l’écran hérite du squelette d’un parent`).toBe(true);
      expect(readFileSync(chemin, 'utf8')).toContain(ecran.squelette);
    });
  }

  it('aucun squelette ne redessine une grille de page en style en ligne', () => {
    // `gridTemplateColumns` en dur dans ce fichier = une grille recopiée à la
    // main, donc une divergence en puissance. Les grilles de PAGE viennent des
    // classes ; l'intérieur d'une carte peut rester libre, mais aucune de ces
    // valeurs ne doit ressembler aux grilles de page du CSS.
    const grillesEnDur = squelettes.match(/gridTemplateColumns: '[^']+'/g) ?? [];
    expect(grillesEnDur, `grilles recopiées : ${grillesEnDur.join(', ')}`).toHaveLength(0);
  });
});
