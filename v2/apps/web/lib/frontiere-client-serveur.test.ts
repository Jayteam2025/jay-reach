/**
 * Un module `'use client'` n'exporte AUCUNE fonction utilisable côté serveur : Next.js la remplace
 * par une référence de client, et l'appeler depuis un composant serveur lève
 * « Attempted to call X() from the server but X is on the client » (digest 2889543129, onglet
 * Posts d'une campagne qui avait au moins un post en attente, 27/10).
 *
 * Vitest n'applique pas cette frontière (il importe tout comme un seul module), donc aucun test
 * de rendu ne peut attraper ce défaut : il ne se voit qu'au build de production. Ce test lit donc
 * les sources : pour chaque module serveur, aucun import (hors `import type`) d'une fonction
 * exportée en minuscule par un module client. Un composant (majuscule) s'importe normalement.
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

/** Les exports en minuscule d'un module client : des fonctions ou valeurs, pas des composants. */
function exportsMinuscules(source: string): string[] {
  const noms = new Set<string>();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let)\s+([a-z][A-Za-z0-9_]*)/gm)) noms.add(m[1]!);
  return [...noms];
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
      for (const m of source.matchAll(/import\s+(?!type\b)\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
        const cible = resoudre(fichier, m[2]!);
        const sourceCible = cible ? sources.get(cible) : undefined;
        if (!cible || sourceCible === undefined || !estClient(sourceCible)) continue;
        const interdits = new Set(exportsMinuscules(sourceCible));
        for (const brut of m[1]!.split(',')) {
          const nom = brut.trim().replace(/^type\s.*$/, '').split(/\s+as\s+/)[0]!.trim();
          if (nom !== '' && interdits.has(nom)) violations.push(`${fichier.replace(`${RACINE}/`, '')} importe ${nom} depuis ${cible.replace(`${RACINE}/`, '')}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
