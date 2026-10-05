/**
 * P2 (lot 2) : une action de l'utilisateur ne recharge plus toute la page.
 *
 * Onze boutons faisaient `window.location.reload()` (jeter tout le travail
 * client, relancer l'authentification comprise) ; une vingtaine de composants
 * enchaînaient `revalidatePath` côté serveur ET `router.refresh()` côté client
 * (deux rendus serveur au lieu d'un). Contrôle statique, même idiome que
 * `app/(app)/page.test.tsx` : lit les sources, ne rend rien.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ici = fileURLToPath(new URL('.', import.meta.url));
const racineWeb = join(ici, '..');

/** Les composants du constat initial (P2) : onze appels, dix fichiers (ZoneReponseFil en portait deux). */
const COMPOSANTS_DU_CONSTAT = [
  'reception/BoutonMarquerTraite.tsx',
  'reception/ZoneReponseFil.tsx',
  'campagne/BoutonReprendre.tsx',
  'campagne/BoutonEcarterContact.tsx',
  'campagne/BoutonReporterEnvoi.tsx',
  'campagne/BoutonReessayer.tsx',
  'campagne/BoutonChercherEmail.tsx',
  'contact/BoutonChercherEmailContact.tsx',
  'contact/BoutonNePlusContacter.tsx',
  'contact/SectionNotes.tsx',
];

function sourcesNonTest(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      if (nom === 'node_modules' || nom === '.next') continue;
      sortie.push(...sourcesNonTest(chemin));
    } else if (/\.(ts|tsx)$/.test(nom) && !/\.test\.(ts|tsx)$/.test(nom)) {
      sortie.push(chemin);
    }
  }
  return sortie;
}

/** Retire les commentaires pour ne juger que le code (un commentaire peut citer l'ancien comportement). */
function code(chemin: string): string {
  return readFileSync(chemin, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('rafraîchissement après mutation (P2)', () => {
  it.each(COMPOSANTS_DU_CONSTAT)("%s n'appelle plus window.location.reload()", (fichier) => {
    expect(code(join(ici, fichier))).not.toMatch(/location\.reload\s*\(/);
  });

  it("aucune source de l'app (composants, pages, actions) ne recharge la page entière", () => {
    const fautifs = sourcesNonTest(racineWeb)
      .filter((f) => /location\.reload\s*\(/.test(code(f)))
      .map((f) => relative(racineWeb, f));
    expect(fautifs).toEqual([]);
  });

  it("aucun composant client n'enchaîne router.refresh() derrière une Server Action (double rendu)", () => {
    const fautifs = sourcesNonTest(join(racineWeb, 'components'))
      .filter((f) => /router\.refresh\s*\(/.test(code(f)))
      .map((f) => relative(racineWeb, f));
    expect(fautifs).toEqual([]);
  });
});
