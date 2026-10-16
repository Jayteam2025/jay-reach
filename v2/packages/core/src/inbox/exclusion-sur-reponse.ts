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

  const adresses: string[] = [];
  const reelle = contact.linkedin_url ? normaliserUrlProfil(contact.linkedin_url) : null;
  if (reelle) adresses.push(reelle);
  const membre = contact.linkedin_provider_id ? normaliserUrnLinkedIn(contact.linkedin_provider_id) : null;
  if (membre) adresses.push(lienProfilDeduit(membre));

  const posees = await poserExclusion(ex, org, contactId, {
    email: contact.email,
    adressesLinkedin: adresses,
    motif: 'reponse_recue',
    origine: 'api',
  });
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
