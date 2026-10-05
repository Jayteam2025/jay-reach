import { describe, expect, it } from 'vitest';
import { PROVIDER_CATALOG } from './catalog.js';
// Import par sous-chemin (comme `outreach/types.test.ts`), pas la racine `@jay-reach/core` :
// celle-ci résout vers `dist/index.d.ts`, absent tant que `packages/core` n'a pas été buildé,
// alors que `@jay-reach/core/*.js` résout directement vers les sources (`exports['./*.js']`).
import { CATALOGUE_FOURNISSEURS, type CategorieFournisseur } from '@jay-reach/core/fonctions/fournisseurs.js';

/**
 * Test d'alignement entre les deux catalogues de fournisseurs (relecture
 * tâche 21, point 3) : `PROVIDER_CATALOG` (ce paquet, champs de formulaire)
 * et `CATALOGUE_FOURNISSEURS` (`@jay-reach/core/fonctions/fournisseurs.ts`,
 * identité + catégorie pour l'écran Réglages › Fournisseurs).
 *
 * Les deux catalogues existent séparément parce que `packages/core` ne peut
 * pas importer `@jay-reach/providers` (celui-ci dépend déjà de
 * `@jay-reach/core` — l'inverse créerait un cycle). Sans ce test, un
 * onzième fournisseur ajouté à `PROVIDER_CATALOG` (ou un id renommé) pourrait
 * ne jamais être répercuté dans `CATALOGUE_FOURNISSEURS` : il resterait
 * invisible dans Réglages › Fournisseurs sans qu'aucun test ne l'attrape.
 *
 * `PROVIDER_CATALOG.category` (email/enrichment/signals/ai) ne se déduit pas
 * mécaniquement de `CategorieFournisseur` (ia/enrichissement/envoi/offres/
 * linkedin/réception) : une même catégorie catalogue couvre plusieurs
 * catégories écran (`email` → envoi pour SalesBlink, réception pour
 * Microsoft Graph ; `signals` → offres pour Adzuna/France Travail, linkedin
 * pour Apify). La correspondance ci-dessous est donc explicite, provider par
 * provider — c'est la même liste d'exceptions qu'un mainteneur devrait tenir
 * à jour des deux côtés, rendue visible ici plutôt qu'implicite.
 */
const CATEGORIE_ATTENDUE: Record<string, CategorieFournisseur> = {
  anthropic: 'ia',
  fullenrich: 'enrichissement',
  dropcontact: 'enrichissement',
  bouncer: 'enrichissement',
  reoon: 'enrichissement',
  salesblink: 'envoi',
  microsoft_graph: 'reception',
  adzuna: 'offres',
  francetravail: 'offres',
  apify: 'linkedin',
};

describe('alignement PROVIDER_CATALOG (packages/providers) / CATALOGUE_FOURNISSEURS (@jay-reach/core)', () => {
  it('portent exactement les mêmes dix identifiants de fournisseur', () => {
    const idsProviders = new Set(PROVIDER_CATALOG.map((p) => p.id));
    const idsCore = new Set(CATALOGUE_FOURNISSEURS.map((f) => f.id));
    expect(idsCore).toEqual(idsProviders);
    expect(PROVIDER_CATALOG.length).toBe(CATALOGUE_FOURNISSEURS.length);
  });

  it('chaque fournisseur du catalogue core a la catégorie attendue (mapping explicite ci-dessus)', () => {
    for (const f of CATALOGUE_FOURNISSEURS) {
      expect(CATEGORIE_ATTENDUE[f.id]).toBeDefined();
      expect(f.categorie).toBe(CATEGORIE_ATTENDUE[f.id]);
    }
  });

  it('le mapping explicite ne couvre ni plus ni moins que les dix fournisseurs réels', () => {
    expect(new Set(Object.keys(CATEGORIE_ATTENDUE))).toEqual(new Set(PROVIDER_CATALOG.map((p) => p.id)));
  });

  it('seuls salesblink et microsoft_graph portent une relève (provider_sync_state, lot 3 bis)', () => {
    const releves = CATALOGUE_FOURNISSEURS.filter((f) => f.releve).map((f) => f.id);
    expect(new Set(releves)).toEqual(new Set(['salesblink', 'microsoft_graph']));
  });
});
