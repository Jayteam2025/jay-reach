import type { Executeur } from '../executeur.js';

/**
 * `contacts.linkedin_provider_id` porte l'identifiant de membre NU (`ACoAA…`), jamais l'URN complet :
 * c'est la forme que portent la collecte et les harnais, et elle ne dépend pas du préfixe que
 * LinkedIn fait évoluer. Toute lecture ou écriture de cette colonne passe par cette fonction.
 *
 * Accepte l'URN complet (`urn:li:fsd_profile:…`, ancienne forme `urn:li:fs_miniProfile:…`) comme
 * l'identifiant déjà nu ; rend `null` pour tout le reste, une adresse de profil comprise.
 */
const IDENTIFIANT_MEMBRE = /^(?:ACo|ACw|AEM)[A-Za-z0-9_-]{10,}$/;
const PREFIXE_URN = /^urn:li:(?:fsd_profile|fs_miniProfile):/;

export function normaliserUrnLinkedIn(valeur: string): string | null {
  const brut = valeur.trim().replace(PREFIXE_URN, '');
  return IDENTIFIANT_MEMBRE.test(brut) ? brut : null;
}

/**
 * Mémorise l'URN d'un contact (forme nue). Sans lui, un message entrant (qui ne porte que l'URN de
 * son expéditeur, aucune adresse) n'est rattachable à personne. Un URN illisible n'écrit rien.
 * Filtre explicitement par organisation : le worker travaille avec la clé de service.
 */
export async function memoriserUrnDuContact(
  ex: Executeur,
  org: string,
  contactId: string,
  urn: string,
): Promise<void> {
  const nu = normaliserUrnLinkedIn(urn);
  if (nu === null) return;
  await ex.query(
    `update contacts set linkedin_provider_id = $3 /* jr:contact_memoriser_urn */
      where id = $1 and organization_id = $2 and linkedin_provider_id is distinct from $3`,
    [contactId, org, nu],
  );
}
