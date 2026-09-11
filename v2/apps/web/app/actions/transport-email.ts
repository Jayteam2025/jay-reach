/**
 * Bloc « transport email prêt » de la garde d'activation d'une campagne
 * (`cequiManquePourEnvoyer`, `campaigns.ts`), extrait en fonction pure.
 *
 * `campaigns.ts` porte `'use server'` : tout export d'un tel fichier doit être
 * une fonction async (contrainte Next.js sur les Server Actions), ce qui
 * interdit d'y exporter une fonction pure synchrone pour la tester. D'où ce
 * module séparé, sans directive — testable sans harnais Supabase (registre
 * d'exécution du lot 3 : « garde testée par fonction pure »).
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
