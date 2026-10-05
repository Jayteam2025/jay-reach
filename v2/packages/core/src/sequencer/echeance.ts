/**
 * Pose l'échéance de l'étape suivante au DÉPART RÉEL d'une action (issue
 * #111) — implémentation UNIQUE, partagée par les deux transports d'envoi
 * (SalesBlink dans `apps/worker`, extension LinkedIn dans `apps/web`) : avant
 * ce module, le même SQL était dupliqué dans chacun (tour de correction 1,
 * revue du 17/09).
 *
 * `packages/core` ne dépend pas de `pg` : ce module reçoit `Executeur`, le
 * contrat base minimal du paquet (`../executeur.js`), qu'un `Pool`/`PoolClient`
 * de `pg` respecte déjà sans adaptateur.
 */
import type { Executeur } from '../executeur.js';
import { versInstant, type InstantPg } from '../temps.js';
import { echeanceEtapeSuivante } from './scheduling.js';

export interface ParamsEcheanceApresDepart {
  readonly enrollmentId: string;
  readonly campaignId: string;
  /**
   * RANG ORDINAL de l'étape suivante dans la séquence (position dans le
   * tableau trié par `position`), PAS la valeur de la colonne `position` —
   * une séquence peut avoir des positions non contiguës (issue #115, même
   * défaut que `reprendreInscription`, `fonctions/sequence.ts`, avant son
   * correctif). `current_step` de l'inscription est ce rang.
   */
  readonly currentStep: number;
}

/**
 * Pose l'échéance de l'étape suivante au DÉPART RÉEL de l'action qui vient
 * d'être marquée `dispatched` (issue #111) : le tick ne la pose plus à la
 * création (`composeTick`), pour ne pas fixer une échéance avant de savoir
 * quand l'envoi partira vraiment — un lot peut s'étaler sur plusieurs jours
 * quand les expéditeurs sont saturés, et l'étape suivante ne doit jamais
 * devenir due avant que celle-ci ne soit réellement partie.
 *
 * `now` est l'instant du DÉPART RÉEL — celui du dispatch en cours pour un
 * gestionnaire d'envoi, ou un `dispatched_at` déjà connu pour un rattrapage
 * (`rattraperEcheancesManquantes`, `apps/worker/src/handlers/sequence.ts`) —
 * jamais un simple horodatage de convenance.
 *
 * N'écrit rien si l'inscription n'est plus `active`, si une échéance est déjà
 * posée (`next_action_at` non nul), ou si `currentStep` ne correspond plus à
 * l'étape attendue : la garde vit dans le SQL lui-même (`where …`), sans
 * lecture préalable, pour qu'un rejeu du dispatch (idempotent côté
 * `mark_action_dispatched`) ne déplace jamais une échéance déjà calculée, et
 * qu'une inscription mise en pause entre-temps ne soit pas reprogrammée dans
 * son dos. Le rang ordinal `currentStep` cherche le N-ième `delay_hours` par
 * ordre de `position` (`offset`/`limit`), jamais une égalité de valeur.
 *
 * Renvoie `true` si l'échéance a été effectivement posée, `false` sinon
 * (dernière étape, ou garde qui a empêché l'écriture) — pour compter un
 * rattrapage réel plutôt qu'une simple tentative.
 */
export async function poserEcheanceApresDepart(
  ex: Executeur,
  params: ParamsEcheanceApresDepart,
  now: Date,
): Promise<boolean> {
  const etape = await ex.query<{ delay_hours: number }>(
    `select delay_hours from sequence_steps
      where campaign_id = $1
      order by position asc
      offset $2
      limit 1`,
    [params.campaignId, params.currentStep],
  );
  const echeance = echeanceEtapeSuivante(now.getTime(), params.enrollmentId, etape.rows[0]?.delay_hours ?? null);
  if (echeance === null) return false; // dernière étape : rien à planifier, déjà `completed`.
  const ecrit = await ex.query(
    `update enrollments
        set next_action_at = $2
      where id = $1
        and status = 'active'
        and next_action_at is null
        and current_step = $3`,
    [params.enrollmentId, new Date(echeance).toISOString(), params.currentStep],
  );
  return (ecrit.rowCount ?? 0) > 0;
}

/**
 * Variante de `poserEcheanceApresDepart` pour le RATTRAPAGE
 * (`rattraperEcheancesManquantes`, `apps/worker/src/handlers/sequence.ts`) :
 * l'instant de départ n'est pas « maintenant », mais un `dispatched_at` déjà
 * connu, relu en base. Une colonne `timestamptz` revient du pilote `pg` en
 * objet `Date` (jamais une chaîne, malgré ce que déclarent souvent les types
 * de lignes brutes) — `versInstant` (`../temps.js`) l'accepte indifféremment
 * en `Date` ou en chaîne ISO. Import interne au paquet : l'appelant n'a
 * besoin que de cette fonction, jamais de `versInstant` lui-même, donc rien à
 * exporter de plus par l'index du cœur.
 *
 * `false` sans la moindre requête si `dispatchedAt` ne représente pas un
 * instant valide (absent, ou valeur non parseable) — le rattrapage doit
 * laisser l'inscription intacte plutôt que planifier depuis un instant
 * inventé.
 */
export async function poserEcheanceDepuisDispatch(
  ex: Executeur,
  params: ParamsEcheanceApresDepart,
  dispatchedAt: InstantPg,
): Promise<boolean> {
  const instant = versInstant(dispatchedAt);
  if (instant === null) return false;
  return poserEcheanceApresDepart(ex, params, new Date(instant));
}
