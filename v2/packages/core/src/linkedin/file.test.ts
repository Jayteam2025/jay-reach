import { describe, it, expect } from 'vitest';
import type { Executeur } from '../executeur.js';
import { reclamerProchaineAction, mettreEnPauseEnvoiLinkedIn } from './file.js';

const ORG = 'org-1';
// Mardi 15/09/2026 10:00 UTC = 12:00 Paris, en semaine.
const NOW = new Date('2026-09-15T10:00:00.000Z');

interface Etat {
  reglages: { weekly_cap: number; send_from_hour: number; send_to_hour: number } | null;
  envoyesSur7Jours: number;
  campagneStatut: string | null;
  coinceDepuis: string | null;
  pauseJusqua: string | null;
}

interface Appel {
  readonly sql: string;
  readonly values: unknown[];
}

/**
 * Exécuteur factice AVEC ÉTAT : il évalue ce que le SQL produit déclare (filtre
 * `camp.status = 'active'`, filtre `method = 'serveur'`), pour qu'un garde-fou
 * retiré du SQL fasse échouer le test.
 */
function creerExecuteur(depart: Partial<Etat> = {}) {
  const etat: Etat = {
    reglages: { weekly_cap: 100, send_from_hour: 9, send_to_hour: 18 },
    envoyesSur7Jours: 0,
    campagneStatut: null,
    coinceDepuis: null,
    pauseJusqua: null,
    ...depart,
  };
  let enProcessing = etat.coinceDepuis !== null;
  const appels: Appel[] = [];
  const rep = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const ex: Executeur = {
    async query(sql: string, values: unknown[] = []) {
      appels.push({ sql, values });
      if (/from linkedin_server_sessions/i.test(sql)) return rep(etat.pauseJusqua ? [{ envoi_pause_jusqua: etat.pauseJusqua }] : []) as never;
      if (/update linkedin_server_sessions/i.test(sql)) {
        etat.pauseJusqua = values[1] as string;
        return { rows: [], rowCount: 1 } as never;
      }
      if (/set status = 'pending', processing_started_at = null/i.test(sql)) {
        const cutoff = values[1] as string;
        if (enProcessing && etat.coinceDepuis !== null && etat.coinceDepuis < cutoff) enProcessing = false;
        return { rows: [], rowCount: 0 } as never;
      }
      if (/from linkedin_settings/i.test(sql)) {
        return rep(
          etat.reglages ? [{ mode: 'auto', send_days: [1, 2, 3, 4, 5], timezone: 'Europe/Paris', ...etat.reglages }] : [],
        ) as never;
      }
      if (/count\(\*\) filter/i.test(sql)) return rep([{ last7: String(etat.envoyesSur7Jours), today: '0' }]) as never;
      if (/select sent_at from linkedin_action_queue/i.test(sql)) return rep([]) as never;
      if (/select q\.id/i.test(sql)) {
        if (!/q\.method = 'serveur'/.test(sql)) throw new Error('le candidat doit se filtrer sur method = serveur');
        if (enProcessing) return rep([]) as never;
        const filtre = /camp\.status\s*=\s*'active'/i.test(sql);
        const ok = !filtre || etat.campagneStatut === null || etat.campagneStatut === 'active';
        return rep(ok ? [{ id: 'file-1' }] : []) as never;
      }
      if (/set status = 'processing'/i.test(sql)) {
        return rep([{ id: 'file-1', kind: 'invite', linkedinUrl: 'https://linkedin.com/in/x', messageBody: null }]) as never;
      }
      throw new Error(`requete non prevue par le test :\n${sql}`);
    },
  };
  return { ex, etat, appels };
}

describe('reclamerProchaineAction', () => {
  it('hors fenetre horaire, rien n est reclame', async () => {
    const { ex, appels } = creerExecuteur();
    const nuit = new Date('2026-09-15T03:00:00.000Z'); // 05:00 Paris
    const r = await reclamerProchaineAction(ex, ORG, nuit);
    expect(r.action).toBeNull();
    expect(r.motif).toBe('outside_window');
    expect(appels.some((a) => /set status = 'processing'/i.test(a.sql))).toBe(false);
  });

  it('le plafond hebdomadaire atteint refuse la reclamation', async () => {
    const { ex } = creerExecuteur({ envoyesSur7Jours: 100 });
    const r = await reclamerProchaineAction(ex, ORG, NOW);
    expect(r.action).toBeNull();
    expect(r.motif).toBe('weekly_cap_reached');
  });

  it('un plafond abaisse s applique des la reclamation suivante', async () => {
    const { ex, etat } = creerExecuteur({ envoyesSur7Jours: 50 });
    const avant = await reclamerProchaineAction(ex, ORG, NOW);
    expect(avant.action?.id).toBe('file-1');
    etat.reglages = { weekly_cap: 50, send_from_hour: 9, send_to_hour: 18 };
    const apres = await reclamerProchaineAction(ex, ORG, NOW);
    expect(apres.action).toBeNull();
    expect(apres.motif).toBe('weekly_cap_reached');
  });

  it('une action dont la campagne n est pas active n est pas reclamee', async () => {
    const { ex, appels } = creerExecuteur({ campagneStatut: 'paused' });
    const r = await reclamerProchaineAction(ex, ORG, NOW);
    expect(r).toEqual({ action: null, motif: 'queue_empty' });
    expect(appels.some((a) => /set status = 'processing'/i.test(a.sql))).toBe(false);
  });

  it('une ligne coincee en processing depuis plus de dix minutes redevient reclamable', async () => {
    const { ex } = creerExecuteur({ coinceDepuis: new Date(NOW.getTime() - 11 * 60_000).toISOString() });
    const r = await reclamerProchaineAction(ex, ORG, NOW);
    expect(r.action?.id).toBe('file-1');

    const recente = creerExecuteur({ coinceDepuis: new Date(NOW.getTime() - 5 * 60_000).toISOString() });
    const r2 = await reclamerProchaineAction(recente.ex, ORG, NOW);
    expect(r2.motif).toBe('queue_empty');
  });

  it('un canal en pause refuse la reclamation jusqu a l echeance, puis l accepte', async () => {
    const { ex } = creerExecuteur();
    const jusqua = new Date(NOW.getTime() + 60 * 60_000);
    await mettreEnPauseEnvoiLinkedIn(ex, ORG, jusqua);

    const pendant = await reclamerProchaineAction(ex, ORG, NOW);
    expect(pendant).toEqual({ action: null, motif: 'canal_en_pause' });

    const apres = await reclamerProchaineAction(ex, ORG, new Date(jusqua.getTime() + 1));
    expect(apres.action?.id).toBe('file-1');
  });
});
