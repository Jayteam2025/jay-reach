/**
 * Connecteurs de signaux — code moteur repris du legacy (les appels d'API qui
 * fonctionnent en production), porté depuis les Edge Functions Deno.
 */
export * from './types.js';
export { adzunaScraper } from './adzuna.js';
export { franceTravailScraper } from './france-travail.js';
export { apifyScraper } from './apify.js';
export { looksLikeJobTitleFragment } from './company-name-validator.js';
