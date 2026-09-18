/**
 * Le bouton « Nouvelle campagne » de l'accueil ne menait nulle part (G2,
 * signalé après recette produit) : `<Bouton variante="principal">`, sans
 * `onClick` ni `href` — un `<button type="button">` hors formulaire. Rien ne
 * l'attrapait : `AujourdhuiPage` est un composant serveur (pas de `'use
 * client'`), ce qui interdit structurellement d'y attacher un `onClick` réel
 * sur un élément — la seule façon d'y agir est un vrai lien ou un `<form>`.
 * `Bouton` (`components/ui/Bouton.tsx`) ne rend jamais l'un ni l'autre : tout
 * usage direct dans ce fichier est donc, par construction, mort au clic.
 *
 * Contrôle statique (même idiome que `cles-utilisees.test.ts`, `packages/i18n`) :
 * pas de rendu (une vraie exécution demanderait de mocker `contexteCourant`,
 * la base et `next-intl` pour un gain marginal), mais deux garde-fous qui
 * auraient arrêté cette régression avant recette :
 *  1. aucun `<Bouton` dans ce fichier (le composant lui-même est légitime
 *     ailleurs, dans un `<form>` ou un composant client — jamais ici) ;
 *  2. chaque `<Link href="...">` littéral de la page pointe vers une route
 *     qui existe réellement sous `app/(app)`.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ici = fileURLToPath(new URL('.', import.meta.url));
const source = readFileSync(join(ici, 'page.tsx'), 'utf8');

/** Résout un chemin de route (App Router) en acceptant un segment `[dynamique]` pour un id de donnée. */
function routeExiste(chemin: string): boolean {
  let dossier = ici;
  for (const segment of chemin.split('/').filter(Boolean)) {
    const litteral = join(dossier, segment);
    if (existsSync(litteral)) {
      dossier = litteral;
      continue;
    }
    const dynamique = readdirSync(dossier, { withFileTypes: true }).find((e) => e.isDirectory() && /^\[.+\]$/.test(e.name));
    if (!dynamique) return false;
    dossier = join(dossier, dynamique.name);
  }
  return existsSync(join(dossier, 'page.tsx'));
}

describe('AujourdhuiPage — pas d’action morte', () => {
  it(
    "n'utilise jamais <Bouton> : composant serveur sans 'use client', aucun onClick réel " +
      'possible ici — un <Bouton> ne peut donc être qu’un bouton mort (régression « Nouvelle campagne », G2)',
    () => {
      expect(source).not.toMatch(/<Bouton\b/);
    },
  );

  it('chaque lien statique de la page pointe vers une route qui existe réellement', () => {
    const hrefsStatiques = [...source.matchAll(/<Link\s+href="([^"{]+)"/g)].map((m) => m[1]!);
    // Au moins les liens attendus (garde-fou contre un test qui matcherait zéro `<Link>` si la
    // page changeait de forme — un tableau vide rendrait les assertions ci-dessous vacuously true).
    expect(hrefsStatiques.length).toBeGreaterThanOrEqual(5);
    for (const href of hrefsStatiques) {
      expect(routeExiste(href), `route « ${href} » introuvable sous app/(app)`).toBe(true);
    }
  });

  it('le lien dynamique vers une campagne (`/campaigns/${campagne.id}`) résout une route réelle', () => {
    expect(source).toContain('href={`/campaigns/${campagne.id}`}');
    expect(routeExiste('/campaigns/une-campagne-quelconque')).toBe(true);
  });
});
