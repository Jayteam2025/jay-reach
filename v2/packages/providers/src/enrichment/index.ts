/**
 * Enrichissement — code moteur repris du legacy, porté depuis les Edge
 * Functions Deno. Annuaire légal INSEE + FullEnrich (résolution entreprise,
 * recherche et enrichissement de contacts) + utilitaires purs (géo, noms).
 */
export * from './insee-sirene.js';
export * from './fullenrich.js';
export * from './fullenrich-company-resolve.js';
export * from './geo-cascade.js';
export * from './name-reconstruction.js';
