import type { Executeur } from '../executeur.js';

/**
 * `contacts.linkedin_provider_id` porte l'identifiant de membre NU (`ACoAA…`), jamais l'URN complet :
 * c'est la forme que portent la collecte et les harnais, et elle ne dépend pas du préfixe que
 * LinkedIn fait évoluer. Toute lecture ou écriture de cette colonne passe par cette fonction.
 *
 * Accepte l'URN complet (`urn:li:fsd_profile:…`, ancienne forme `urn:li:fs_miniProfile:…`) comme
 * l'identifiant déjà nu ; rend `null` pour tout le reste, une adresse de profil comprise.
 */
/**
 * Origine des critères (aucune spécification LinkedIn n'est citée dans le dépôt, tout vient de ce
 * qu'il contient déjà) : `identifiantMembre` (sources.ts) prend le dernier segment d'un URN
 * `urn:li:fsd_profile:…` ; les identifiants des collectes et des harnais commencent par `ACoAA`
 * (jusqu'à 8 caractères : `ACoAAada`) ; `urn:li:fs_miniProfile:AEM…` est l'ancienne forme que
 * rendait `/me`. `ACw…` est la variante observée côté LinkedIn, non attestée dans le dépôt.
 *
 * Deux niveaux de confiance. Derrière un préfixe d'URN de profil, le préfixe EST l'attestation :
 * tout identifiant de la bonne famille de caractères passe. Un identifiant NU n'atteste rien, on
 * exige donc l'un des trois débuts connus. Dans les deux cas, 5 caractères au moins, et un UUID est
 * refusé : c'est l'identifiant du profil CHEZ FullEnrich, que `enrich.ts` écrivait ici à tort.
 */
const FAMILLE = /^[A-Za-z0-9_-]{5,}$/;
const DEBUT_CONNU = /^(?:ACo|ACw|AEM)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Valeurs que des appelants écrivent faute d'identifiant (`String(undefined)`) : jamais un identifiant. */
const PARASITES = new Set(['undefined', 'null', 'none', 'nan', 'unknown']);
const PREFIXE_URN = /^urn:li:(?:fsd_profile|fs_miniProfile):/;

export function normaliserUrnLinkedIn(valeur: string): string | null {
  const brut = valeur.trim();
  const prefixe = PREFIXE_URN.test(brut);
  const nu = brut.replace(PREFIXE_URN, '');
  if (UUID.test(nu) || !FAMILLE.test(nu) || PARASITES.has(nu.toLowerCase())) return null;
  return prefixe || DEBUT_CONNU.test(nu) ? nu : null;
}

/**
 * Mémorise l'URN d'un contact (forme nue). Sans lui, un message entrant (qui ne porte que l'URN de
 * son expéditeur, aucune adresse) n'est rattachable à personne. Un URN illisible n'écrit rien.
 * Filtre explicitement par organisation : le worker travaille avec la clé de service.
 */
/**
 * Ce qu'on peut journaliser d'un identifiant refusé sans le recopier : sa longueur, et trois
 * caractères de début seulement quand il en a plus de 8 (une valeur courte tiendrait tout entière
 * dans un « début »). Le début passe par `JSON.stringify` : un saut de ligne ne s'imprime pas tel quel.
 */
export function decrireIdentifiantRefuse(valeur: string): string {
  const debut = valeur.length > 8 ? ` début ${JSON.stringify(valeur.slice(0, 3))},` : '';
  return `identifiant LinkedIn illisible ignoré (${debut} ${valeur.length} caractères)`;
}

export async function memoriserUrnDuContact(
  ex: Executeur,
  org: string,
  contactId: string,
  urn: string,
): Promise<void> {
  const nu = normaliserUrnLinkedIn(urn);
  if (nu === null) {
    // Jamais la valeur : elle peut identifier quelqu'un (voir `decrireIdentifiantRefuse`).
    console.warn(`[identite-linkedin] ${decrireIdentifiantRefuse(urn)}`);
    return;
  }
  await ex.query(
    `update contacts set linkedin_provider_id = $3 /* jr:contact_memoriser_urn */
      where id = $1 and organization_id = $2 and linkedin_provider_id is distinct from $3`,
    [contactId, org, nu],
  );
}
