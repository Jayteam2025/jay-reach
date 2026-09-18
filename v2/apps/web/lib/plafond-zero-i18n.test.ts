/**
 * « 300 / 0 » et « 0 par jour absorbent une dizaine de passages » (défauts de copie relevés en
 * recette le 18/09, Réglages › Plafonds) : un plafond nul vaut pause (`placesRestantes`,
 * `packages/core/src/plafonds.ts` — « Un plafond nul, negatif ou invalide vaut pause : zero
 * place »), jamais une limite illimitée. `consommation.valeur` et `protection.scoringTexte` le
 * disent maintenant en ICU (`select` sur `enPause`) au lieu d'un ratio ou d'une phrase devenus
 * absurdes — ce test rend les VRAIS messages des trois langues, seule façon de prouver le
 * comportement du `select` lui-même.
 */
import { describe, it, expect } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const LANGUES = ['fr', 'en', 'nl'] as const;

function messages(langue: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(RACINE, `packages/i18n/src/messages/${langue}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}

function chemin(o: Record<string, unknown>, cle: string): string {
  const valeur = cle.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], o);
  if (typeof valeur !== 'string') throw new Error(`clé absente ou non textuelle : ${cle}`);
  return valeur;
}

describe('plafond à 0 (Réglages › Plafonds)', () => {
  for (const langue of LANGUES) {
    it(`${langue} · consommation.valeur · plafond nul -> pas de « / 0 »`, () => {
      const gabarit = chemin(messages(langue), 'reglages.plafonds.consommation.valeur');
      const rendu = new IntlMessageFormat(gabarit, langue).format({ utilise: 300, plafond: 0, enPause: 'oui' }) as string;
      expect(rendu).not.toMatch(/\/\s*0\b/);
      expect(rendu).toContain('300');
    });

    it(`${langue} · consommation.valeur · plafond positif -> garde le ratio`, () => {
      const gabarit = chemin(messages(langue), 'reglages.plafonds.consommation.valeur');
      const rendu = new IntlMessageFormat(gabarit, langue).format({ utilise: 128, plafond: 300, enPause: 'non' }) as string;
      expect(rendu).toContain('128');
      expect(rendu).toContain('300');
      expect(rendu).toMatch(/128\s*\/\s*300/);
    });

    it(`${langue} · protection.scoringTexte · plafond nul -> ne dit plus « 0 par jour »`, () => {
      const gabarit = chemin(messages(langue), 'reglages.plafonds.protection.scoringTexte');
      const rendu = new IntlMessageFormat(gabarit, langue).format({ plafond: 0, enPause: 'oui' }) as string;
      expect(rendu).not.toMatch(/\b0\b.*(par jour|per day|per dag)/i);
    });

    it(`${langue} · protection.scoringTexte · plafond positif -> garde la phrase d'origine`, () => {
      const gabarit = chemin(messages(langue), 'reglages.plafonds.protection.scoringTexte');
      const rendu = new IntlMessageFormat(gabarit, langue).format({ plafond: 300, enPause: 'non' }) as string;
      expect(rendu).toContain('300');
    });
  }
});
