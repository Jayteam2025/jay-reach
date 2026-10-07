import { describe, expect, it, vi } from 'vitest';
import type PgBoss from 'pg-boss';
import { registerQueues } from './runtime.js';

describe('registerQueues', () => {
  it('transmet la politique de file : l envoi LinkedIn est declare en stately', async () => {
    const createQueue = vi.fn(async () => undefined);
    await registerQueues({ createQueue } as unknown as PgBoss);
    const appels = createQueue.mock.calls as unknown as [string, { policy?: string; retryLimit: number }][];
    const envoi = appels.find(([nom]) => nom === 'linkedin.envoi');
    expect(envoi?.[1].policy).toBe('stately');
    expect(envoi?.[1].retryLimit).toBe(0);
    const standard = appels.find(([nom]) => nom === 'sources.discover');
    expect(standard?.[1].policy).toBeUndefined();
  });
});
