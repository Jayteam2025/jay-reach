/**
 * État de la confirmation « Déconnecter ce compte », lié à l'état de la session qu'il concerne.
 *
 * Une confirmation ouverte parle d'UNE session. Si la session change pendant qu'elle est ouverte
 * (déconnectée depuis un autre onglet, reconnectée plus tard), la question n'a plus d'objet : sans
 * remise à zéro, elle réapparaîtrait toute seule à la prochaine connexion, et un clic distrait sur
 * « Oui » couperait un compte neuf. Fonction pure, pour se prouver sous Node sans DOM.
 */
export interface EtatConfirmationDeconnexion {
  demandee: boolean;
  /** La valeur de `sessionActive` pour laquelle `demandee` a été posée. */
  sessionVue: boolean;
}

export function synchroniserConfirmation(
  etat: EtatConfirmationDeconnexion,
  sessionActive: boolean,
): EtatConfirmationDeconnexion {
  return etat.sessionVue === sessionActive ? etat : { demandee: false, sessionVue: sessionActive };
}
