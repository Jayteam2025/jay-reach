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
      // Un échec est un échec, quelle que soit sa forme : une action qui jette (coupure réseau)
      // passe par le même chemin que celle qui rend `{ ok: false }`.
      const erreur = await deps.envoyer(sujet).catch(messageDException);
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

function messageDException(e: unknown): string {
  return e instanceof Error && e.message !== '' ? e.message : 'Erreur inconnue.';
}

/**
 * Le clic sur « Valider » : enregistre le sujet, et NE VALIDE PAS si l'enregistrement a échoué,
 * par refus comme par exception. Séparé du composant pour que ce `return` précoce, qui empêche de
 * valider un post sur l'ancien sujet, soit gardé par un test.
 */
export async function validerApresEnregistrement(deps: {
  enregistreur: EnregistreurSujet;
  /** Valide le post ; rend `null` si accepté, sinon le message d'erreur. */
  valider: () => Promise<string | null>;
  surErreur: (message: string) => void;
}): Promise<void> {
  if (!(await deps.enregistreur.enregistrer())) return;
  const erreur = await deps.valider().catch(messageDException);
  if (erreur !== null) deps.surErreur(erreur);
}
