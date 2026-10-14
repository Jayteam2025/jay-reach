/**
 * Séquence : l'aperçu d'étape fondait signature et désabonnement dans un seul pavé. Le contenu
 * porte ses sauts de ligne (« …ça vous intéresse.\n\nAlexandre De Clercq\nHEY JAY\n\nSi vous
 * préférez… »), mais `div.apercu` gardait `white-space: normal`, qui les écrase. La Réception
 * rend le même texte avec `.jr-message .corps { white-space: pre-line }` : l'aperçu s'aligne
 * sur cette règle plutôt que d'en inventer une. Un rendu CSS ne se mesure pas en Vitest
 * (jsdom n'applique pas la mise en page) : contrôle statique de la déclaration.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'composants.css'), 'utf8');

function whiteSpaceDe(selecteur: string): string | null {
  const ligne = css.split('\n').find((l) => l.startsWith(`${selecteur} {`));
  return ligne?.match(/white-space:\s*([a-z-]+)/)?.[1] ?? null;
}

describe('aperçu d’étape de la Séquence', () => {
  it('conserve les sauts de ligne comme le corps de message de la Réception', () => {
    const reception = whiteSpaceDe('.jr-message .corps');
    expect(reception).toBe('pre-line');
    expect(whiteSpaceDe('.jr-etape .carte .apercu')).toBe(reception);
  });
});
