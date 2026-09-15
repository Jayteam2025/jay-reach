/**
 * Traduction d'un échec d'envoi de réponse en message d'écran.
 *
 * Vit hors du fichier d'actions serveur : Next n'y accepte que des fonctions
 * asynchrones exportées. Sépare aussi la règle du transport, ce qui la rend
 * testable sans monter de session ni de client HTTP.
 *
 * Aucune erreur de fournisseur n'est relayée telle quelle : `ErreurGraph` et
 * `ErreurSalesBlink` portent jusqu'à deux cents caractères du corps de réponse
 * du fournisseur, qui peut contenir une adresse, un identifiant de tenant ou
 * une portion d'URL.
 */
import { ErreurEntree } from '@jay-reach/core';
import { ErreurGraph } from '@jay-reach/providers/mail';

/** Message générique : rien d'actionnable, rien de sensible. */
const ENVOI_IMPOSSIBLE = 'Envoi impossible pour le moment.';

export function messageErreurReponse(err: unknown): string {
  // `ErreurEntree` est écrite pour l'opérateur (fil sans message reçu, fil non
  // email, fournisseur non configuré) : son message est le bon.
  if (err instanceof ErreurEntree) return err.message;
  // Un refus de la boîte Microsoft se soigne autrement qu'une panne : c'est en
  // général la politique d'accès Exchange ou un secret expiré, côté tenant.
  if (err instanceof ErreurGraph) return "La boîte Microsoft a refusé l'envoi de la réponse.";
  return ENVOI_IMPOSSIBLE;
}
