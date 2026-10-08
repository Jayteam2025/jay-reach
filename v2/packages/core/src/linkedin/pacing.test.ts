import { describe, it, expect } from 'vitest';
import {
  decideCanSend,
  isWithinWindow,
  seededRandom,
  parisHour,
  heureLocale,
  WINDOW_START_HOUR,
  WINDOW_END_HOUR,
  WINDOW_DAYS,
  type PaceInput,
} from './pacing.js';
import { HEURES_ENVOI_LINKEDIN_PAR_DEFAUT } from './reglages-envoi.js';

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

  it('seededRandom refuse une graine qui n est pas une chaine', () => {
    // `pg` rend les timestamptz en `Date` : sur un `Date`, `.length` vaut undefined, la boucle ne
    // tournait pas et la fonction rendait une constante, soit un intervalle de 3 min 35 s a chaque envoi.
    expect(() => seededRandom(new Date('2026-08-20T10:00:00.000Z') as unknown as string)).toThrow(TypeError);
    expect(() => seededRandom(undefined as unknown as string)).toThrow(TypeError);
  });

  it('deux graines differentes donnent deux valeurs differentes', () => {
    expect(seededRandom('2026-08-20T10:00:00.000Z')).not.toBe(seededRandom('2026-08-20T10:00:01.000Z'));
  });

  it('parisHour renvoie une heure 0–23', () => {
    const h = parisHour(new Date('2026-08-20T12:00:00.000Z'));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(23);
  });
});

describe('la fenêtre saisie à l’écran est celle qui s’applique', () => {
  const base = {
    sentLast7Days: 0,
    cap7Days: 100,
    lastSentAtIso: null,
    minutesSinceLastSent: null,
  };

  it('respecte des heures autres que 8 h - 21 h', () => {
    // L'écran LinkedIn enregistre une plage horaire depuis toujours ; le pacing
    // appliquait 8 h - 21 h codées en dur et l'ignorait.
    const fenetre = { startHour: 10, endHour: 12, days: [1, 2, 3, 4, 5] };
    expect(decideCanSend({ ...base, hour: 9, isoDay: 1, ...fenetre })).toEqual({
      ok: false,
      reason: 'outside_window',
    });
    expect(decideCanSend({ ...base, hour: 10, isoDay: 1, ...fenetre })).toEqual({ ok: true });
    expect(decideCanSend({ ...base, hour: 12, isoDay: 1, ...fenetre })).toEqual({
      ok: false,
      reason: 'outside_window',
    });
  });

  it('respecte les jours cochés', () => {
    // Cocher « lundi à vendredi » n'empêchait rien : le samedi partait comme
    // les autres jours.
    const fenetre = { startHour: 8, endHour: 21, days: [1, 2, 3, 4, 5] };
    expect(decideCanSend({ ...base, hour: 10, isoDay: 6, ...fenetre })).toEqual({
      ok: false,
      reason: 'outside_window',
    });
    expect(decideCanSend({ ...base, hour: 10, isoDay: 5, ...fenetre })).toEqual({ ok: true });
  });

  it('applique le plafond hebdomadaire de l’opérateur, sans dépasser le plafond dur', () => {
    // `weekly_cap` était enregistré et jamais lu : seul le plafond dur de 200
    // s'appliquait, quel que soit le curseur.
    expect(
      decideCanSend({ ...base, hour: 10, isoDay: 1, sentLast7Days: 30, cap7Days: 30 }),
    ).toEqual({ ok: false, reason: 'weekly_cap_reached' });
    expect(
      decideCanSend({ ...base, hour: 10, isoDay: 1, sentLast7Days: 250, cap7Days: 10_000 }),
    ).toEqual({ ok: false, reason: 'weekly_cap_reached' });
  });

  it('lit l’heure ET le jour dans le fuseau demandé', () => {
    // Mardi 1er septembre 2026, 22 h 30 UTC. À Paris il est déjà minuit passé,
    // donc mercredi ; à Montréal il fait encore jour, et c'est toujours mardi.
    // Les deux basculent ensemble : les lire dans deux fuseaux différents
    // ferait partir un message le mercredi pour l'heure et le mardi pour le
    // jour.
    const d = new Date('2026-09-01T22:30:00Z');
    expect(heureLocale(d, 'Europe/Paris')).toEqual({ hour: 0, isoDay: 3 });
    expect(heureLocale(d, 'America/Montreal')).toEqual({ hour: 18, isoDay: 2 });
  });

  it('les constantes de fenêtre du rythme SONT la constante unique des heures d’envoi par défaut', () => {
    // Deux constantes distinctes ont déjà divergé : 8 h - 21 h appliqué, 9 h - 18 h annoncé.
    expect(WINDOW_START_HOUR).toBe(HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.debutHeure);
    expect(WINDOW_END_HOUR).toBe(HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.finHeure);
    expect([...WINDOW_DAYS]).toEqual([...HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.jours]);
  });

  it('retombe sur la fenêtre par défaut quand rien n’est réglé', () => {
    expect(decideCanSend({ ...base, hour: WINDOW_START_HOUR - 1, isoDay: 1 })).toEqual({ ok: false, reason: 'outside_window' });
    expect(decideCanSend({ ...base, hour: WINDOW_START_HOUR, isoDay: 1 })).toEqual({ ok: true });
    expect(decideCanSend({ ...base, hour: WINDOW_END_HOUR - 1, isoDay: 1 })).toEqual({ ok: true });
    expect(decideCanSend({ ...base, hour: WINDOW_END_HOUR, isoDay: 1 })).toEqual({ ok: false, reason: 'outside_window' });
  });
});
