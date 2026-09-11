/**
 * Canaux d'envoi. `smartlead.js` reste exporte jusqu'a la tache 8 du lot 3
 * (dispatch.ts et webhook-smartlead.ts l'importent encore) ; `salesblink.js`
 * est le nouveau transport email.
 */
export * from './smartlead.js';
export * from './salesblink.js';
