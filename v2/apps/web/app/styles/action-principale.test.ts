/**
 * Une seule couleur d'action principale.
 *
 * Relevé le 14/10 : « Nouvelle campagne » était vert sur l'accueil et noir sur la liste des
 * campagnes. Le même acte, au même niveau d'importance, changeait de couleur selon l'écran d'où
 * on le déclenchait — le lecteur ne pouvait plus apprendre ce que signifie un bouton plein.
 *
 * La variante `sombre` ne servait qu'à trois endroits, tous l'action principale de leur zone, face
 * à `principal` partout ailleurs : c'était l'exception, pas une seconde famille. Elle est retirée,
 * et avec elle la possibilité de rouvrir le débat écran par écran.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const racine = fileURLToPath(new URL('../..', import.meta.url));

/** Tous les fichiers de composant du projet, hors dépendances et build. */
function sources(dossier: string, trouves: string[] = []): string[] {
  for (const entree of readdirSync(join(racine, dossier), { withFileTypes: true })) {
    if (entree.name === 'node_modules' || entree.name.startsWith('.')) continue;
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) sources(chemin, trouves);
    else if (/\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name)) trouves.push(chemin);
  }
  return trouves;
}

const fichiers = [...sources('app'), ...sources('components')];
const lire = (f: string) => readFileSync(join(racine, f), 'utf8');

describe("la couleur d'une action principale", () => {
  it('est la même sur les deux écrans qui créent une campagne', () => {
    const classe = (f: string) => lire(f).match(/className="(jr-bouton[^"]*)">\s*\{t\('[^']*(?:newCampaign|list\.new)'\)/)?.[1];
    const accueil = classe('app/(app)/page.tsx');
    const liste = classe('app/(app)/campaigns/page.tsx');
    expect(accueil, "accueil : bouton de création introuvable").toBeDefined();
    expect(liste, "liste des campagnes : bouton de création introuvable").toBeDefined();
    expect(liste).toBe(accueil);
  });

  it("n'offre plus de seconde famille de bouton plein", () => {
    const coupables = fichiers.filter((f) => /\bsombre\b/.test(lire(f)));
    expect(coupables, `la variante « sombre » subsiste dans : ${coupables.join(', ')}`).toEqual([]);
    expect(readFileSync(new URL('./composants.css', import.meta.url), 'utf8')).not.toContain('.jr-bouton.sombre');
  });
});
