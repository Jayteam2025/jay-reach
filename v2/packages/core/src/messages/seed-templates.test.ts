import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseTemplateTokens, STANDARD_VARIABLES } from './variables.js';

// Garde anti-régression : le seed écrit les templates en SQL direct, donc il
// contourne `validateTemplateVariables` (appelé par l'action serveur et l'écran
// de templates). Un jeton inconnu ne se verrait qu'au 1er tick sur une base
// fraîche, sous la forme d'une action bloquée (`missing_variable`). Ce test lit
// le seed, en extrait les `{{...}}` et vérifie qu'ils sont tous standard.
const seedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/seed.sql');

describe('seed.sql — les templates n’utilisent que des variables standard', () => {
  it('aucun jeton {{...}} inconnu (sinon la campagne de démo bloque au rendu)', () => {
    const seed = readFileSync(seedPath, 'utf8');
    const names = [...new Set(parseTemplateTokens(seed).map((t) => t.name))];
    const unknown = names.filter((n) => STANDARD_VARIABLES[n] === undefined);
    expect(unknown, `jetons inconnus dans seed.sql : ${unknown.join(', ')}`).toEqual([]);
  });
});
