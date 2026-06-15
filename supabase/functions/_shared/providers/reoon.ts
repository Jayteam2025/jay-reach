/**
 * Reoon EmailValidator adapter (deliveryMode 'sync').
 *
 * Reoon est synchrone : l'orchestrateur pilote la boucle quota+chunking et
 * appelle reoonVerifyOne par email. submitBatch/fetchResults sont des stubs
 * pour satisfaire l'interface EmailValidator.
 */

import { verifyEmail, reoonToVerdict } from "../reoon.ts";
import type { EmailValidator, EmailValidationResult, ResolvedProvider } from "./types.ts";

export const reoonValidator: EmailValidator = {
  type: "reoon",
  deliveryMode: "sync",
  async submitBatch(emails, _ctx: ResolvedProvider) {
    // Stub : Reoon est sync, pas de batch asynchro. Retourne un ID factice.
    return { providerBatchId: `reoon-sync-${emails.length}` };
  },
  async fetchResults(_id, _ctx) {
    // Stub : les resultats sont collectes directement par reoonVerifyOne.
    return [];
  },
};

/**
 * Vérifie un email via Reoon et renvoie le verdict normalisé.
 * Fonction unitaire exposée pour l'orchestrateur (boucle quota+chunking).
 *
 * @param apiKey Clé API Reoon
 * @param email Email à vérifier
 * @returns Résultat normalisé (email, verdict, reason)
 * @throws ReoonError si la vérification échoue
 */
export async function reoonVerifyOne(apiKey: string, email: string): Promise<EmailValidationResult> {
  const r = await verifyEmail(apiKey, email, "power");
  return {
    email,
    verdict: reoonToVerdict(r),
    reason: r.status ?? null,
  };
}
