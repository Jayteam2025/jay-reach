/**
 * Le nom d'une étape de séquence, rendu en CODE et non en français (règle 7 de `CLAUDE.md` : trois langues,
 * aucune chaîne en dur). Le cœur choisit le code ; l'écran le traduit (`campagne.sequence.nomEtape.<code>`
 * dans `packages/i18n/src/messages/{fr,en,nl}.json`), tout comme le futur serveur MCP.
 */
export const CODES_NOM_ETAPE = [
  'premier_email',
  'relance',
  'dernier_mot',
  'invitation_linkedin',
  'premier_message_linkedin',
  'relance_linkedin',
  'dernier_message_linkedin',
  'courrier',
  'appel',
  'etape',
] as const;

export type CodeNomEtape = (typeof CODES_NOM_ETAPE)[number];
