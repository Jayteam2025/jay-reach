import { beforeEach, describe, expect, it, vi } from 'vitest';

const clients: { connectionString: string; requetes: string[] }[] = [];
vi.mock('pg', () => {
  class Client {
    private readonly infos: { connectionString: string; requetes: string[] };
    constructor(cfg: { connectionString: string }) {
      this.infos = { connectionString: cfg.connectionString, requetes: [] };
      clients.push(this.infos);
    }
    on(): this { return this; }
    removeAllListeners(): this { return this; }
    async connect(): Promise<void> {}
    async query(t: string): Promise<void> { this.infos.requetes.push(t); }
    async end(): Promise<void> {}
  }
  return { default: { Client } };
});

import { ecouterCanalConnexion, urlModeSession } from './ecoute-connexion.js';

const poolSur = (connectionString: string | undefined) => ({ options: { connectionString } }) as unknown as import('pg').Pool;

describe('écoute du canal de connexion', () => {
  beforeEach(() => { clients.length = 0; });

  it('urlModeSession impose 5432 et garde le reste', () => {
    for (const port of ['6543', '5432', '']) {
      expect(urlModeSession(`postgresql://postgres.ref:mdp@pooler.exemple.com${port ? ':' + port : ''}/postgres`))
        .toBe('postgresql://postgres.ref:mdp@pooler.exemple.com:5432/postgres');
    }
  });

  it('le client réellement ouvert par l\'écoute porte 5432, quelle que soit l\'URL du pool (échoue si le forçage disparaît)', async () => {
    const stop = await ecouterCanalConnexion(poolSur('postgresql://u:p@h.exemple.com:6543/postgres'), async () => {});
    stop();
    expect(clients).toHaveLength(1);
    expect(new URL(clients[0]!.connectionString).port).toBe('5432');
    expect(clients[0]!.requetes).toContain('LISTEN jr_linkedin_connexion');
  });

  it('une URL illisible lève sans citer la chaîne reçue', async () => {
    const secret = 'pas une url avec-motdepasse-secret';
    const e = await ecouterCanalConnexion(poolSur(secret), async () => {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(`${(e as Error).message} ${JSON.stringify(e)} ${Object.values(e as object).join(' ')}`).not.toContain('motdepasse');
  });
});
