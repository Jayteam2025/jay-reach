/**
 * Chaque message de traduction doit compiler en ICU.
 *
 * next-intl passe tous les messages par un formateur ICU, où les accolades ont
 * un sens : `{nom}` est un paramètre. Un message qui en contient sans les
 * échapper ne compile pas — et next-intl affiche alors le chemin de la clé à
 * l'écran, sans rien signaler ailleurs.
 *
 * C'est arrivé sur deux placeholders qui montraient une variable de message
 * (`Bonjour {{prenom}},`) : l'écran d'étape de campagne affichait
 * « campaigns.stepEd.bodyPlaceholder ». Le contrôle d'existence des clés ne le
 * voyait pas, puisque la clé existait bel et bien.
 *
 * Forme correcte : `'{{'prenom'}}'` rend « {{prenom}} ».
 */
import { describe, it, expect } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const LANGUES = ['fr', 'en', 'nl'] as const;

function messagesPlats(langue: string): [string, string][] {
  const json = JSON.parse(
    readFileSync(join(RACINE, `packages/i18n/src/messages/${langue}.json`), 'utf8'),
  ) as Record<string, unknown>;
  const out: [string, string][] = [];
  const parcours = (o: Record<string, unknown>, prefixe = ''): void => {
    for (const [k, v] of Object.entries(o)) {
      const chemin = prefixe ? `${prefixe}.${k}` : k;
      if (typeof v === 'string') out.push([chemin, v]);
      else if (v && typeof v === 'object') parcours(v as Record<string, unknown>, chemin);
    }
  };
  parcours(json);
  return out;
}

describe('messages de traduction', () => {
  it.each(LANGUES)('%s : tous compilent en ICU', (langue) => {
    const invalides: string[] = [];
    for (const [chemin, valeur] of messagesPlats(langue)) {
      try {
        new IntlMessageFormat(valeur, langue);
      } catch (err) {
        invalides.push(`${chemin} : ${valeur} → ${(err as Error).message.split('\n')[0]}`);
      }
    }
    expect(invalides).toEqual([]);
  });
});
