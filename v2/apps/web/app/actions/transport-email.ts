/**
 * Réexport : la fonction vit désormais dans `@jay-reach/core`
 * (`packages/core/src/fonctions/transport-email.ts`, tâche 7), pour être
 * appelable par l'écran comme par le futur serveur MCP. Ce fichier ne
 * subsiste que pour ne pas casser l'import relatif depuis `actions/campaigns.ts`.
 */
export { manquesTransportEmail, type ManqueTransportEmail } from '@jay-reach/core';
