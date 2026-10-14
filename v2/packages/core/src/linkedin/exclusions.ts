/**
 * Filtre d'intitulé appliqué à la collecte LinkedIn, AVANT tout scoring (issue #164).
 *
 * Pourquoi une règle plutôt que le LLM : sur la source « Engageurs des posts Uptoo », 39 des 42
 * personnes retenues sur 93 vues ont été écartées par le scoring, un appel payant par personne pour
 * jeter ce qu'une comparaison de chaînes écarte gratuitement. Fonction pure, sans accès base : la
 * décision se teste seule, et `enregistrerPersonne` n'a qu'à l'appeler.
 *
 * Comparaison sur SOUS-CHAÎNE, sans casse ni accents, et c'est un choix assumé avec son prix :
 * « consultant » exclut aussi « Directeur, ancien consultant » ou « Consultant en recrutement chez
 * un cabinet » qui sont peut-être la cible. Un mot entier ne règle rien : les intitulés LinkedIn
 * s'écrivent « Freelance | Commercial B2B », « #OpenToWork », « Étudiant(e) », et un découpage par
 * mots raterait la moitié. Le risque se borne en choisissant des termes précis (« consultant
 * indépendant » plutôt que « consultant ») et se lit dans le compteur `ecartes_filtre` du passage.
 */

export type VerdictExclusion =
  | { garde: true }
  | { garde: false; motif: 'intitule_exclu' | 'intitule_non_obligatoire'; terme: string };

export interface ExclusionsIntitule {
  readonly intitulesExclus?: readonly string[];
  readonly intitulesObligatoires?: readonly string[];
}

/** Minuscules, sans diacritiques, espaces réduits : « Étudiant » et « etudiant » deviennent la même chaîne. */
function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Les termes utilisables d'une liste, normalisés. Un terme vide ne doit JAMAIS compter : toute
 * chaîne contient la chaîne vide, donc un champ de saisie qui laisse passer un « » exclurait tout
 * le monde (ou, côté obligatoires, ferait garder tout le monde).
 */
function termesUtiles(liste: readonly string[] | undefined): { original: string; norme: string }[] {
  return (liste ?? [])
    .map((original) => ({ original, norme: normaliser(original) }))
    .filter((t) => t.norme.length > 0);
}

export function jugerIntitule(intitule: string, exclusions: ExclusionsIntitule): VerdictExclusion {
  const texte = normaliser(intitule);
  const obligatoires = termesUtiles(exclusions.intitulesObligatoires);
  const exclus = termesUtiles(exclusions.intitulesExclus);

  // 1) Obligatoires : un seul terme présent suffit (OU). Un intitulé vide n'en contient aucun, donc
  //    ne peut pas les satisfaire : on ne devine pas qu'une personne sans titre est la cible.
  if (obligatoires.length > 0 && !obligatoires.some((t) => texte.includes(t.norme))) {
    return { garde: false, motif: 'intitule_non_obligatoire', terme: '' };
  }

  // 2) Exclus : le premier terme trouvé est renvoyé pour que le compteur puisse dire lequel a mordu.
  const trouve = exclus.find((t) => texte.includes(t.norme));
  if (trouve) return { garde: false, motif: 'intitule_exclu', terme: trouve.original };

  return { garde: true };
}
