/**
 * Un plafond ne s'affiche JAMAIS par interpolation directe.
 *
 * Constat de recette du 05/10, trouvé écran par écran et non à la lecture du code : Réglages ›
 * Plafonds disait « 0 · plafond à 0 (en pause) » pendant que l'accueil et la fiche de campagne
 * affichaient « 0 / 0 » pour les mêmes nombres. Zéro n'est pas un ratio, c'est la pause voulue
 * (`placesRestantes`, `packages/core/src/plafonds.ts`), et `null` — possible sur les envois,
 * dont le plafond vient de boîtes au `daily_quota` nullable — veut dire « aucune limite réglée ».
 * Un gabarit `${utilise} / ${plafond}` ne sait dire ni l'un ni l'autre.
 *
 * Ce test attrape le motif à la racine : toute composition manuelle d'un « X / plafond » dans un
 * écran. La seule façon correcte est `t('consommation.valeur', parametresValeurConsommation(...))`,
 * qui porte les trois états (`lib/plafonds-affichage.ts`).
 *
 * Contrôle statique, même idiome que `squelette.test.ts` : c'est la FORME du code qui est en
 * cause, et un rendu ne dirait rien des écrans qu'on ajoutera demain.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ici = dirname(fileURLToPath(import.meta.url));

function fichiersDEcran(racine: string): string[] {
  return readdirSync(racine).flatMap((nom) => {
    const chemin = join(racine, nom);
    if (statSync(chemin).isDirectory()) return fichiersDEcran(chemin);
    return /\.tsx$/.test(nom) && !/\.test\.tsx$/.test(nom) ? [chemin] : [];
  });
}

/**
 * Un « / » suivi d'une interpolation qui parle de plafond ou de quota : un ratio composé à la
 * main, que ce soit dans un gabarit (`${…}`) ou dans du JSX (`{…}`). Attrape aussi le repli
 * `?? '∞'` que portait `CarteBoite` — un symbole en dur dans un composant, là où les autres
 * écrans disaient « sans limite ».
 */
const RATIO_COMPOSE = /\/\s*\{+[^}]*(?:plafond|quota)[^}]*\}/gi;

/** Les écrans, plus les composants d'affichage qui montrent ces mêmes nombres. */
const RACINES = [ici, resolve(ici, '../../components')];

describe('aucun écran ne compose un « X / plafond » à la main', () => {
  for (const fichier of RACINES.flatMap(fichiersDEcran)) {
    const source = readFileSync(fichier, 'utf8');
    const fautes = source.match(RATIO_COMPOSE);
    if (!fautes) continue;
    it(`${relative(ici, fichier)} passe par parametresValeurConsommation`, () => {
      expect(
        fautes,
        `un plafond nul y lirait « 0 / 0 » au lieu de « en pause », et un plafond absent « / 0 » au lieu de « sans limite »`,
      ).toBeNull();
    });
  }

  it('le test lui-même voit encore quelque chose (sinon il ne garde rien)', () => {
    expect(RACINES.flatMap(fichiersDEcran).length).toBeGreaterThan(20);
  });
});
