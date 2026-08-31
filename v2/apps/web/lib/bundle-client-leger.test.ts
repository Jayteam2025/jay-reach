import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Aucun composant client n'importe le baril de `@jay-reach/core`.
 *
 * `packages/core/src/index.ts` réexporte dix-huit modules : le scoring, la
 * chaîne d'enrichissement, la résolution d'entreprise, zod. Un écran qui n'en
 * veut qu'une constante de nommage tirait tout dans le navigateur — quinze
 * kilo-octets de code serveur, sur quatre écrans, mesurés au build.
 *
 * Le bundler ne peut pas l'élaguer seul : pour prouver qu'un module du baril
 * n'a pas d'effet de bord, il doit tous les lire, et il renonce. La règle est
 * donc d'importer par le chemin du module (`@jay-reach/core/messages/variables.js`),
 * ce que l'`exports` du paquet autorise depuis le 31/08/2026.
 *
 * Sans ce test, un import ajouté par réflexe rétablit le poids sans que rien
 * ne le signale : le build passe, la page est simplement plus lourde.
 *
 * Les composants serveur ne sont pas concernés — chez eux, le baril ne coûte
 * rien puisque le code ne quitte jamais le serveur.
 */

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function fichiersTsx(depuis: string): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(depuis)) {
    if (entree === 'node_modules' || entree === '.next') continue;
    const chemin = join(depuis, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiersTsx(chemin));
    else if (entree.endsWith('.tsx')) trouves.push(chemin);
  }
  return trouves;
}

describe('poids du bundle client', () => {
  it("aucun composant client n'importe le baril de core", () => {
    const fautifs = fichiersTsx(join(RACINE, 'app'))
      .filter((f) => {
        const source = readFileSync(f, 'utf8');
        return source.startsWith("'use client'") && /from '@jay-reach\/core'/.test(source);
      })
      .map((f) => relative(RACINE, f));

    expect(fautifs, `importer par le chemin du module, pas par '@jay-reach/core'`).toEqual([]);
  });
});
