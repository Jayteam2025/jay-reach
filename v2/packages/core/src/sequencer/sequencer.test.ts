import { describe, expect, it } from 'vitest';
import { applyEvent, isTerminal } from './state-machine.js';
import { applyLeadTime, shiftIntoBusinessHours, type BusinessHours } from './scheduling.js';
import { allocateWithinQuota, requiresSendQuota } from './quota.js';
import { resolveSender, type SenderInfo } from './sender-binding.js';
import { actionIdempotencyKey, dedupeActions, shiftRemainingSteps } from './actions.js';

const HOURS: BusinessHours = { startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] };

describe('machine à états', () => {
  it('une réponse humaine termine l’inscription', () => {
    expect(applyEvent('active', { type: 'human_reply' })).toBe('replied');
  });
  it('un état terminal est définitif', () => {
    expect(isTerminal('replied')).toBe(true);
    expect(applyEvent('replied', { type: 'resume' })).toBe('replied');
    expect(applyEvent('stopped', { type: 'step_advanced', isLast: false })).toBe('stopped');
  });
  it('la dernière étape complète, sinon on reste actif', () => {
    expect(applyEvent('active', { type: 'step_advanced', isLast: true })).toBe('completed');
    expect(applyEvent('active', { type: 'step_advanced', isLast: false })).toBe('active');
  });
  it('pause puis reprise', () => {
    expect(applyEvent('active', { type: 'manual_pause' })).toBe('paused');
    expect(applyEvent('paused', { type: 'resume' })).toBe('active');
  });
});

describe('idempotence du tick', () => {
  it('un tick rejoué deux fois ne crée pas deux actions', () => {
    const key = actionIdempotencyKey('enr1', 'step1');
    const candidates = [{ idempotencyKey: key }];
    const first = dedupeActions([], candidates);
    expect(first).toHaveLength(1);
    const replay = dedupeActions([key], candidates); // clé déjà présente
    expect(replay).toHaveLength(0);
  });
});

describe('ordonnancement', () => {
  it('le lead time du courrier décale dispatch_after sans décaler scheduled_for', () => {
    const scheduledFor = Date.UTC(2026, 7, 18, 10, 0, 0);
    const dispatchAfter = applyLeadTime(scheduledFor, 72);
    expect(dispatchAfter).toBe(scheduledFor - 72 * 3600000);
  });

  it('une action hors fenêtre glisse dans la prochaine fenêtre ouvrée', () => {
    const saturday22h = Date.UTC(2026, 7, 15, 22, 0, 0);
    const shifted = shiftIntoBusinessHours(saturday22h, HOURS);
    const d = new Date(shifted);
    const isoDay = ((d.getUTCDay() + 6) % 7) + 1;
    expect(d.getUTCHours()).toBeGreaterThanOrEqual(9);
    expect(d.getUTCHours()).toBeLessThan(18);
    expect(isoDay).toBeLessThanOrEqual(5);
    expect(shifted).toBeGreaterThan(saturday22h);
    // Un instant déjà valide n'est pas décalé.
    expect(shiftIntoBusinessHours(shifted, HOURS)).toBe(shifted);
  });
});

describe('quotas', () => {
  it('un quota atteint reporte l’action au lieu de la perdre', () => {
    const items = [1, 2, 3];
    const { dispatch, deferred } = allocateWithinQuota(items, { dailyQuota: 5, usedToday: 5 });
    expect(dispatch).toHaveLength(0);
    expect(deferred).toHaveLength(3); // rien de perdu
  });

  it('500 inscriptions ne dépassent jamais le quota journalier', () => {
    const items = Array.from({ length: 500 }, (_, i) => i);
    const { dispatch, deferred } = allocateWithinQuota(items, { dailyQuota: 100, usedToday: 0 });
    expect(dispatch).toHaveLength(100);
    expect(deferred).toHaveLength(400);
  });

  it('une étape call ne consomme aucun quota d’envoi', () => {
    expect(requiresSendQuota('call')).toBe(false);
    expect(requiresSendQuota('email')).toBe(true);
  });
});

describe('attribution des expéditeurs', () => {
  const senders: SenderInfo[] = [
    { id: 'sA', kind: 'email', isActive: true, usedToday: 30 },
    { id: 'sB', kind: 'email', isActive: true, usedToday: 5 },
  ];

  it('première action : le sender actif du bon type le moins consommé', () => {
    const r = resolveSender('c1', 'email', senders, []);
    expect(r).toMatchObject({ senderId: 'sB', newBinding: true });
  });

  it('un contact reçoit toujours du même expéditeur (lien à vie)', () => {
    const bindings = [{ contactId: 'c1', senderId: 'sA' }];
    const r = resolveSender('c1', 'email', senders, bindings);
    expect(r).toMatchObject({ senderId: 'sA', newBinding: false });
  });

  it('sender lié devenu inactif → pause, jamais de réattribution silencieuse', () => {
    const inactive: SenderInfo[] = [{ id: 'sA', kind: 'email', isActive: false, usedToday: 0 }, senders[1]!];
    const r = resolveSender('c1', 'email', inactive, [{ contactId: 'c1', senderId: 'sA' }]);
    expect(r).toMatchObject({ senderId: null, paused: true });
  });
});

describe('résultat d’appel', () => {
  it('un callback décale toutes les étapes suivantes, pas seulement la prochaine', () => {
    const steps = [{ scheduledFor: 100 }, { scheduledFor: 200 }, { scheduledFor: 300 }];
    const shifted = shiftRemainingSteps(steps, 50);
    expect(shifted.map((s) => s.scheduledFor)).toEqual([150, 250, 350]);
  });
});
