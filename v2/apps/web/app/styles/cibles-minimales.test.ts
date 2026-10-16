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

  it('relève le lien « Voir le post » de l\'écran des posts', () => {
    // Même défaut que les liens de tableau : à 12,5 px de corps, sans marge, la cible fait ~19 px.
    expect(css).toMatch(/\.jr-post-lien\s*\{[^}]*display:\s*inline-block[^}]*padding-block:\s*4px/);
  });
});

describe('l\'écran des posts', () => {
  it('garde un contour de focus visible sur les champs éditables de la phrase', () => {
    const regle = css.match(/\.jr-post-champ:focus\s*\{([^}]*)\}/)?.[1];
    expect(regle, 'règle :focus des champs de la phrase introuvable').toBeDefined();
    expect(regle).not.toMatch(/outline:\s*none/);
    expect(regle).toMatch(/outline:\s*2px solid var\(--jr-accent\)/);
  });

  it('prend la taille de la phrase dans un jeton, jamais en dur', () => {
    const jetons = readFileSync(new URL('./jetons.css', import.meta.url), 'utf8');
    expect(jetons).toMatch(/--jr-phrase:\s*17px/);
    expect(css).toMatch(/\.jr-post-phrase\s*\{[^}]*font-size:\s*var\(--jr-phrase\)/);
  });

  it('reste dans le barème de rayons (6, 10, 14, 999) et nomme la variante discrète', () => {
    const regle = css.match(/\.jr-post-champ\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(regle).not.toMatch(/border-radius/);
    expect(css).toMatch(/\.jr-bouton\.discret\s*\{/);
  });
});
