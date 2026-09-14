/**
 * Bloc « transport email prêt » de la garde d'activation d'une campagne
 * (`manquesPourLancer`, `campagnes.ts`), fonction pure.
 *
 * Déplacé depuis `apps/web/app/actions/transport-email.ts` (tâche 7) : cette
 * fonction ne dépend d'aucun accès base, elle sert à la fois à l'écran et au
 * futur serveur MCP (spec « une fonction, deux façades ») sans passer par
 * Next.js. L'ancien fichier web reste un simple réexport, pour les imports
 * existants.
 */

/** Les trois manques possibles du bloc « transport email » de la garde d'activation. */
export type ManqueTransportEmail = 'noSalesBlinkKey' | 'noBoundEmailSender' | 'emailSenderDisconnected';

/**
 * `cleStatus` vient de `credentials_public.status` pour le provider
 * `salesblink` (`null` si aucune ligne). `boites` porte les expéditeurs email
 * actifs de l'organisation (`provider_ref`, `provider_state`) : un
 * expéditeur sans `provider_ref` n'est relié à aucune boîte SalesBlink.
 */
export function manquesTransportEmail(params: {
  cleStatus: string | null;
  boites: readonly { provider_ref: string | null; provider_state: { sending_enabled?: boolean } | null }[];
}): ManqueTransportEmail[] {
  const manques: ManqueTransportEmail[] = [];
  if (params.cleStatus !== 'configured') {
    manques.push('noSalesBlinkKey');
  }
  const reliees = params.boites.filter((b) => b.provider_ref);
  if (reliees.length === 0) {
    manques.push('noBoundEmailSender');
  } else if (!reliees.some((b) => b.provider_state?.sending_enabled !== false)) {
    manques.push('emailSenderDisconnected');
  }
  return manques;
}
