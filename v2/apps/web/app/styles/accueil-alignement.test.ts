/**
 * Le haut de l'écran Aujourd'hui tient dans la même grille que le reste.
 *
 * Deux défauts mesurés le 14/10, tous deux invisibles à la lecture d'un seul fichier :
 *
 * 1. La liste de démarrage et les bandeaux d'alerte étaient posés avant `.jr-entete-page`, sans
 *    rien pour porter le retrait horizontal. Ils commençaient 28 px à gauche du titre et de la
 *    grille, qui portent tous deux `padding: 22px 28px`.
 * 2. La carte de démarrage n'avait aucune marge intérieure. Par convention du dépôt, `.jr-carte`
 *    est un cadre nu : ce sont `> h3` et `.jr-corps` qui portent le retrait. Le titre touchait
 *    donc le filet, et la liste, qui portait sa propre bordure, doublait celui de la carte.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./composants.css', import.meta.url), 'utf8');
const ecran = readFileSync(new URL('../(app)/page.tsx', import.meta.url), 'utf8');

/** Le corps de la dernière déclaration d'un sélecteur, sans les règles sous media query. */
function regle(selecteur: string): string {
  const motif = new RegExp(`^${selecteur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const corps = css.match(motif)?.[1];
  if (corps === undefined) throw new Error(`règle introuvable : ${selecteur}`);
  return corps;
}

/** Le retrait horizontal d'un `padding` écrit en raccourci (`a b`, `a b c`, `a b c d`). */
function retraitHorizontal(corps: string): string {
  const declaration = corps.match(/(?:^|;)\s*padding:\s*([^;]+)/)?.[1];
  if (declaration === undefined) throw new Error(`pas de padding dans : ${corps.trim()}`);
  const parts = declaration.trim().split(/\s+/);
  // `padding: a` s'applique aux quatre côtés ; au-delà, le second terme porte l'horizontal.
  const horizontal = parts.length === 1 ? parts[0] : parts[1];
  if (horizontal === undefined) throw new Error(`padding illisible : ${declaration}`);
  return horizontal;
}

describe("le haut de l'écran Aujourd'hui", () => {
  it('aligne la liste de démarrage et les alertes sur la grille de la page', () => {
    const grille = retraitHorizontal(regle('.jr-aujourdhui'));
    expect(retraitHorizontal(regle('.jr-entete-page'))).toBe(grille);
    expect(retraitHorizontal(regle('.jr-tete-accueil'))).toBe(grille);
  });

  it('enveloppe la liste et les bandeaux dans ce conteneur, sans style posé à la main', () => {
    expect(ecran).toContain('jr-tete-accueil');
    // Le `marginBottom` inline sous chaque bandeau était une exception au design system : c'est
    // l'espacement du conteneur qui le porte.
    expect(ecran).not.toMatch(/style=\{\{\s*marginBottom/);
  });

  it('donne à la carte de démarrage la marge intérieure des cartes', () => {
    const carte = retraitHorizontal(regle('.jr-carte > h3, .jr-carte-h'));
    expect(retraitHorizontal(regle('.jr-demarrage-entete'))).toBe(carte);
    expect(retraitHorizontal(regle('.jr-demarrage-ligne'))).toBe(carte);
  });

  it('ne double pas le filet de la carte avec celui de la liste', () => {
    const liste = regle('.jr-demarrage-liste');
    // Une bordure complète sur la liste vient se coller à celle de la carte : deux traits de 1 px.
    expect(liste).not.toMatch(/(?:^|;)\s*border:\s*1px/);
  });
});
