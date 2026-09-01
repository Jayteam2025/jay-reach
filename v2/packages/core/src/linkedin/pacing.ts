/**
 * Pacing LinkedIn — garde-fous d'envoi appliqués côté serveur, repris de
 * l'extension interne (JB) et généralisés. Fonctions PURES (aucune I/O), pour
 * pouvoir être testées et réutilisées dans les endpoints de l'extension.
 *
 * Règles : plafond glissant sur 7 jours, fenêtre horaire (Europe/Paris),
 * intervalle aléatoire mais déterministe entre deux actions du même compte.
 */

/**
 * Fenêtre appliquée quand l'opérateur n'en a réglé aucune.
 *
 * Ce n'était pas un défaut mais la seule valeur possible : le pacing lisait ces
 * constantes et ignorait les heures, les jours et le fuseau que l'écran
 * LinkedIn enregistre depuis toujours.
 */
export const WINDOW_START_HOUR = 8;
export const WINDOW_END_HOUR = 21; // exclusif : dernier créneau à 20 h
/** Jours ISO par défaut : du lundi au vendredi. */
export const WINDOW_DAYS: readonly number[] = [1, 2, 3, 4, 5];
export const MIN_INTERVAL_MIN = 1;
export const MAX_INTERVAL_MIN = 20;
export const PROCESSING_TIMEOUT_MIN = 10;
/** Plafond dur absolu par type d'action et par compte, sur 7 jours glissants. */
export const HARD_CAP_7_DAYS = 200;

/** Hash déterministe FNV-1a → [0, 1). Rejoue le même intervalle à chaque poll. */
export function seededRandom(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

/** Heure locale (0–23) à Paris pour une date donnée (DST géré par Intl). */
export function parisHour(now: Date): number {
  return heureLocale(now, 'Europe/Paris').hour;
}

/**
 * Heure et jour de la semaine dans le fuseau demandé.
 *
 * Les deux se lisent ensemble parce qu'ils changent ensemble : à minuit passé,
 * l'heure et le jour basculent d'un coup, et les lire dans deux fuseaux
 * différents ferait partir un message le lundi matin dans un calendrier et le
 * dimanche soir dans l'autre.
 */
export function heureLocale(now: Date, timeZone: string): { hour: number; isoDay: number } {
  const parties = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);
  const hour = Number.parseInt(parties.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24;
  const jours: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const isoDay = jours[parties.find((p) => p.type === 'weekday')?.value ?? 'Mon'] ?? 1;
  return { hour, isoDay };
}

export function isWithinWindow(
  hour: number,
  startHour: number = WINDOW_START_HOUR,
  endHour: number = WINDOW_END_HOUR,
): boolean {
  return hour >= startHour && hour < endHour;
}

export type PaceReason = 'outside_window' | 'weekly_cap_reached' | 'too_soon';
export type PaceDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PaceReason; readonly waitMinutes?: number };

export interface PaceInput {
  /** Heure locale dans le fuseau de l'opérateur (0–23) — via `heureLocale`. */
  readonly hour: number;
  /** Jour ISO local (1 = lundi … 7 = dimanche) — via `heureLocale`. */
  readonly isoDay?: number;
  /** Fenêtre réglée par l'opérateur ; à défaut, celle de la spec. */
  readonly startHour?: number;
  readonly endHour?: number;
  readonly days?: readonly number[];
  /** Nombre d'actions déjà envoyées de ce type sur 7 jours glissants. */
  readonly sentLast7Days: number;
  /** Plafond effectif (min du plafond dur et du volume souhaité). */
  readonly cap7Days: number;
  /** ISO de la dernière action envoyée (tous types) — graine de l'intervalle. */
  readonly lastSentAtIso: string | null;
  /** Minutes écoulées depuis la dernière action envoyée (tous types). */
  readonly minutesSinceLastSent: number | null;
}

/** Décide si une action peut partir maintenant, sinon dit pourquoi. */
export function decideCanSend(input: PaceInput): PaceDecision {
  const jours = input.days && input.days.length > 0 ? input.days : WINDOW_DAYS;
  if (input.isoDay !== undefined && !jours.includes(input.isoDay)) {
    return { ok: false, reason: 'outside_window' };
  }
  if (!isWithinWindow(input.hour, input.startHour, input.endHour)) {
    return { ok: false, reason: 'outside_window' };
  }
  const cap = Math.min(input.cap7Days, HARD_CAP_7_DAYS);
  if (input.sentLast7Days >= cap) {
    return { ok: false, reason: 'weekly_cap_reached' };
  }
  if (input.lastSentAtIso !== null && input.minutesSinceLastSent !== null) {
    const target = MIN_INTERVAL_MIN + seededRandom(input.lastSentAtIso) * (MAX_INTERVAL_MIN - MIN_INTERVAL_MIN);
    if (input.minutesSinceLastSent < target) {
      return { ok: false, reason: 'too_soon', waitMinutes: Math.ceil(target - input.minutesSinceLastSent) };
    }
  }
  return { ok: true };
}
