/**
 * Toute cible se vise : 24 x 24 px au minimum (WCAG 2.2, critère 2.5.8).
 *
 * Mesuré le 14/10 sur l'app déployée : les filtres en pastille de la Réception et de la liste des
 * campagnes faisaient 23 px de haut, et les 51 liens de nom de la liste des contacts 17 px.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./composants.css', import.meta.url), 'utf8');

describe('la taille des cibles', () => {
  it('relève les pastilles cliquables sans toucher aux étiquettes', () => {
    expect(css).toMatch(/a\.jr-puce,\s*button\.jr-puce\s*\{[^}]*min-height:\s*24px/);
    // L'étiquette n'est pas une cible : sa règle de base ne porte pas de hauteur minimale.
    const base = css.match(/^\.jr-puce \{([^}]*)\}/m)?.[1];
    expect(base, 'règle .jr-puce introuvable').toBeDefined();
    expect(base).not.toMatch(/min-height/);
  });

  it('relève les liens de tableau', () => {
    expect(css).toMatch(/\.jr-table a\.jr-lien\s*\{[^}]*padding-block:\s*4px/);
  });
});
