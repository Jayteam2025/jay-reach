import { describe, it, expect } from 'vitest';
import {
  decideCanSend,
  isWithinWindow,
  seededRandom,
  parisHour,
  WINDOW_START_HOUR,
  WINDOW_END_HOUR,
  type PaceInput,
} from './pacing.js';

const base: PaceInput = { hour: 10, sentLast7Days: 0, cap7Days: 25, lastSentAtIso: null, minutesSinceLastSent: null };

describe('pacing LinkedIn', () => {
  it('accepte dans la fenêtre, sous le plafond, sans envoi récent', () => {
    expect(decideCanSend(base)).toEqual({ ok: true });
  });

  it('refuse hors fenêtre horaire', () => {
    expect(decideCanSend({ ...base, hour: 7 })).toEqual({ ok: false, reason: 'outside_window' });
    expect(decideCanSend({ ...base, hour: 21 })).toEqual({ ok: false, reason: 'outside_window' });
    expect(isWithinWindow(WINDOW_START_HOUR)).toBe(true);
    expect(isWithinWindow(WINDOW_END_HOUR)).toBe(false);
  });

  it('refuse quand le plafond 7 jours est atteint', () => {
    expect(decideCanSend({ ...base, sentLast7Days: 25, cap7Days: 25 })).toEqual({
      ok: false,
      reason: 'weekly_cap_reached',
    });
  });

  it('applique le plafond dur même si le volume demandé est plus haut', () => {
    expect(decideCanSend({ ...base, sentLast7Days: 200, cap7Days: 500 })).toEqual({
      ok: false,
      reason: 'weekly_cap_reached',
    });
  });

  it('refuse « trop tôt » et rejoue le même intervalle (déterministe)', () => {
    const iso = '2026-08-20T10:00:00.000Z';
    const d1 = decideCanSend({ ...base, lastSentAtIso: iso, minutesSinceLastSent: 0 });
    const d2 = decideCanSend({ ...base, lastSentAtIso: iso, minutesSinceLastSent: 0 });
    expect(d1.ok).toBe(false);
    expect(d1).toEqual(d2); // même graine → même décision
    if (!d1.ok) {
      expect(d1.reason).toBe('too_soon');
      expect(d1.waitMinutes).toBeGreaterThanOrEqual(1);
      expect(d1.waitMinutes).toBeLessThanOrEqual(20);
    }
  });

  it('laisse passer une fois l’intervalle dépassé', () => {
    const iso = '2026-08-20T10:00:00.000Z';
    expect(decideCanSend({ ...base, lastSentAtIso: iso, minutesSinceLastSent: 21 })).toEqual({ ok: true });
  });

  it('seededRandom est dans [0,1) et stable', () => {
    const a = seededRandom('x');
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(seededRandom('x')).toBe(a);
  });

  it('parisHour renvoie une heure 0–23', () => {
    const h = parisHour(new Date('2026-08-20T12:00:00.000Z'));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(23);
  });
});
