import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { enqueueEnvoiLinkedIn, cadenceEnvoiLinkedIn, CADENCE_ENVOI_DEFAUT_MS, CADENCE_ENVOI_MAX_MS } from './envoi-linkedin-producteur.js';

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
    await enqueueEnvoiLinkedIn(boss, creerPool(['org-1']), NOW, async () => ({ quand, motif: null, raison: 'envoi' as const }));
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
      org === 'org-2' ? { quand: NOW, motif: null, raison: 'envoi' } : { quand: null, motif: 'file_vide' },
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toEqual({ organizationId: 'org-2' });
  });

  it('une organisation en echec n empeche pas les autres, et son erreur ne fuit pas', async () => {
    const { boss, send } = creerBoss();
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await enqueueEnvoiLinkedIn(boss, creerPool(['org-1', 'org-2']), NOW, async (_ex, org) => {
      if (org === 'org-1') throw new Error('connexion postgres://user:motdepasse@hote/base refusee');
      return { quand: NOW, motif: null, raison: 'envoi' };
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
      enqueueEnvoiLinkedIn(boss, creerPool(['org-1']), NOW, async () => ({ quand: NOW, motif: null, raison: 'envoi' })),
    ).resolves.toBeUndefined();
  });
});

/**
 * Pool factice qui EVALUE ce que le SQL declare : la liste des organisations n'est filtree que si la
 * requete contient `status = 'active'`, et le mode vient des reglages. Sans cela, un filtre retire
 * du SQL ne ferait rougir personne. Le SQL reel est joue par `test/pg-verify/linkedin-file.sh`.
 */
function poolAvecEtat(sessions: { id: string; status: string }[], mode: 'auto' | 'manual' = 'auto'): Pool {
  const rep = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  return {
    query: vi.fn(async (sql: string, valeurs: unknown[] = []) => {
      if (/select organization_id from linkedin_server_sessions/.test(sql)) {
        const gardees = /status = 'active'/.test(sql) ? sessions.filter((x) => x.status === 'active') : sessions;
        return rep(gardees.map((x) => ({ organization_id: x.id })));
      }
      if (/jr:linkedin_envoi_en_cours/.test(sql)) return rep([{ recentes: '0', perimees: '0' }]);
      if (/jr:linkedin_envoi_en_attente/.test(sql)) return rep([{ existe: true }]);
      if (/from linkedin_server_sessions/.test(sql)) {
        const x = sessions.find((y) => y.id === valeurs[0]);
        return rep(x ? [{ status: x.status, envoi_pause_jusqua: null }] : []);
      }
      if (/from linkedin_settings/.test(sql)) {
        return rep([{ mode, weekly_cap: 100, send_days: [1, 2, 3, 4, 5], send_from_hour: 9, send_to_hour: 18, timezone: 'Europe/Paris' }]);
      }
      if (/count\(\*\) filter/i.test(sql)) return rep([{ last7: '0', today: '0' }]);
      if (/order by sent_at desc/i.test(sql)) return rep([]);
      throw new Error(`requete inattendue : ${sql.slice(0, 60)}`);
    }),
  } as unknown as Pool;
}

describe('enqueueEnvoiLinkedIn, de bout en bout sur la decision', () => {
  it('une organisation dont la session n est pas active ne recoit aucun job', async () => {
    const { boss, send } = creerBoss();
    await enqueueEnvoiLinkedIn(boss, poolAvecEtat([{ id: 'org-1', status: 'active' }, { id: 'org-2', status: 'blocked' }]), NOW);
    expect(send.mock.calls.map((c) => c[1])).toEqual([{ organizationId: 'org-1' }]);
  });

  it('une organisation inactive n est meme pas jugee : pas de lecture, pas de job', async () => {
    // Le jugement lui-meme refuse une session inactive ; ce test tient le FILTRE de la liste, qui
    // evite trois SELECT par organisation et par minute, et ne doit pas dependre de cette redondance.
    const { boss, send } = creerBoss();
    const juger = vi.fn(async () => ({ quand: NOW, motif: null, raison: 'envoi' as const }));
    await enqueueEnvoiLinkedIn(boss, poolAvecEtat([{ id: 'org-1', status: 'active' }, { id: 'org-2', status: 'blocked' }]), NOW, juger);
    expect(juger.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['org-1']);
    expect(send).toHaveBeenCalledTimes(1);
  });

  // Le mode manuel est IMPOSSIBLE en base aujourd'hui (contrainte `mode = 'auto'`, migration
  // 20260831160000) : ce test exerce une branche de precaution, conservatrice, pas un cas reel.
  it('en mode manuel (etat impossible en base aujourd hui, branche de precaution), aucun job n est cree', async () => {
    const { boss, send } = creerBoss();
    await enqueueEnvoiLinkedIn(boss, poolAvecEtat([{ id: 'org-1', status: 'active' }], 'manual'), NOW);
    expect(send).not.toHaveBeenCalled();
  });

  it('en mode automatique, le meme etat cree bien un job', async () => {
    const { boss, send } = creerBoss();
    await enqueueEnvoiLinkedIn(boss, poolAvecEtat([{ id: 'org-1', status: 'active' }]), NOW);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('cadenceEnvoiLinkedIn : une cle vide dans worker.env ne doit pas faire mille passages par seconde', () => {
  it('absente, vide ou illisible : le defaut', () => {
    // `Number('')` vaut 0 et `Number('60s')` NaN : Node ramene alors l'intervalle a 1 ms.
    for (const brut of [undefined, '', '   ', '60s', 'abc', 'NaN', 'Infinity']) {
      expect(cadenceEnvoiLinkedIn(brut)).toBe(CADENCE_ENVOI_DEFAUT_MS);
    }
  });
  it('sous le plancher ou negative : le defaut, pas une rafale', () => {
    expect(cadenceEnvoiLinkedIn('0')).toBe(CADENCE_ENVOI_DEFAUT_MS);
    expect(cadenceEnvoiLinkedIn('1')).toBe(CADENCE_ENVOI_DEFAUT_MS);
    expect(cadenceEnvoiLinkedIn('9999')).toBe(CADENCE_ENVOI_DEFAUT_MS);
    expect(cadenceEnvoiLinkedIn('-60000')).toBe(CADENCE_ENVOI_DEFAUT_MS);
  });
  it('dans la plage : respectee', () => {
    expect(cadenceEnvoiLinkedIn('10000')).toBe(10_000);
    expect(cadenceEnvoiLinkedIn('120000')).toBe(120_000);
  });
  it('au-dessus du plafond : ramenee au plafond', () => {
    expect(cadenceEnvoiLinkedIn(String(CADENCE_ENVOI_MAX_MS * 10))).toBe(CADENCE_ENVOI_MAX_MS);
  });
});
