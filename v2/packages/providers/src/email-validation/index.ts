/**
 * Vérification de délivrabilité email et gate de push (code moteur repris du
 * legacy). Le gate `shouldPushToSmartlead` protège la réputation du domaine :
 * un email non vérifié `valid` n'est jamais poussé vers Smartlead.
 */
export * from './email-gate.js';
export * from './reoon.js';
export * from './bouncer.js';
export * from './email-pattern.js';
