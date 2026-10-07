import { describe, expect, it, vi } from 'vitest';
import type PgBoss from 'pg-boss';
import { registerQueues, verifierPolitiquesDeFiles } from './runtime.js';

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

describe('verifierPolitiquesDeFiles : la garantie « un envoi en vol par organisation » se verifie', () => {
  const bossAvec = (reponses: Record<string, { policy: string } | null>): PgBoss =>
    ({ getQueue: vi.fn(async (nom: string) => reponses[nom] ?? null) }) as unknown as PgBoss;

  it('ne rend rien quand la file declaree en stately l est reellement', async () => {
    expect(await verifierPolitiquesDeFiles(bossAvec({ 'linkedin.envoi': { policy: 'stately' } }))).toEqual([]);
  });

  it('designe la file en politique standard et dit quoi faire, sans lever', async () => {
    // `createQueue` est un ON CONFLICT DO NOTHING : une file nee d'une image anterieure y reste.
    const r = await verifierPolitiquesDeFiles(bossAvec({ 'linkedin.envoi': { policy: 'standard' } }));
    expect(r.map((x) => x.file)).toEqual(['linkedin.envoi']);
    expect(r[0]?.message).toMatch(/stately.*standard/s);
    expect(r[0]?.message).toMatch(/PAS consommée/);
    expect(r[0]?.message).toMatch(/deleteQueue/);
  });

  it('designe aussi une file introuvable', async () => {
    const r = await verifierPolitiquesDeFiles(bossAvec({}));
    expect(r.map((x) => x.file)).toEqual(['linkedin.envoi']);
    expect(r[0]?.message).toMatch(/introuvable/);
  });
});
