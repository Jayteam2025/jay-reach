/**
 * Exclusion définitive d'un contact, et son déclenchement automatique sur une réponse humaine.
 *
 * Règle du commanditaire : « une réponse est une réponse, dès qu'on a une réponse, on reprend la
 * main ». Dès qu'un humain répond, sur n'importe quel canal, la personne sort de tout envoi
 * automatique, dans toutes les campagnes de l'organisation, sans distinguer un refus d'un oui.
 *
 * `poserExclusion` est l'UNIQUE écriture de ce qu'« exclure » veut dire (statut du contact,
 * suppression email, suppressions LinkedIn). `nePlusContacter` (opérateur, `origin = 'manual'`) et
 * `exclureApresReponse` (automatique, `origin = 'api'`, `reason = 'reponse_recue'`) l'appellent
 * toutes deux : une exclusion automatique doit se reconnaître dans la table, mais ne doit pas
 * pouvoir diverger de l'exclusion manuelle.
 *
 * Ce fichier ne dépend ni de `contacts.ts` ni de `record-reply.ts` pour rester une feuille : le
 * premier importe `LIVE_STATUSES` du second, qui importe ce fichier.
 *
 * `suppressions` n'a AUCUNE contrainte d'unicité (`init_schema.sql`) : chaque insertion se
 * dédoublonne par `where not exists`, ce qui rend le tout rejouable (tâche 10 : rejeu du classement).
 */
import type { Executeur } from '../executeur.js';
import { lienProfilDeduit, normaliserUrlProfil } from '../fonctions/sources.js';
import { normaliserUrnLinkedIn } from '../linkedin/identite.js';
import { ecrireEvenement } from '../journal.js';

export interface ExclusionAPoser {
  readonly email: string | null;
  /** Adresses de profil LinkedIn à opposer, déjà décidées par l'appelant. */
  readonly adressesLinkedin: readonly string[];
  readonly motif: string;
  readonly origine: 'manual' | 'api';
}

/**
 * Pose le statut `do_not_contact` et les suppressions, sans les inscriptions (chaque appelant a
 * déjà sa propre façon de clore celles du contact). Renvoie le nombre de suppressions
 * RÉELLEMENT insérées par canal : une relecture sur un contact déjà exclu rend zéro.
 */
export async function poserExclusion(
  tx: Executeur,
  org: string,
  contactId: string,
  exclusion: ExclusionAPoser,
): Promise<{ email: number; linkedin: number }> {
  await tx.query(
    `update contacts set status = 'do_not_contact' /* jr:dnc_statut */ where id = $1 and organization_id = $2`,
    [contactId, org],
  );

  let email = 0;
  if (exclusion.email) {
    const res = await tx.query(
      `insert into suppressions (organization_id, scope, value, reason, origin) /* jr:dnc_suppression */
       select $1, 'email', $2, $3, $4::suppression_origin
       where not exists (
         select 1 from suppressions where organization_id = $1 and scope = 'email' and value = $2
       )`,
      [org, exclusion.email, exclusion.motif, exclusion.origine],
    );
    email = res.rowCount ?? 0;
  }

  // L'opposition porte sur le TRAITEMENT, pas seulement sur l'envoi : sans cette ligne, la personne
  // serait re-collectée au prochain post, re-scorée et ré-enrichie avant que l'envoi, tout à la fin,
  // ne soit bloqué. La collecte (`enregistrerEngageur`) consulte ce périmètre.
  let linkedin = 0;
  for (const adresse of new Set(exclusion.adressesLinkedin)) {
    const res = await tx.query(
      `insert into suppressions (organization_id, scope, value, reason, origin) /* jr:dnc_suppression_linkedin */
       select $1, 'linkedin', $2, $3, $4::suppression_origin
       where not exists (
         select 1 from suppressions where organization_id = $1 and scope = 'linkedin' and lower(value) = lower($2)
       )`,
      [org, adresse, exclusion.motif, exclusion.origine],
    );
    linkedin += res.rowCount ?? 0;
  }
  return { email, linkedin };
}

/**
 * Les adresses LinkedIn VALIDÉES à opposer pour un contact : l'adresse réelle quand c'est une adresse
 * de profil (`normaliserUrlProfil`), et la forme fabriquée depuis `linkedin_provider_id` SEULEMENT
 * quand `normaliserUrnLinkedIn` reconnaît un identifiant de membre. Un identifiant FullEnrich (353
 * contacts sur 590) fabriquerait une adresse qui n'existe pas et l'opposition ne protégerait personne.
 * Partagée par l'exclusion sur réponse et par `nePlusContacter` : leurs oppositions et leurs
 * annulations de file ne peuvent pas diverger.
 */
export function adressesLinkedinAOpposer(contact: {
  readonly linkedin_url: string | null;
  readonly linkedin_provider_id: string | null;
}): string[] {
  const adresses: string[] = [];
  const reelle = contact.linkedin_url ? normaliserUrlProfil(contact.linkedin_url) : null;
  if (reelle) adresses.push(reelle);
  const membre = contact.linkedin_provider_id ? normaliserUrnLinkedIn(contact.linkedin_provider_id) : null;
  if (membre) adresses.push(lienProfilDeduit(membre));
  return adresses;
}

/**
 * Quelles lignes de la file `annulerEnvoisEnFile` annule ($1 organisation, $2 contact, $3 adresses).
 * Une seule définition : l'aperçu du rejeu (`apercuExclusion`) compte avec ELLE, donc le mode à blanc
 * ne peut pas annoncer autre chose que ce que l'exclusion annulera.
 */
const FILTRE_ENVOIS_A_ANNULER = `organization_id = $1 and status = 'pending' and origine <> 'reponse'
        and (contact_id = $2
             or (contact_id is null and cardinality($3::text[]) > 0
                 and app.url_linkedin_normalisee(linkedin_url)
                     = any(array(select app.url_linkedin_normalisee(a) from unnest($3::text[]) a))))`;

/**
 * Annule les envois LinkedIn encore EN FILE d'un contact qu'on vient d'exclure, et écarte l'action
 * du séquenceur qui les portait (`skipped` / `enrollment_inactive`, comme `applyToEnrollment` : sinon
 * le tick la ressortirait). Rend le nombre de lignes annulées.
 *
 * - Seules les lignes `pending` : une ligne `processing` est partie, on ne la rattrape pas.
 * - Invitations et messages, sans distinction.
 * - Jamais une ligne `origine = 'reponse'` : c'est la réponse d'un opérateur à cette personne, que
 *   l'exclusion ne bloque jamais (même règle que la garde de `reclamerProchaineAction`).
 * - Une ligne sans `contact_id` (colonne nullable) se rattache par adresse, parmi `adressesProfil`
 *   (voir `adressesLinkedinAOpposer` : adresse réelle ET forme déduite de l'URN, toutes deux
 *   VALIDÉES). `app.url_linkedin_normalisee` ne valide rien, et `linkedin.com/in` (issue de `.../in/`)
 *   est la même chaîne pour toute adresse dégénérée. Tableau vide : on n'annule que par `contact_id` : une ligne non annulée sera arrêtée par la garde d'envoi, une
 *   ligne annulée chez le mauvais prospect ne se retrouve jamais. Les DEUX côtés de la comparaison
 *   passent par la fonction SQL, car `normaliserUrlProfil` préserve la casse et elle non.
 */
export async function annulerEnvoisEnFile(
  ex: Executeur,
  org: string,
  contactId: string,
  adressesProfil: readonly string[],
): Promise<number> {
  const res = await ex.query<{ action_id: string | null }>(
    `update linkedin_action_queue /* jr:annulation_file_exclusion */
        set status = 'cancelled', error_code = 'contact_exclu', updated_at = now()
      where ${FILTRE_ENVOIS_A_ANNULER}
      returning action_id`,
    [org, contactId, [...adressesProfil]],
  );
  const actions = res.rows.flatMap((r) => (r.action_id ? [r.action_id] : []));
  if (actions.length > 0) {
    await ex.query(
      `update actions set status = 'skipped', error = 'enrollment_inactive' /* jr:annulation_action_exclusion */
        where organization_id = $1 and id = any($2::uuid[]) and status in ('scheduled', 'approved')`,
      [org, actions],
    );
  }
  return res.rowCount ?? res.rows.length;
}

/**
 * Exclusion posée par une réponse humaine reçue.
 *
 * DEUX graphies de l'adresse LinkedIn au plus, comme la collecte les connaît :
 * - celle du contact, `contacts.linkedin_url`, quand c'est une adresse de profil valide ;
 * - celle fabriquée depuis `linkedin_provider_id` (`/in/ACoAA…`), que la collecte produit quand
 *   elle n'a pas d'adresse publique, MAIS seulement quand cet identifiant est reconnu comme un
 *   identifiant de membre (`normaliserUrnLinkedIn`). Quand il n'en est pas un (353 contacts sur 590
 *   portaient un identifiant FullEnrich), la déduction fabrique une adresse qui n'existe pas et
 *   l'opposition ne protégerait personne : on ne pose alors RIEN d'autre que l'adresse réelle.
 *
 * Pas d'`exiger(ctx, 'operator')` : rien n'est déclenché par un utilisateur. Pas de transaction
 * ouverte ici non plus : l'appelant (`recordInboundReply`) tient déjà la sienne, pour qu'un échec
 * ne laisse pas une réponse enregistrée sans exclusion.
 *
 * Laisse une trace (`contact.excluded_after_reply`), distincte de l'action manuelle : l'exclusion est
 * irréversible et aucun écran ne la défait. Écrite seulement quand quelque chose change (rejouée sur
 * un contact déjà exclu, elle ne double pas l'événement). Son échec n'est PAS avalé : dans une
 * transaction, une écriture qui échoue l'a déjà abandonnée, et une exclusion sans trace ne doit pas exister.
 */
export async function exclureApresReponse(
  ex: Executeur,
  org: string,
  contactId: string,
): Promise<{ email: number; linkedin: number }> {
  const res = await ex.query<{ email: string | null; linkedin_url: string | null; linkedin_provider_id: string | null; status: string }>(
    `select email, linkedin_url, linkedin_provider_id, status::text as status from contacts /* jr:exclusion_reponse_contact */ where id = $1 and organization_id = $2`,
    [contactId, org],
  );
  const contact = res.rows[0];
  if (!contact) return { email: 0, linkedin: 0 };

  const adresses = adressesLinkedinAOpposer(contact);

  const posees = await poserExclusion(ex, org, contactId, {
    email: contact.email,
    adressesLinkedin: adresses,
    motif: 'reponse_recue',
    origine: 'api',
  });
  // Même transaction que l'exclusion : une exclusion dont les envois restent en file ne doit pas exister.
  await annulerEnvoisEnFile(ex, org, contactId, adresses);
  if (contact.status !== 'do_not_contact' || posees.email + posees.linkedin > 0) {
    await ecrireEvenement(ex, {
      organisationId: org,
      entityType: 'contact',
      entityId: contactId,
      action: 'contact.excluded_after_reply',
      diff: { libelle: 'Contact exclu automatiquement : une réponse humaine a été reçue.', automatique: true, motif: 'reponse_recue' },
      actorId: null,
    });
  }
  return posees;
}

/**
 * Ce qu'`exclureApresReponse` ferait pour ce contact, SANS rien écrire : `exclu` quand il n'est pas déjà
 * `do_not_contact`, et le nombre d'envois LinkedIn en file qui seraient annulés. Sert au mode à blanc
 * du rejeu du classement ; lecture seule par construction (deux `select`).
 */
export async function apercuExclusion(
  ex: Executeur,
  org: string,
  contactId: string,
): Promise<{ exclu: boolean; envoisAnnules: number }> {
  const res = await ex.query<{ linkedin_url: string | null; linkedin_provider_id: string | null; status: string }>(
    `select linkedin_url, linkedin_provider_id, status::text as status from contacts where id = $1 and organization_id = $2`,
    [contactId, org],
  );
  const contact = res.rows[0];
  if (!contact) return { exclu: false, envoisAnnules: 0 };
  const compte = await ex.query<{ n: number }>(
    `select count(*)::int as n from linkedin_action_queue /* jr:apercu_envois_annules */ where ${FILTRE_ENVOIS_A_ANNULER}`,
    [org, contactId, adressesLinkedinAOpposer(contact)],
  );
  return { exclu: contact.status !== 'do_not_contact', envoisAnnules: compte.rows[0]?.n ?? 0 };
}
