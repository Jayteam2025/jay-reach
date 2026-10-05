/**
 * Ordonnancement réel (docs/04). Le `delay_hours` est une intention ; le
 * planificateur applique ensuite fenêtre horaire, lead time du canal, jitter.
 * Fonctions pures — l'horloge est passée en argument.
 */
export interface BusinessHours {
  readonly startHour: number; // ex. 9
  readonly endHour: number; // ex. 18 (exclusif)
  readonly days: readonly number[]; // ISO : 1 = lundi … 7 = dimanche
}

function isoDay(date: Date): number {
  return ((date.getUTCDay() + 6) % 7) + 1;
}

/**
 * Décale un instant dans la prochaine fenêtre ouvrée (heures/jours ouvrés du
 * sender, fuseau du contact). `tzOffsetMinutes` = minutes à ajouter à UTC.
 */
export function shiftIntoBusinessHours(
  ms: number,
  hours: BusinessHours,
  tzOffsetMinutes = 0,
): number {
  const offset = tzOffsetMinutes * 60000;
  let local = new Date(ms + offset);

  for (let i = 0; i < 8 * 24; i += 1) {
    const day = isoDay(local);
    const hour = local.getUTCHours();
    const dayOk = hours.days.includes(day);
    if (dayOk && hour >= hours.startHour && hour < hours.endHour) {
      return local.getTime() - offset;
    }
    if (dayOk && hour < hours.startHour) {
      local = new Date(
        Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hours.startHour, 0, 0),
      );
    } else {
      const next = new Date(local.getTime());
      next.setUTCDate(next.getUTCDate() + 1);
      local = new Date(
        Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), hours.startHour, 0, 0),
      );
    }
  }
  return ms;
}

/** Lead time du canal : `dispatch_after = scheduled_for − leadTimeHours`. */
export function applyLeadTime(scheduledForMs: number, leadTimeHours: number): number {
  return scheduledForMs - leadTimeHours * 3600000;
}

/** Jitter déterministe (±ratio) à partir d'une graine — pas de hasard réel. */
export function jitterMs(baseSpacingMs: number, ratio: number, seed: number): number {
  const unit = ((Math.abs(Math.trunc(seed)) % 1000) / 1000) * 2 - 1; // [-1, 1]
  return Math.round(baseSpacingMs * ratio * unit);
}

/**
 * Graine déterministe tirée d'un identifiant. Le jitter doit disperser les
 * envois sans être imprévisible : rejouer un dispatch (idempotent côté
 * `mark_action_dispatched`) doit redonner la même échéance, sinon une reprise
 * après incident déplacerait toutes les échéances déjà posées (issue #111).
 * Seule implémentation : le tick et les gestionnaires d'envoi (SalesBlink,
 * extension LinkedIn) doivent calculer le même jitter à partir du même
 * identifiant d'inscription.
 */
export function graineDeterministe(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

/** Espacement toléré autour de la date prévue : ±20 % (docs/04). */
export const RATIO_JITTER_ECHEANCE = 0.2;

/**
 * Échéance de l'étape suivante, posée au DÉPART RÉEL de l'action précédente
 * (issue #111) — pas à sa création. Avant ce correctif, le tick posait
 * `next_action_at` dès qu'il créait l'action de l'étape courante, en supposant
 * qu'elle partirait aussitôt ; quand un lot d'envois s'étale sur plusieurs
 * jours (expéditeurs saturés), l'étape suivante devenait due avant même que
 * celle-ci ne soit partie.
 *
 * `dispatchedAtMs` est l'instant du départ réel (transition
 * `scheduled -> dispatched`) ; `enrollmentId` fixe le jitter (même graine
 * qu'avant) ; `nextStepDelayHours` vaut `null` si l'action dispatchée était la
 * dernière étape — rien à planifier, l'inscription est déjà `completed`.
 */
export function echeanceEtapeSuivante(
  dispatchedAtMs: number,
  enrollmentId: string,
  nextStepDelayHours: number | null,
): number | null {
  if (nextStepDelayHours === null) return null;
  const brute = dispatchedAtMs + nextStepDelayHours * 3_600_000;
  return brute + jitterMs(Math.max(0, brute - dispatchedAtMs), RATIO_JITTER_ECHEANCE, graineDeterministe(enrollmentId));
}
