import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { enqueueEnvoiLinkedIn } from './envoi-linkedin-producteur.js';

const NOW = new Date('2026-09-15T10:00:00.000Z');

function creerBoss() {
  const send = vi.fn(async (_file: string, _donnees: object, _options: object) => 'job-id' as string | null);
  return { boss: { send } as unknown as PgBoss, send };
}
function creerPool(organisations: string[]): Pool {
  return { query: vi.fn(async () => ({ rows: organisations.map((id) => ({ organization_id: id })), rowCount: organisations.length })) } as unknown as Pool;
}

describe('enqueueEnvoiLinkedIn', () => {
  it('depose un job date, unique par organisation', async () => {
    const { boss, send } = creerBoss();
    const quand = new Date(NOW.getTime() + 7 * 60_000);
    await enqueueEnvoiLinkedIn(boss, creerPool(['org-1']), NOW, async () => ({ quand, motif: null }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('linkedin.envoi', { organizationId: 'org-1' }, { singletonKey: 'org-1', startAfter: quand });
  });

  it('ne depose rien quand aucun envoi n est possible : pas de job pour rien', async () => {
    const { boss, send } = creerBoss();
    await enqueueEnvoiLinkedIn(boss, creerPool(['org-1']), NOW, async () => ({ quand: null, motif: 'too_soon' }));
    expect(send).not.toHaveBeenCalled();
  });

  it('juge chaque organisation avec sa propre decision', async () => {
    const { boss, send } = creerBoss();
    await enqueueEnvoiLinkedIn(boss, creerPool(['org-1', 'org-2']), NOW, async (_ex, org) =>
      org === 'org-2' ? { quand: NOW, motif: null } : { quand: null, motif: 'file_vide' },
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toEqual({ organizationId: 'org-2' });
  });

  it('une organisation en echec n empeche pas les autres, et son erreur ne fuit pas', async () => {
    const { boss, send } = creerBoss();
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await enqueueEnvoiLinkedIn(boss, creerPool(['org-1', 'org-2']), NOW, async (_ex, org) => {
      if (org === 'org-1') throw new Error('connexion postgres://user:motdepasse@hote/base refusee');
      return { quand: NOW, motif: null };
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toEqual({ organizationId: 'org-2' });
    const sortie = erreur.mock.calls.flat().join(' ');
    expect(sortie).not.toContain('motdepasse');
    erreur.mockRestore();
  });

  it('un job deja en attente (send rend null) n est pas une erreur', async () => {
    const { boss, send } = creerBoss();
    send.mockResolvedValueOnce(null);
    await expect(
      enqueueEnvoiLinkedIn(boss, creerPool(['org-1']), NOW, async () => ({ quand: NOW, motif: null })),
    ).resolves.toBeUndefined();
  });
});
