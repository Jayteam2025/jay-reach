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

  it('passe quand la file declaree en stately l est reellement', async () => {
    await expect(verifierPolitiquesDeFiles(bossAvec({ 'linkedin.envoi': { policy: 'stately' } }))).resolves.toBeUndefined();
  });

  it('refuse de demarrer quand la file existe en politique standard, et dit quoi faire', async () => {
    // `createQueue` est un ON CONFLICT DO NOTHING : une file nee d'une image anterieure y reste.
    const boss = bossAvec({ 'linkedin.envoi': { policy: 'standard' } });
    await expect(verifierPolitiquesDeFiles(boss)).rejects.toThrow(/linkedin\.envoi.*stately.*standard/s);
    await expect(verifierPolitiquesDeFiles(boss)).rejects.toThrow(/deleteQueue|supprim/i);
  });

  it('refuse aussi quand la file est introuvable', async () => {
    await expect(verifierPolitiquesDeFiles(bossAvec({}))).rejects.toThrow(/linkedin\.envoi/);
  });
});
