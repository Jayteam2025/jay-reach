/**
 * Quotas du sender (journalier + horaire). Une action qui dépasse le quota est
 * REPORTÉE, jamais supprimée. Pur.
 */
export interface QuotaState {
  readonly dailyQuota: number;
  readonly hourlyQuota?: number;
  readonly usedToday: number;
  readonly usedThisHour?: number;
}

export interface QuotaAllocation<T> {
  readonly dispatch: T[];
  readonly deferred: T[];
}

export function allocateWithinQuota<T>(
  items: readonly T[],
  quota: QuotaState,
): QuotaAllocation<T> {
  const dailyRemaining = Math.max(0, quota.dailyQuota - quota.usedToday);
  const hourlyRemaining =
    quota.hourlyQuota !== undefined
      ? Math.max(0, quota.hourlyQuota - (quota.usedThisHour ?? 0))
      : Number.POSITIVE_INFINITY;
  const cap = Math.max(0, Math.min(dailyRemaining, hourlyRemaining, items.length));
  return { dispatch: items.slice(0, cap), deferred: items.slice(cap) };
}

/** Une étape `call` ne consomme aucun quota d'envoi. */
export function requiresSendQuota(channel: string): boolean {
  return channel !== 'call';
}
