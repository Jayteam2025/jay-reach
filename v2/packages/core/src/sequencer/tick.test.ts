import { describe, it, expect } from 'vitest';
import { composeTick, type ComposeTickInput, type TickStep } from './tick.js';

const steps: TickStep[] = [
  { id: 'step-a', channel: 'linkedin_invite', delayHours: 0 },
  { id: 'step-b', channel: 'linkedin_message', delayHours: 48 },
];

const base: ComposeTickInput = {
  now: 1_000_000_000_000,
  enrollmentId: 'enr-1',
  currentStep: 0,
  steps,
  suppressed: false,
  requiresApproval: false,
  sendable: true,
};

describe('composeTick', () => {
  it('émet la 1re étape, avance, planifie la suivante avec le délai', () => {
    const r = composeTick(base);
    expect(r.action?.status).toBe('scheduled');
    expect(r.action?.channel).toBe('linkedin_invite');
    expect(r.action?.idempotencyKey).toBe('enr-1:step-a:0');
    expect(r.dispatch).toBe(true);
    expect(r.nextStep).toBe(1);
    expect(r.nextStatus).toBe('active');
    expect(r.nextActionAtMs).toBe(base.now + 48 * 3_600_000);
  });

  it('dernière étape → completed, plus de prochaine action', () => {
    const r = composeTick({ ...base, currentStep: 1 });
    expect(r.action?.channel).toBe('linkedin_message');
    expect(r.nextStatus).toBe('completed');
    expect(r.nextActionAtMs).toBeNull();
    expect(r.dispatch).toBe(true);
  });

  it('étapes épuisées → completed sans action', () => {
    const r = composeTick({ ...base, currentStep: 2 });
    expect(r.action).toBeNull();
    expect(r.nextStatus).toBe('completed');
  });

  it('suppression → action bloquée, inscription arrêtée', () => {
    const r = composeTick({ ...base, suppressed: true });
    expect(r.action?.status).toBe('blocked');
    expect(r.action?.blockReason).toBe('suppression');
    expect(r.nextStatus).toBe('stopped');
    expect(r.dispatch).toBe(false);
    expect(r.nextStep).toBe(0); // n'avance pas
  });

  it('canal non envoyable → bloqué + arrêt', () => {
    const r = composeTick({ ...base, sendable: false });
    expect(r.action?.blockReason).toBe('not_sendable');
    expect(r.nextStatus).toBe('stopped');
    expect(r.dispatch).toBe(false);
  });

  it('validation requise → pending_approval, pas d’avancement ni de dispatch', () => {
    const r = composeTick({ ...base, requiresApproval: true });
    expect(r.action?.status).toBe('pending_approval');
    expect(r.dispatch).toBe(false);
    expect(r.nextStep).toBe(0);
    expect(r.nextStatus).toBe('active');
    expect(r.nextActionAtMs).toBeNull();
  });

  it('rejeu : même clé d’idempotence pour la même (inscription, étape)', () => {
    const a = composeTick(base).action?.idempotencyKey;
    const b = composeTick(base).action?.idempotencyKey;
    expect(a).toBe(b);
  });
});
