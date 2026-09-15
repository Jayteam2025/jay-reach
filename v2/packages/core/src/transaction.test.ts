import { describe, expect, it, vi } from 'vitest';
import type { Executeur } from './executeur.js';
import { dansUneTransaction, type ExecuteurConnectable } from './transaction.js';

/** Faux pool : `connect()` renvoie un faux client qui journalise ses requêtes et son `release()`. */
function fauxPoolConnectable(): { pool: ExecuteurConnectable; appelsPool: string[]; appelsClient: string[]; released: boolean[] } {
  const appelsPool: string[] = [];
  const appelsClient: string[] = [];
  const released: boolean[] = [];

  const query = vi.fn(async (sql: string) => {
    appelsPool.push(sql);
    return { rows: [], rowCount: 0 };
  });

  const clientQuery = vi.fn(async (sql: string) => {
    appelsClient.push(sql);
    return { rows: [], rowCount: 0 };
  });

  const pool: ExecuteurConnectable = {
    query: query as unknown as Executeur['query'],
    connect: vi.fn(async () => ({
      query: clientQuery as unknown as Executeur['query'],
      release: vi.fn(() => {
        released.push(true);
      }),
    })),
  };

  return { pool, appelsPool, appelsClient, released };
}

/** Faux `Executeur` minimal, sans `connect()` — un client déjà loué, ou un faux de test « simple ». */
function fauxExecuteurSimple(): { ex: Executeur; appels: string[] } {
  const appels: string[] = [];
  const query = vi.fn(async (sql: string) => {
    appels.push(sql);
    return { rows: [], rowCount: 0 };
  });
  return { ex: { query: query as unknown as Executeur['query'] }, appels };
}

describe('dansUneTransaction', () => {
  it('(a) cas heureux : begin, requêtes de fn, commit, release — dans cet ordre, rien sur le pool', async () => {
    const { pool, appelsPool, appelsClient, released } = fauxPoolConnectable();

    const resultat = await dansUneTransaction(pool, async (tx) => {
      await tx.query('insert into x values (1)');
      return 'ok';
    });

    expect(resultat).toBe('ok');
    expect(appelsPool).toEqual([]);
    expect(appelsClient).toEqual(['begin', 'insert into x values (1)', 'commit']);
    expect(released).toEqual([true]);
  });

  it('(b) fn lève : rollback, release, l’erreur remonte', async () => {
    const { pool, appelsClient, released } = fauxPoolConnectable();

    await expect(
      dansUneTransaction(pool, async (tx) => {
        await tx.query('insert into x values (1)');
        throw new Error('échec écriture');
      }),
    ).rejects.toThrow('échec écriture');

    expect(appelsClient).toEqual(['begin', 'insert into x values (1)', 'rollback']);
    expect(released).toEqual([true]);
  });

  it('(c) un rollback qui lève à son tour ne masque pas l’erreur d’origine', async () => {
    const { pool, released } = fauxPoolConnectable();
    // Remplace le client loué par un qui fait échouer `rollback`.
    (pool.connect as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      query: vi.fn(async (sql: string) => {
        if (sql === 'rollback') throw new Error('rollback impossible');
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(() => {
        released.push(true);
      }),
    }));

    await expect(
      dansUneTransaction(pool, async () => {
        throw new Error('échec métier');
      }),
    ).rejects.toThrow('échec métier');
    expect(released).toEqual([true]);
  });

  it('(d) `ex` sans `connect()` : `fn(ex)` directement, aucun `begin`', async () => {
    const { ex, appels } = fauxExecuteurSimple();

    const resultat = await dansUneTransaction(ex, async (tx) => {
      await tx.query('select 1');
      return 'direct';
    });

    expect(resultat).toBe('direct');
    expect(appels).toEqual(['select 1']);
  });
});
