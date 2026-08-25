/**
 * Pacing LinkedIn — garde-fous d'envoi appliqués côté serveur, repris de
 * l'extension interne (JB) et généralisés. Fonctions PURES (aucune I/O), pour
 * pouvoir être testées et réutilisées dans les endpoints de l'extension.
 *
 * Règles : plafond glissant sur 7 jours, fenêtre horaire (Europe/Paris),
 * intervalle aléatoire mais déterministe entre deux actions du même compte.
 */

export const WINDOW_START_HOUR = 8;
export const WINDOW_END_HOUR = 21; // exclusif : dernier créneau à 20 h
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
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return Number.parseInt(s, 10) % 24;
}

export function isWithinWindow(hour: number): boolean {
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

export type PaceReason = 'outside_window' | 'weekly_cap_reached' | 'too_soon';
export type PaceDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PaceReason; readonly waitMinutes?: number };

export interface PaceInput {
  /** Heure locale Paris (0–23) — via `parisHour(now)`. */
  readonly hour: number;
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
  if (!isWithinWindow(input.hour)) {
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
