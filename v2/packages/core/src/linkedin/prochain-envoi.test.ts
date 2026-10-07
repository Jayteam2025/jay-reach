import { describe, it, expect } from 'vitest';
import type { Executeur } from '../executeur.js';
import { prochainEnvoiLinkedIn } from './file.js';
import { seededRandom } from './pacing.js';

const ORG = 'org-1';
// Mardi 15/09/2026 10:00 UTC = 12:00 Paris, en semaine, dans la fenetre 9 h - 18 h.
const NOW = new Date('2026-09-15T10:00:00.000Z');

interface Etat {
  statutSession: string | null;
  pauseJusqua: string | null;
  /** Lignes serveur en processing depuis moins / plus de dix minutes. */
  enCoursRecentes: number;
  enCoursPerimees: number;
  enAttente: boolean;
  mode: 'auto' | 'hybrid' | 'manual';
  hebdo: number;
  envoyesSur7Jours: number;
  /** Ce que `pg` rend pour un timestamptz : un `Date`, pas une chaine. */
  dernierEnvoi: string | Date | null;
  deLaJournee: number;
}

/**
 * Executeur factice : ce test ne prouve que la DECISION (ordre des refus, calcul de la date).
 * Le SQL, lui, est joue sur un vrai Postgres par `test/pg-verify/linkedin-file.sh`.
 */
function creerExecuteur(depart: Partial<Etat> = {}): Executeur {
  const etat: Etat = {
    statutSession: 'active',
    pauseJusqua: null,
    enCoursRecentes: 0,
    enCoursPerimees: 0,
    enAttente: true,
    mode: 'auto',
    hebdo: 100,
    envoyesSur7Jours: 0,
    dernierEnvoi: null,
    deLaJournee: 0,
    ...depart,
  };
  const rep = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  return {
    async query(sql: string) {
      if (/jr:linkedin_envoi_en_cours/.test(sql)) {
        return rep([{ recentes: String(etat.enCoursRecentes), perimees: String(etat.enCoursPerimees) }]) as never;
      }
      if (/jr:linkedin_envoi_en_attente/.test(sql)) return rep([{ existe: etat.enAttente }]) as never;
      if (/from linkedin_server_sessions/i.test(sql)) {
        return rep(etat.statutSession === null ? [] : [{ status: etat.statutSession, envoi_pause_jusqua: etat.pauseJusqua }]) as never;
      }
      if (/from linkedin_settings/i.test(sql)) {
        return rep([
          { mode: etat.mode, weekly_cap: etat.hebdo, send_days: [1, 2, 3, 4, 5], send_from_hour: 9, send_to_hour: 18, timezone: 'Europe/Paris' },
        ]) as never;
      }
      if (/count\(\*\) filter/i.test(sql)) {
        return rep([{ last7: String(etat.envoyesSur7Jours), today: String(etat.deLaJournee) }]) as never;
      }
      if (/order by sent_at desc/i.test(sql)) return rep(etat.dernierEnvoi ? [{ sent_at: etat.dernierEnvoi }] : []) as never;
      throw new Error(`requete inattendue : ${sql.slice(0, 80)}`);
    },
  };
}

describe('prochainEnvoiLinkedIn', () => {
  it('rend maintenant quand un envoi est possible', async () => {
    const r = await prochainEnvoiLinkedIn(creerExecuteur(), ORG, NOW);
    expect(r).toEqual({ quand: NOW, motif: null });
  });

  it('ne planifie rien sans session active', async () => {
    expect((await prochainEnvoiLinkedIn(creerExecuteur({ statutSession: 'blocked' }), ORG, NOW)).motif).toBe('session_inactive');
    expect((await prochainEnvoiLinkedIn(creerExecuteur({ statutSession: null }), ORG, NOW)).quand).toBeNull();
  });

  it('ne planifie rien pendant la pause d envoi', async () => {
    const r = await prochainEnvoiLinkedIn(creerExecuteur({ pauseJusqua: '2026-09-15T12:00:00.000Z' }), ORG, NOW);
    expect(r).toEqual({ quand: null, motif: 'canal_en_pause' });
  });

  it('ne planifie rien quand la file est vide', async () => {
    const r = await prochainEnvoiLinkedIn(creerExecuteur({ enAttente: false }), ORG, NOW);
    expect(r).toEqual({ quand: null, motif: 'file_vide' });
  });

  it('ne planifie rien tant qu une action est en vol : un second job viserait la meme session', async () => {
    const r = await prochainEnvoiLinkedIn(creerExecuteur({ enCoursRecentes: 1 }), ORG, NOW);
    expect(r).toEqual({ quand: null, motif: 'action_en_cours' });
  });

  it('planifie quand meme une ligne coincee depuis plus de dix minutes : le handler la repare', async () => {
    // Sinon la ligne resterait `processing` pour toujours : seul un job la ferait passer en echec visible.
    const r = await prochainEnvoiLinkedIn(creerExecuteur({ enCoursPerimees: 1, enAttente: false }), ORG, NOW);
    expect(r).toEqual({ quand: NOW, motif: null });
  });

  it('une action en vol l emporte sur une ligne perimee', async () => {
    const r = await prochainEnvoiLinkedIn(creerExecuteur({ enCoursRecentes: 1, enCoursPerimees: 1 }), ORG, NOW);
    expect(r.motif).toBe('action_en_cours');
  });

  it('date le job au moment ou l intervalle irregulier s acheve', async () => {
    const dernier = new Date(NOW.getTime() - 30_000).toISOString();
    const r = await prochainEnvoiLinkedIn(creerExecuteur({ dernierEnvoi: dernier }), ORG, NOW);
    const cible = new Date(dernier).getTime() + (1 + seededRandom(dernier) * 19) * 60_000;
    expect(r.motif).toBeNull();
    // Arrondi a la minute superieure par le pacing : jamais avant la cible, jamais plus d une minute apres.
    expect(r.quand!.getTime()).toBeGreaterThanOrEqual(cible);
    expect(r.quand!.getTime() - cible).toBeLessThan(60_000);
    expect(r.quand!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('l intervalle depend de la date du dernier envoi tel que pg la fournit (un Date)', async () => {
    // Le test precedent passait une chaine ISO : il n exercait pas le type de la production,
    // et c est lui qui masquait un intervalle constant.
    const cibles: number[] = [];
    for (const secondes of [20, 30, 40, 50, 55]) {
      const dernier = new Date(NOW.getTime() - secondes * 1000);
      const r = await prochainEnvoiLinkedIn(creerExecuteur({ dernierEnvoi: dernier }), ORG, NOW);
      const attendu = dernier.getTime() + (1 + seededRandom(dernier.toISOString()) * 19) * 60_000;
      expect(r.quand!.getTime()).toBeGreaterThanOrEqual(attendu);
      expect(r.quand!.getTime() - attendu).toBeLessThan(60_000);
      cibles.push(r.quand!.getTime() - dernier.getTime());
    }
    expect(new Set(cibles).size).toBeGreaterThan(1);
  });

  it('rend maintenant une fois l intervalle ecoule', async () => {
    const dernier = new Date(NOW.getTime() - 21 * 60_000).toISOString();
    const r = await prochainEnvoiLinkedIn(creerExecuteur({ dernierEnvoi: dernier }), ORG, NOW);
    expect(r).toEqual({ quand: NOW, motif: null });
  });

  it('ne planifie rien hors de la fenetre horaire', async () => {
    const nuit = new Date('2026-09-15T20:00:00.000Z'); // 22 h Paris
    const r = await prochainEnvoiLinkedIn(creerExecuteur(), ORG, nuit);
    expect(r).toEqual({ quand: null, motif: 'outside_window' });
  });

  it('ne planifie rien au plafond hebdomadaire ni au plafond du jour', async () => {
    expect((await prochainEnvoiLinkedIn(creerExecuteur({ envoyesSur7Jours: 100 }), ORG, NOW)).motif).toBe('weekly_cap_reached');
    // 100 / 5 jours = 20 par jour.
    expect((await prochainEnvoiLinkedIn(creerExecuteur({ deLaJournee: 20 }), ORG, NOW)).motif).toBe('daily_cap_reached');
  });

  it('ne planifie rien en mode manuel', async () => {
    expect((await prochainEnvoiLinkedIn(creerExecuteur({ mode: 'manual' }), ORG, NOW)).motif).toBe('manual_mode');
  });
});
