/**
 * « Modifié le aujourd'hui, 09:59 » (défaut de copie relevé en recette le 18/09) : un connecteur
 * (« le »/« on »/« op ») posé en dur devant `{date}` est fautif dès que `{date}` vaut une valeur
 * relative (« aujourd'hui »/« hier »). `plafonds.table.modifieSansAuteur` et
 * `expediteurs.box.createdOn` choisissent maintenant ce connecteur en ICU (`select` sur
 * `estRelatif`) — ce test rend les VRAIS messages des trois langues (pas un faux `t` comme les
 * tests de `lib/*.test.ts`), seule façon de prouver le comportement du `select` lui-même.
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

/** Aucune des deux ne doit jamais laisser passer un connecteur devant une valeur relative. */
const CLES = ['reglages.plafonds.table.modifieSansAuteur', 'reglages.expediteurs.box.createdOn'] as const;
/** Un mot de connexion par langue et par clé, dans l'ordre de `CLES`. */
const CONNECTEURS: Record<(typeof LANGUES)[number], readonly [string, string]> = {
  fr: ['le', 'le'],
  en: ['on', 'on'],
  nl: ['op', 'op'],
};

describe('connecteur devant une date relative (modifieSansAuteur / createdOn)', () => {
  for (const langue of LANGUES) {
    for (const [i, cle] of CLES.entries()) {
      const connecteur = CONNECTEURS[langue][i];

      it(`${langue} · ${cle} · valeur relative -> pas de « ${connecteur} » devant la date`, () => {
        const gabarit = chemin(messages(langue), cle);
        const rendu = new IntlMessageFormat(gabarit, langue).format({
          date: "aujourd'hui, 09:59",
          estRelatif: 'oui',
        }) as string;
        expect(rendu).not.toMatch(new RegExp(`\\b${connecteur}\\b\\s+aujourd'hui`, 'i'));
        expect(rendu).toContain("aujourd'hui, 09:59");
      });

      it(`${langue} · ${cle} · date absolue -> garde le connecteur « ${connecteur} »`, () => {
        const gabarit = chemin(messages(langue), cle);
        const rendu = new IntlMessageFormat(gabarit, langue).format({
          date: '4 sept.',
          estRelatif: 'non',
        }) as string;
        expect(rendu).toMatch(new RegExp(`\\b${connecteur}\\b\\s+4 sept\\.`, 'i'));
      });
    }
  }
});
