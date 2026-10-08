import { describe, it, expect } from 'vitest';
import type { Executeur } from '../executeur.js';
import type { Contexte } from '../fonctions/contexte.js';
import { listerComptesLinkedIn } from '../fonctions/expediteurs.js';
import { HEURES_ENVOI_LINKEDIN_PAR_DEFAUT } from './reglages-envoi.js';
import {
  reclamerProchaineAction,
  mettreEnPauseEnvoiLinkedIn,
  enregistrerResultat,
  lireVolumeEnvoiLinkedIn,
  type TypeActionLinkedIn,
} from './file.js';

const ORG = 'org-1';
// Mardi 15/09/2026 10:00 UTC = 12:00 Paris, en semaine.
const NOW = new Date('2026-09-15T10:00:00.000Z');

interface Etat {
  reglages: { send_from_hour: number; send_to_hour: number } | null;
  /** Plafonds hebdomadaires de `organization_settings`, un par type (clé `plafondDuJour`). */
  plafondHebdo: Record<TypeActionLinkedIn, number>;
  /** Envoyés sur 7 jours et sur 24 h, PAR TYPE : le SQL groupe sur `kind`. */
  envoyesSur7Jours: Record<TypeActionLinkedIn, number>;
  envoyesDuJour: Record<TypeActionLinkedIn, number>;
  /** Type de l'action en tête de file. */
  kindDeLaLigne: TypeActionLinkedIn;
  campagneStatut: string | null;
  coinceDepuis: string | null;
  pauseJusqua: string | null;
  session: boolean;
  statutSession: string;
  /** Methode de la ligne en file : le faux ne la renvoie que si le SQL la demande. */
  methodeDeLaLigne: string;
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
    reglages: { send_from_hour: 9, send_to_hour: 18 },
    plafondHebdo: { invite: 100, message: 200 },
    envoyesSur7Jours: { invite: 0, message: 0 },
    envoyesDuJour: { invite: 0, message: 0 },
    kindDeLaLigne: 'invite',
    campagneStatut: null,
    coinceDepuis: null,
    pauseJusqua: null,
    session: true,
    statutSession: 'active',
    methodeDeLaLigne: 'serveur',
    ...depart,
  };
  let enProcessing = etat.coinceDepuis !== null;
  let terminee = false;
  const appels: Appel[] = [];
  const rep = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const ex: Executeur = {
    async query(sql: string, values: unknown[] = []) {
      appels.push({ sql, values });
      if (/from linkedin_server_sessions/i.test(sql)) return rep(etat.session ? [{ status: etat.statutSession, envoi_pause_jusqua: etat.pauseJusqua }] : []) as never;
      if (/update linkedin_server_sessions/i.test(sql)) {
        if (!etat.session) return { rows: [], rowCount: 0 } as never;
        const demandee = values[1] as string;
        // Le SQL est jugé sur son texte : sans `greatest`, l'écrasement est sec.
        etat.pauseJusqua =
          /greatest/i.test(sql) && etat.pauseJusqua !== null && etat.pauseJusqua > demandee ? etat.pauseJusqua : demandee;
        return { rows: [], rowCount: 1 } as never;
      }
      if (/set status = 'pending', processing_started_at = null/i.test(sql)) {
        const cutoff = values[1] as string;
        // La remise en attente ne vise QUE les lignes non serveur (`method <> 'serveur'`) :
        // la ligne du faux, elle, est serveur sauf indication contraire.
        const viseLeServeur = !/method\s*<>\s*'serveur'/i.test(sql);
        if (enProcessing && etat.coinceDepuis !== null && etat.coinceDepuis < cutoff && (viseLeServeur || etat.methodeDeLaLigne !== 'serveur')) {
          enProcessing = false;
        }
        return { rows: [], rowCount: 0 } as never;
      }
      if (/set status = 'failed', error_code = 'resultat_indetermine'/i.test(sql)) {
        const cutoff = values[1] as string;
        const vise = /method\s*=\s*'serveur'/i.test(sql) && etat.methodeDeLaLigne === 'serveur';
        if (vise && enProcessing && etat.coinceDepuis !== null && etat.coinceDepuis < cutoff) {
          enProcessing = false;
          terminee = true;
        }
        return { rows: [], rowCount: 0 } as never;
      }
      if (/from linkedin_settings/i.test(sql)) {
        return rep(
          etat.reglages ? [{ mode: 'auto', send_days: [1, 2, 3, 4, 5], timezone: 'Europe/Paris', ...etat.reglages }] : [],
        ) as never;
      }
      if (/from organization_settings/i.test(sql)) {
        const cle = values[1];
        const plafond = cle === 'linkedin_invitations_par_semaine' ? etat.plafondHebdo.invite : etat.plafondHebdo.message;
        return rep([{ value: plafond }]) as never;
      }
      if (/count\(\*\) filter/i.test(sql)) {
        // Le SQL doit GROUPER par type : sans `group by kind`, le faux ne sait pas rendre un compte par type.
        if (!/group by kind/i.test(sql)) return rep([{ last7: String(etat.envoyesSur7Jours.invite + etat.envoyesSur7Jours.message), today: '0' }]) as never;
        return rep(
          (['invite', 'message'] as const).map((kind) => ({
            kind,
            last7: String(etat.envoyesSur7Jours[kind]),
            today: String(etat.envoyesDuJour[kind]),
          })),
        ) as never;
      }
      if (/select sent_at from linkedin_action_queue/i.test(sql)) return rep([]) as never;
      if (/jr:linkedin_candidates_par_type/i.test(sql)) {
        const demandee = /q\.method = '([a-z_]+)'/.exec(sql)?.[1] ?? null;
        if (demandee !== etat.methodeDeLaLigne) return rep([]) as never;
        if (enProcessing || terminee) return rep([]) as never;
        const filtre = /camp\.status\s*=\s*'active'/i.test(sql);
        const ok = !filtre || etat.campagneStatut === null || etat.campagneStatut === 'active';
        return rep(ok ? [{ id: 'file-1', kind: etat.kindDeLaLigne }] : []) as never;
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
    const { ex } = creerExecuteur({ envoyesSur7Jours: { invite: 100, message: 0 } });
    const r = await reclamerProchaineAction(ex, ORG, NOW);
    expect(r.action).toBeNull();
    expect(r.motif).toBe('weekly_cap_reached');
  });

  it('un plafond abaisse s applique des la reclamation suivante', async () => {
    const { ex, etat } = creerExecuteur({ envoyesSur7Jours: { invite: 50, message: 0 } });
    const avant = await reclamerProchaineAction(ex, ORG, NOW);
    expect(avant.action?.id).toBe('file-1');
    etat.plafondHebdo = { invite: 50, message: 200 };
    const apres = await reclamerProchaineAction(ex, ORG, NOW);
    expect(apres.action).toBeNull();
    expect(apres.motif).toBe('weekly_cap_reached');
  });

  it('les invitations et les messages ont chaque un plafond : 100 invitations n arretent pas un message', async () => {
    const compteurs = { invite: 100, message: 0 };
    const invitation = creerExecuteur({ envoyesSur7Jours: compteurs, kindDeLaLigne: 'invite' });
    expect((await reclamerProchaineAction(invitation.ex, ORG, NOW)).motif).toBe('weekly_cap_reached');
    const message = creerExecuteur({ envoyesSur7Jours: compteurs, kindDeLaLigne: 'message' });
    expect((await reclamerProchaineAction(message.ex, ORG, NOW)).action?.id).toBe('file-1');
  });

  it('un message est jugé au plafond des messages, pas à celui des invitations', async () => {
    // 150 messages : sous le plafond des messages (200), au-dessus de celui des invitations (100).
    // 60 invitations en plus : la SOMME (210) dépasse 200, chaque compteur séparément non.
    const { ex } = creerExecuteur({ envoyesSur7Jours: { invite: 60, message: 150 }, kindDeLaLigne: 'message' });
    expect((await reclamerProchaineAction(ex, ORG, NOW)).action?.id).toBe('file-1');
    const plein = creerExecuteur({ envoyesSur7Jours: { invite: 0, message: 200 }, kindDeLaLigne: 'message' });
    expect((await reclamerProchaineAction(plein.ex, ORG, NOW)).motif).toBe('weekly_cap_reached');
  });

  it('une invitation est jugée sur les invitations seules : les messages ne la consomment pas', async () => {
    // 60 invitations + 80 messages = 140 au compteur commun, au-dessus du plafond de 100.
    const { ex } = creerExecuteur({ envoyesSur7Jours: { invite: 60, message: 80 }, kindDeLaLigne: 'invite' });
    expect((await reclamerProchaineAction(ex, ORG, NOW)).action?.id).toBe('file-1');
  });

  it('le plafond du jour de chaque type se déduit du sien, non de celui de l autre', async () => {
    // Invitations : 100 / 5 jours = 20 par jour. Messages : 200 / 5 = 40 par jour.
    const invitation = creerExecuteur({ envoyesDuJour: { invite: 20, message: 0 }, kindDeLaLigne: 'invite' });
    expect((await reclamerProchaineAction(invitation.ex, ORG, NOW)).motif).toBe('daily_cap_reached');
    const message = creerExecuteur({ envoyesDuJour: { invite: 0, message: 39 }, kindDeLaLigne: 'message' });
    expect((await reclamerProchaineAction(message.ex, ORG, NOW)).action?.id).toBe('file-1');
    const messagePlein = creerExecuteur({ envoyesDuJour: { invite: 0, message: 40 }, kindDeLaLigne: 'message' });
    expect((await reclamerProchaineAction(messagePlein.ex, ORG, NOW)).motif).toBe('daily_cap_reached');
  });

  it('weekly_cap et daily_cap de linkedin_settings ne sont plus lus par le rythme', async () => {
    const { ex, appels } = creerExecuteur();
    await reclamerProchaineAction(ex, ORG, NOW);
    const lectures = appels.filter((a) => /from linkedin_settings/i.test(a.sql));
    expect(lectures.length).toBeGreaterThan(0);
    for (const l of lectures) expect(l.sql).not.toMatch(/weekly_cap|daily_cap/);
  });

  it('la requete de reclamation filtre sur le statut actif de la campagne', async () => {
    // Ne prouve que la forme du SQL (le faux executeur ne l'execute pas) : la preuve
    // du comportement est la section 3 du harnais pg-verify linkedin-file, sur une vraie base.
    const { ex, appels } = creerExecuteur({ campagneStatut: 'paused' });
    const r = await reclamerProchaineAction(ex, ORG, NOW);
    expect(r).toEqual({ action: null, motif: 'queue_empty' });
    expect(appels.some((a) => /set status = 'processing'/i.test(a.sql))).toBe(false);
  });

  it('une ligne serveur coincee depuis plus de dix minutes n est JAMAIS reclamee : elle a pu partir', async () => {
    const { ex } = creerExecuteur({ coinceDepuis: new Date(NOW.getTime() - 11 * 60_000).toISOString() });
    const r = await reclamerProchaineAction(ex, ORG, NOW);
    expect(r).toEqual({ action: null, motif: 'queue_empty' });
    // Preuve du SQL réel : harnais pg-verify (section 6 de linkedin-file.mjs).

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

  it('la requete de mise en pause compare l echeance avec greatest', async () => {
    // Ne prouve que la forme du SQL (le faux executeur ne l'execute pas) : la preuve
    // du comportement est la section 8 du harnais pg-verify linkedin-file, sur une vraie base.
    const { ex, etat } = creerExecuteur();
    const longue = new Date(NOW.getTime() + 22 * 60 * 60_000);
    const courte = new Date(NOW.getTime() + 60 * 60_000);
    await mettreEnPauseEnvoiLinkedIn(ex, ORG, longue);
    await mettreEnPauseEnvoiLinkedIn(ex, ORG, courte);
    expect(etat.pauseJusqua).toBe(longue.toISOString());
  });

  it('sans ligne de session, la mise en pause rend false', async () => {
    const { ex } = creerExecuteur({ session: false });
    expect(await mettreEnPauseEnvoiLinkedIn(ex, ORG, new Date(NOW.getTime() + 60_000))).toBe(false);
    const avec = creerExecuteur();
    expect(await mettreEnPauseEnvoiLinkedIn(avec.ex, ORG, new Date(NOW.getTime() + 60_000))).toBe(true);
  });

  it('une session bloquee refuse la reclamation', async () => {
    const bloquee = creerExecuteur({ statutSession: 'bloquee' });
    const r = await reclamerProchaineAction(bloquee.ex, ORG, NOW);
    expect(r).toEqual({ action: null, motif: 'session_inactive' });
    expect(bloquee.appels.some((a) => /set status = 'processing'/i.test(a.sql))).toBe(false);

    const absente = creerExecuteur({ session: false });
    expect((await reclamerProchaineAction(absente.ex, ORG, NOW)).motif).toBe('session_inactive');
  });

  it('la requete de reclamation filtre sur method = serveur', async () => {
    // Ne prouve que la forme du SQL (le faux executeur ne l'execute pas) : la preuve
    // du comportement est les sections 1 et 2 du harnais pg-verify linkedin-file, sur une vraie base.
    const { ex } = creerExecuteur({ methodeDeLaLigne: 'extension_auto' });
    expect(await reclamerProchaineAction(ex, ORG, NOW)).toEqual({ action: null, motif: 'queue_empty' });
    const serveur = creerExecuteur();
    expect((await reclamerProchaineAction(serveur.ex, ORG, NOW)).action?.id).toBe('file-1');
  });
});

describe('fenetre d envoi par defaut', () => {
  /** Le moteur sur une instance neuve (aucune ligne `linkedin_settings`) : les heures PARIS qu'il accepte, un mardi. */
  async function heuresAcceptees(): Promise<number[]> {
    const acceptees: number[] = [];
    for (let h = 0; h < 24; h++) {
      // Septembre : Paris = UTC + 2.
      const instant = new Date(Date.UTC(2026, 8, 15, h - 2, 0, 0));
      const { ex } = creerExecuteur({ reglages: null });
      if ((await reclamerProchaineAction(ex, ORG, instant)).action !== null) acceptees.push(h);
    }
    return acceptees;
  }

  it('le moteur applique la fenetre que l ecran annonce, sur une instance neuve', async () => {
    const acceptees = await heuresAcceptees();
    const debut = acceptees[0];
    const fin = (acceptees[acceptees.length - 1] ?? -1) + 1;

    const ex: Executeur = {
      async query(sql: string) {
        if (/jr:expediteurs_comptes_linkedin/.test(sql)) {
          return { rows: [{ user_id: 'u-1', linkedin_profile_name: 'Camille', last_used_at: null, is_active: true }], rowCount: 1 } as never;
        }
        return { rows: [], rowCount: 0 } as never;
      },
    };
    const ctx: Contexte = { ex, organisationId: ORG, utilisateurId: 'u-1', role: 'admin' };
    const [compte] = await listerComptesLinkedIn(ctx);
    const hhmm = (h: number) => `${String(h).padStart(2, '0')}:00`;

    expect(compte?.heures.debut).toBe(hhmm(debut ?? -1));
    expect(compte?.heures.fin).toBe(hhmm(fin));
    // Et c'est la constante unique, pas deux valeurs qui se trouvent égales aujourd'hui.
    expect(debut).toBe(HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.debutHeure);
    expect(fin).toBe(HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.finHeure);
  });
});

describe('lireVolumeEnvoiLinkedIn', () => {
  /**
   * Ce que l'écran de réglages affiche à côté de chaque plafond. Elle passe par la MÊME
   * fonction que le moteur consulte avant d'envoyer : un second comptage finirait par
   * diverger, et l'écran annoncerait un chiffre que le moteur ne connaît pas.
   */
  it('rend le plafond appliqué et la consommation, séparément par type', async () => {
    const { ex } = creerExecuteur({
      plafondHebdo: { invite: 40, message: 150 },
      envoyesSur7Jours: { invite: 7, message: 3 },
    });

    const volume = await lireVolumeEnvoiLinkedIn(ex, ORG, NOW);

    expect(volume.invite.plafondHebdo).toBe(40);
    expect(volume.invite.envoyes7Jours).toBe(7);
    expect(volume.message.plafondHebdo).toBe(150);
    expect(volume.message.envoyes7Jours).toBe(3);
  });

  it('ne mélange pas les deux types : le compteur d un type ne déborde pas sur l autre', async () => {
    const { ex } = creerExecuteur({
      plafondHebdo: { invite: 40, message: 150 },
      envoyesSur7Jours: { invite: 40, message: 0 },
    });

    const volume = await lireVolumeEnvoiLinkedIn(ex, ORG, NOW);

    // Les invitations sont au plafond, les messages n'en ont pas consommé un seul.
    expect(volume.invite.envoyes7Jours).toBe(volume.invite.plafondHebdo);
    expect(volume.message.envoyes7Jours).toBe(0);
  });
});

describe('enregistrerResultat', () => {
  it('une ecriture qui leve apres la transition annule tout : rollback, jamais de commit', async () => {
    const journal: string[] = [];
    const client = {
      release: () => undefined,
      async query(sql: string) {
        journal.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
        if (/mark_action_dispatched/.test(sql)) throw new Error('interblocage');
        if (/update linkedin_action_queue/.test(sql)) return { rows: [{ action_id: 'a-1' }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    };
    const ex = { query: client.query, connect: async () => client } as unknown as Executeur;
    await expect(
      enregistrerResultat(ex, { organizationId: ORG, queueId: 'q-1', status: 'sent', now: NOW }),
    ).rejects.toThrow('interblocage');
    expect(journal).toContain('rollback');
    expect(journal).not.toContain('commit');
    // La preuve que la ligne n'est pas `sent` est dans pg-verify (section 17) : un faux ne l'établit pas.
  });
});
