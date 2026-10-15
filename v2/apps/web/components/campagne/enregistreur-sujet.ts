/**
 * L'enregistrement du sujet d'un post, séparé de l'écran pour pouvoir être prouvé.
 *
 * Règle : le sujet n'est « confirmé » qu'APRÈS la réponse du serveur, jamais avant. Marquer comme
 * envoyé ce qui est encore en vol laissait « Valider » passer sur l'état précédent quand
 * l'enregistrement échouait : le post partait validé avec l'ANCIEN sujet, celui que l'opérateur
 * croyait avoir remplacé. `enregistrer()` attend donc l'envoi en vol, et rend `false` si le sujet
 * affiché n'est pas celui que le serveur a confirmé : l'appelant NE DOIT PAS valider alors.
 */
export interface EnregistreurSujet {
  /** `true` seulement si le sujet lu à l'instant est celui que le serveur a confirmé. */
  enregistrer(): Promise<boolean>;
  /** Le dernier sujet confirmé par le serveur. */
  confirme(): string;
}

export function creerEnregistreurSujet(deps: {
  confirmeInitial: string;
  lire: () => string;
  /** Envoie le sujet ; rend `null` si le serveur l'a accepté, sinon le message d'erreur. */
  envoyer: (sujet: string) => Promise<string | null>;
  surErreur: (message: string) => void;
}): EnregistreurSujet {
  let confirme = deps.confirmeInitial;
  let enVol: Promise<boolean> | null = null;

  async function enregistrer(): Promise<boolean> {
    while (enVol) await enVol.catch(() => undefined);
    const sujet = deps.lire();
    if (sujet === confirme) return true;
    // Un sujet vidé n'est pas enregistrable : le serveur garde l'ancien, on ne valide pas dessus.
    if (sujet === '') return false;
    const envoi = (async () => {
      const erreur = await deps.envoyer(sujet);
      if (erreur === null) {
        confirme = sujet;
        return true;
      }
      deps.surErreur(erreur);
      return false;
    })();
    enVol = envoi;
    try {
      return await envoi;
    } finally {
      enVol = null;
    }
  }

  return { enregistrer, confirme: () => confirme };
}
