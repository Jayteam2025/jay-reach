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
import { normaliserUrlProfil } from '../fonctions/sources.js';

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
 * L'adresse LinkedIn est celle du contact, `contacts.linkedin_url`, quand c'est une adresse de
 * profil valide. JAMAIS une adresse déduite de `linkedin_provider_id` : quand cet identifiant n'en
 * est pas un (353 contacts sur 590 portaient un identifiant FullEnrich), la déduction fabrique une
 * adresse qui n'existe pas, et l'opposition poserait sur un profil inexistant : elle ne protégerait
 * personne alors que toute la promesse est « plus jamais contacté ». Sans adresse reconnue, on ne
 * pose rien côté LinkedIn.
 *
 * Pas d'`exiger(ctx, 'operator')` : rien n'est déclenché par un utilisateur. Pas de transaction
 * ouverte ici non plus : l'appelant (`recordInboundReply`) tient déjà la sienne, pour qu'un échec
 * ne laisse pas une réponse enregistrée sans exclusion.
 */
export async function exclureApresReponse(
  ex: Executeur,
  org: string,
  contactId: string,
): Promise<{ email: number; linkedin: number }> {
  const res = await ex.query<{ email: string | null; linkedin_url: string | null }>(
    `select email, linkedin_url from contacts /* jr:exclusion_reponse_contact */ where id = $1 and organization_id = $2`,
    [contactId, org],
  );
  const contact = res.rows[0];
  if (!contact) return { email: 0, linkedin: 0 };

  const adresse = contact.linkedin_url ? normaliserUrlProfil(contact.linkedin_url) : null;
  return poserExclusion(ex, org, contactId, {
    email: contact.email,
    adressesLinkedin: adresse ? [adresse] : [],
    motif: 'reponse_recue',
    origine: 'api',
  });
}
