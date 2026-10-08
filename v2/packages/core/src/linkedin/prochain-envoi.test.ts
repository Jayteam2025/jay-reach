import { describe, it, expect } from 'vitest';
import type { Executeur } from '../executeur.js';
import { prochainEnvoiLinkedIn, REQUETES_PAR_ENVOI, type TypeActionLinkedIn } from './file.js';
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
  /** Plafonds hebdomadaires de `organization_settings`, un par type. */
  hebdo: Record<TypeActionLinkedIn, number>;
  envoyesSur7Jours: Record<TypeActionLinkedIn, number>;
  /** Type de l'action en tête de file. */
  kind: TypeActionLinkedIn;
  /** Plafond horaire de requêtes, et requêtes déjà émises (horodatages, du plus ancien au plus récent). */
  plafondHoraire: number;
  requetesDeLHeure: Date[];
  /** Ce que `pg` rend pour un timestamptz : un `Date`, pas une chaine. */
  dernierEnvoi: string | Date | null;
  deLaJournee: Record<TypeActionLinkedIn, number>;
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
    hebdo: { invite: 100, message: 200 },
    envoyesSur7Jours: { invite: 0, message: 0 },
    kind: 'invite',
    plafondHoraire: 60,
    requetesDeLHeure: [],
    dernierEnvoi: null,
    deLaJournee: { invite: 0, message: 0 },
    ...depart,
  };
  const rep = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  return {
    async query(sql: string, values: unknown[] = []) {
      if (/jr:linkedin_envoi_en_cours/.test(sql)) {
        return rep([{ recentes: String(etat.enCoursRecentes), perimees: String(etat.enCoursPerimees) }]) as never;
      }
      if (/jr:linkedin_candidates_par_type/.test(sql)) return rep(etat.enAttente ? [{ id: 'file-1', kind: etat.kind }] : []) as never;
      if (/from organization_settings/i.test(sql)) {
        const cle = values[1];
        const valeur =
          cle === 'linkedin_requetes_par_heure'
            ? etat.plafondHoraire
            : cle === 'linkedin_invitations_par_semaine'
              ? etat.hebdo.invite
              : etat.hebdo.message;
        return rep([{ value: valeur }]) as never;
      }
      if (/jr:linkedin_requetes_compter/.test(sql)) {
        const depuis = new Date(String(values[1] instanceof Date ? values[1].toISOString() : values[1])).getTime();
        return rep([{ n: etat.requetesDeLHeure.filter((t) => t.getTime() >= depuis).length }]) as never;
      }
      if (/jr:linkedin_budget_horaire_liberation/.test(sql)) {
        const depuis = new Date(String(values[1])).getTime();
        const decalage = Number(values[2]);
        const dedans = etat.requetesDeLHeure.filter((t) => t.getTime() >= depuis).sort((a, b) => a.getTime() - b.getTime());
        return rep(dedans[decalage] ? [{ requested_at: dedans[decalage] }] : []) as never;
      }
      if (/from linkedin_server_sessions/i.test(sql)) {
        return rep(etat.statutSession === null ? [] : [{ status: etat.statutSession, envoi_pause_jusqua: etat.pauseJusqua }]) as never;
      }
      if (/from linkedin_settings/i.test(sql)) {
        return rep([
          { mode: etat.mode, send_days: [1, 2, 3, 4, 5], send_from_hour: 9, send_to_hour: 18, timezone: 'Europe/Paris' },
        ]) as never;
      }
      if (/count\(\*\) filter/i.test(sql)) {
        return rep(
          (['invite', 'message'] as const).map((kind) => ({
            kind,
            last7: String(etat.envoyesSur7Jours[kind]),
            today: String(etat.deLaJournee[kind]),
          })),
        ) as never;
      }
      if (/order by sent_at desc/i.test(sql)) return rep(etat.dernierEnvoi ? [{ sent_at: etat.dernierEnvoi }] : []) as never;
      throw new Error(`requete inattendue : ${sql.slice(0, 80)}`);
    },
  };
}

describe('prochainEnvoiLinkedIn', () => {
  it('rend maintenant quand un envoi est possible', async () => {
    const r = await prochainEnvoiLinkedIn(creerExecuteur(), ORG, NOW);
    expect(r).toEqual({ quand: NOW, motif: null, raison: 'envoi' });
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
    // `reprise` distingue ce cas d'un vrai creneau : sans lui, l'ecran annoncait « pret a envoyer »
    // un dimanche a 3 h, file vide, parce qu'il lisait une date de reparation comme une autorisation.
    const r = await prochainEnvoiLinkedIn(creerExecuteur({ enCoursPerimees: 1, enAttente: false }), ORG, NOW);
    expect(r).toEqual({ quand: NOW, motif: null, raison: 'reparation' });
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
    expect(r).toEqual({ quand: NOW, motif: null, raison: 'envoi' });
  });

  it('ne planifie rien hors de la fenetre horaire', async () => {
    const nuit = new Date('2026-09-15T20:00:00.000Z'); // 22 h Paris
    const r = await prochainEnvoiLinkedIn(creerExecuteur(), ORG, nuit);
    expect(r).toEqual({ quand: null, motif: 'outside_window' });
  });

  it('ne planifie rien au plafond hebdomadaire ni au plafond du jour', async () => {
    expect((await prochainEnvoiLinkedIn(creerExecuteur({ envoyesSur7Jours: { invite: 100, message: 0 } }), ORG, NOW)).motif).toBe('weekly_cap_reached');
    // 100 / 5 jours = 20 par jour.
    expect((await prochainEnvoiLinkedIn(creerExecuteur({ deLaJournee: { invite: 20, message: 0 } }), ORG, NOW)).motif).toBe('daily_cap_reached');
  });

  it('annonce le plafond de SON type : des invitations pleines ne bloquent pas un message en tête de file', async () => {
    const compteurs = { invite: 100, message: 0 };
    const message = await prochainEnvoiLinkedIn(creerExecuteur({ envoyesSur7Jours: compteurs, kind: 'message' }), ORG, NOW);
    expect(message).toEqual({ quand: NOW, motif: null, raison: 'envoi' });
    const invitation = await prochainEnvoiLinkedIn(creerExecuteur({ envoyesSur7Jours: compteurs, kind: 'invite' }), ORG, NOW);
    expect(invitation.motif).toBe('weekly_cap_reached');
  });

  describe('plafond horaire de requetes', () => {
    const il = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

    it('reste pret tant que le budget couvre un envoi', async () => {
      // 60 - 56 = 4 = REQUETES_PAR_ENVOI : juste assez.
      const requetesDeLHeure = Array.from({ length: 60 - REQUETES_PAR_ENVOI }, () => il(10));
      const r = await prochainEnvoiLinkedIn(creerExecuteur({ requetesDeLHeure }), ORG, NOW);
      expect(r).toEqual({ quand: NOW, motif: null, raison: 'envoi' });
    });

    it('refuse plafond_horaire_atteint quand le budget ne couvre plus un envoi, avec la date de liberation', async () => {
      // 57 requetes sur 60 : il en reste 3 < 4. Il faut qu une seule sorte de la fenetre ;
      // la plus ancienne date de 50 minutes, elle sort a +60 min.
      const requetesDeLHeure = [il(50), ...Array.from({ length: 56 }, () => il(10))];
      const r = await prochainEnvoiLinkedIn(creerExecuteur({ requetesDeLHeure }), ORG, NOW);
      expect(r).toEqual({
        quand: null,
        motif: 'plafond_horaire_atteint',
        disponibleA: new Date(il(50).getTime() + 3_600_000 + 1),
      });
    });

    it('la date attend autant de requetes que necessaire : la k-ieme plus ancienne', async () => {
      // 60 requetes sur 60 : reste 0, il faut en liberer 4. La 4e plus ancienne decide.
      const requetesDeLHeure = [il(55), il(50), il(45), il(40), ...Array.from({ length: 56 }, () => il(5))];
      const r = await prochainEnvoiLinkedIn(creerExecuteur({ requetesDeLHeure }), ORG, NOW);
      expect(r.disponibleA).toEqual(new Date(il(40).getTime() + 3_600_000 + 1));
    });

    it('ne devine aucune date quand le plafond est sous le cout d un envoi', async () => {
      const r = await prochainEnvoiLinkedIn(creerExecuteur({ plafondHoraire: REQUETES_PAR_ENVOI - 1 }), ORG, NOW);
      expect(r).toEqual({ quand: null, motif: 'plafond_horaire_atteint' });
    });

    it('ne compte pas ce qui date de plus d une heure', async () => {
      const requetesDeLHeure = Array.from({ length: 80 }, () => il(61));
      const r = await prochainEnvoiLinkedIn(creerExecuteur({ requetesDeLHeure }), ORG, NOW);
      expect(r.motif).toBeNull();
    });

    it('une file vide ou hors fenetre garde son motif : le budget ne masque rien', async () => {
      const plein = Array.from({ length: 60 }, () => il(5));
      expect((await prochainEnvoiLinkedIn(creerExecuteur({ requetesDeLHeure: plein, enAttente: false }), ORG, NOW)).motif).toBe('file_vide');
      const nuit = new Date('2026-09-15T20:00:00.000Z');
      expect((await prochainEnvoiLinkedIn(creerExecuteur({ requetesDeLHeure: plein }), ORG, nuit)).motif).toBe('outside_window');
    });

    it('apres un intervalle non ecoule, la date est la plus tardive des deux conditions', async () => {
      const dernier = new Date(NOW.getTime() - 30_000).toISOString();
      const plein = Array.from({ length: 60 }, () => il(5));
      const r = await prochainEnvoiLinkedIn(creerExecuteur({ dernierEnvoi: dernier, requetesDeLHeure: plein }), ORG, NOW);
      expect(r.motif).toBe('plafond_horaire_atteint');
      expect(r.disponibleA!.getTime()).toBe(il(5).getTime() + 3_600_000 + 1);
    });
  });

  // Le mode manuel est IMPOSSIBLE en base aujourd'hui (contrainte `mode = 'auto'`, migration
  // 20260831160000) : ce test exerce une branche de precaution, conservatrice, pas un cas reel.
  it('ne planifie rien en mode manuel (etat impossible en base aujourd hui, branche de precaution)', async () => {
    expect((await prochainEnvoiLinkedIn(creerExecuteur({ mode: 'manual' }), ORG, NOW)).motif).toBe('manual_mode');
  });
});
