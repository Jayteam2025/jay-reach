/**
 * L'enregistrement d'un champ d'accroche — le sujet du post, le nom de son auteur — séparé de
 * l'écran pour pouvoir être prouvé.
 *
 * Règle : la valeur n'est « confirmée » qu'APRÈS la réponse du serveur, jamais avant. Marquer
 * comme envoyé ce qui est encore en vol laissait « Valider » passer sur l'état précédent quand
 * l'enregistrement échouait : le post partait validé avec l'ANCIENNE valeur, celle que l'opérateur
 * croyait avoir remplacée. `enregistrer()` attend donc l'envoi en vol, et rend `false` si ce qui
 * est affiché n'est pas ce que le serveur a confirmé : l'appelant NE DOIT PAS valider alors.
 */
export interface EnregistreurChamp {
  /** `true` seulement si la valeur lue à l'instant est celle que le serveur a confirmée. */
  enregistrer(): Promise<boolean>;
  /** La dernière valeur confirmée par le serveur. */
  confirme(): string;
}

export function creerEnregistreurDeChamp(deps: {
  confirmeInitial: string;
  lire: () => string;
  /** Envoie la valeur ; rend `null` si le serveur l'a acceptée, sinon le message d'erreur. */
  envoyer: (valeur: string) => Promise<string | null>;
  surErreur: (message: string) => void;
}): EnregistreurChamp {
  let confirme = deps.confirmeInitial;
  let enVol: Promise<boolean> | null = null;

  async function enregistrer(): Promise<boolean> {
    while (enVol) await enVol.catch(() => undefined);
    const valeur = deps.lire();
    if (valeur === confirme) return true;
    // Un champ vidé n'est pas enregistrable : le serveur garde l'ancien, on ne valide pas dessus.
    if (valeur === '') return false;
    const envoi = (async () => {
      // Un échec est un échec, quelle que soit sa forme : une action qui jette (coupure réseau)
      // passe par le même chemin que celle qui rend `{ ok: false }`.
      const erreur = await deps.envoyer(valeur).catch(messageDException);
      if (erreur === null) {
        confirme = valeur;
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
 * Le clic sur « Valider » : enregistre TOUS les champs de l'accroche, et NE VALIDE PAS si l'un
 * d'eux a échoué, par refus comme par exception. Séparé du composant pour que ce `return` précoce,
 * qui empêche de valider un post sur l'ancienne valeur, soit gardé par un test.
 *
 * Tous, et pas seulement le sujet : depuis que le nom de l'auteur s'édite lui aussi dans la
 * phrase, valider sur un auteur dont l'enregistrement a échoué ferait partir le message avec
 * l'ancien nom — exactement le défaut que ce fichier existe pour empêcher.
 */
export async function validerApresEnregistrement(deps: {
  enregistreurs: readonly EnregistreurChamp[];
  /** Valide le post ; rend `null` si accepté, sinon le message d'erreur. */
  valider: () => Promise<string | null>;
  surErreur: (message: string) => void;
}): Promise<void> {
  // En série, pas en parallèle : deux refus donneraient deux messages dont le second effacerait
  // le premier, et l'opérateur ne lirait que le dernier champ fautif.
  let toutEnregistre = true;
  for (const e of deps.enregistreurs) {
    if (!(await e.enregistrer())) toutEnregistre = false;
  }
  if (!toutEnregistre) return;
  const erreur = await deps.valider().catch(messageDException);
  if (erreur !== null) deps.surErreur(erreur);
}
