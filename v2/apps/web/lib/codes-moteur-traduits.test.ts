import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CODES_EVENEMENT, CODES_NOM_ETAPE } from '@jay-reach/core';

/**
 * Le cœur renvoie des CODES (#181) ; l'écran les traduit. Ajouter un code côté cœur sans sa traduction dans
 * les trois langues afficherait le chemin brut de la clé : ce test le rend rouge.
 */
const LANGUES = ['fr', 'en', 'nl'] as const;

function catalogue(langue: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../../../packages/i18n/src/messages/${langue}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
}
function lire(racine: Record<string, unknown>, chemin: string): unknown {
  return chemin.split('.').reduce<unknown>((n, p) => (typeof n === 'object' && n !== null ? (n as Record<string, unknown>)[p] : undefined), racine);
}

describe('codes du moteur traduits en fr, en et nl (#181)', () => {
  for (const langue of LANGUES) {
    const messages = catalogue(langue);
    it(`${langue} : chaque code de nom d’étape a sa traduction`, () => {
      for (const code of CODES_NOM_ETAPE) {
        expect(typeof lire(messages, `campagne.sequence.nomEtape.${code}`), `${langue} ${code}`).toBe('string');
      }
    });
    it(`${langue} : chaque code d’événement du journal a son libellé et son détail`, () => {
      for (const code of CODES_EVENEMENT) {
        expect(typeof lire(messages, `campagne.fiche.history.codes.${code}.libelle`), `${langue} ${code} libelle`).toBe('string');
        expect(typeof lire(messages, `campagne.fiche.history.codes.${code}.detail`), `${langue} ${code} detail`).toBe('string');
      }
    });
  }
});
