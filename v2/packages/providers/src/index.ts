/**
 * @jay-reach/providers — manifests, registre et catalogue.
 * Chaque implémentation concrète (signals/enrichment/email/…) est enregistrée
 * via son manifest ; le cœur ne connaît que ces contrats.
 */
export * from './manifest.js';
export * from './registry.js';
export * from './catalog.js';
