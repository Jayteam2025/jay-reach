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
