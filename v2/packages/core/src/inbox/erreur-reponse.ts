/**
 * Erreur d'entrée : le fil ne peut pas recevoir de réponse dans son état
 * actuel (aucun message reçu, ou message reçu sans l'identifiant nécessaire
 * pour lui répondre). Ne porte jamais de secret ni de clé — uniquement un
 * message d'explication destiné à l'opérateur.
 *
 * Fichier à part : `repondre-au-fil` et `linkedin/reponse-manuelle` la lèvent tous deux, et
 * chacun importe l'autre (un cycle d'imports ne tombe qu'à l'exécution, hors du typage).
 */
export class ErreurReponseImpossible extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurReponseImpossible';
  }
}
