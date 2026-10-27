/**
 * Un module `'use client'` n'exporte AUCUNE fonction utilisable côté serveur : Next.js la remplace
 * par une référence de client, et l'appeler depuis un composant serveur lève
 * « Attempted to call X() from the server but X is on the client » (digest 2889543129, onglet
 * Posts d'une campagne qui avait au moins un post en attente, 27/10).
 *
 * Vitest n'applique pas cette frontière (il importe tout comme un seul module), donc aucun test
 * de rendu ne peut attraper ce défaut : il ne se voit qu'au build de production. Ce test lit donc
 * les sources : pour chaque module serveur, aucun import (hors `import type`) d'un export non-composant (fonction, constante, quelle que soit la casse)
 * d'un module client. Un composant PascalCase s'importe normalement. Un import par défaut seul est
 * tenu pour un composant.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINE = resolve(__dirname, '..');
const DOSSIERS = ['app', 'components', 'lib'];

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return nom === 'node_modules' || nom === '.next' ? [] : fichiers(chemin);
    return /\.(ts|tsx)$/.test(nom) && !/\.test\.tsx?$/.test(nom) ? [chemin] : [];
  });
}

const EST_CLIENT = /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['"]use client['"]/;

function estClient(source: string): boolean {
  return EST_CLIENT.test(source);
}

/** Un composant : PascalCase avec au moins une minuscule. `MAX_X` (constante) n'en est pas un. */
function estComposant(nom: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(nom) && /[a-z]/.test(nom);
}

/**
 * Les exports d'un module client qui ne sont PAS des composants : fonctions, constantes, classes,
 * quelle que soit la casse (`ligneValidable`, `MAX_X`), y compris `export { x, y as z }`. Les types
 * (`export type`, `export interface`) s'effacent à la compilation et ne comptent pas.
 */
function exportsNonComposants(source: string): Set<string> {
  const noms = new Set<string>();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) noms.add(m[1]!);
  for (const m of source.matchAll(/^export\s+(?!type\b)\{([^}]*)\}/gm)) {
    for (const brut of m[1]!.split(',')) {
      const nom = brut.trim().replace(/^type\s.*$/, '').split(/\s+as\s+/).pop()!.trim();
      if (nom !== '') noms.add(nom);
    }
  }
  return new Set([...noms].filter((n) => !estComposant(n)));
}

function resoudre(depuis: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(depuis), spec);
  for (const c of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    try {
      statSync(c);
      return c;
    } catch {
      /* suivant */
    }
  }
  return null;
}

describe('la frontière client / serveur', () => {
  const tous = DOSSIERS.flatMap((d) => fichiers(join(RACINE, d)));
  const sources = new Map(tous.map((f) => [f, readFileSync(f, 'utf8')]));

  it('aucun module serveur n\'importe une fonction exportée par un module client', () => {
    const violations: string[] = [];
    for (const [fichier, source] of sources) {
      if (estClient(source)) continue;
      for (const m of source.matchAll(/import\s+(?!type\b)(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
        const cible = resoudre(fichier, m[2]!);
        const sourceCible = cible ? sources.get(cible) : undefined;
        if (!cible || sourceCible === undefined || !estClient(sourceCible)) continue;
        const interdits = exportsNonComposants(sourceCible);
        for (const brut of m[1]!.split(',')) {
          // Un spécificateur `type Foo` (import de type en ligne) s'efface à la compilation : on l'ignore.
          const nom = brut.trim().replace(/^type\s.*$/, '').split(/\s+as\s+/)[0]!.trim();
          if (nom !== '' && interdits.has(nom)) violations.push(`${fichier.replace(`${RACINE}/`, '')} importe ${nom} depuis ${cible.replace(`${RACINE}/`, '')}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
