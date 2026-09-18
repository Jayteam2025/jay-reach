import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { echeanceEtapeSuivante } from '@jay-reach/core';
import { claimNext, recordResult } from './queue.js';

const ORG_ID = 'org-1';
const QUEUE_ID = 'queue-1';
const ACTION_ID = 'action-1';
const ENROLLMENT_ID = 'enrollment-1';
const CAMPAIGN_ID = 'campagne-1';

interface Reponse {
  readonly rows: unknown[];
  readonly rowCount: number;
}

interface Appel {
  readonly sql: string;
  readonly values: unknown[];
}

interface Gestionnaire {
  readonly motif: RegExp;
  readonly repondre: (values: unknown[]) => Reponse;
}

function ligne(rows: unknown[] = []): Reponse {
  return { rows, rowCount: rows.length };
}

/** Pool factice : `query` est dispatché par motif de SQL, premier motif qui matche gagne. */
function creerPoolFactice(gestionnaires: Gestionnaire[]): { pool: Pool; appels: Appel[] } {
  const appels: Appel[] = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    appels.push({ sql, values });
    const trouve = gestionnaires.find((g) => g.motif.test(sql));
    if (!trouve) {
      throw new Error(`requete non prevue par le test :\n${sql}`);
    }
    return trouve.repondre(values);
  });
  return { pool: { query } as unknown as Pool, appels };
}

const TRANSITION = /update linkedin_action_queue/i;
const MARK_DISPATCHED = /mark_action_dispatched/i;
// `poserEcheanceApresDepart` (@jay-reach/core, issue #111). Lecture par RANG
// ORDINAL (`offset`/`limit`), jamais par égalité de `position` (issue #115).
const JOIN_ENROLLMENT = /from actions a\s+join enrollments en/i;
const DELAI_ETAPE_SUIVANTE =
  /select delay_hours from sequence_steps\s+where campaign_id = \$1\s+order by position asc\s+offset \$2\s+limit 1/i;
const POSE_ECHEANCE = /update enrollments\s+set next_action_at = \$2\s+where id = \$1/i;

function gestionnairesSucces(overrides: Gestionnaire[] = []): Gestionnaire[] {
  return [
    ...overrides,
    { motif: TRANSITION, repondre: () => ligne([{ action_id: ACTION_ID }]) },
    { motif: MARK_DISPATCHED, repondre: () => ligne([{}]) },
    {
      motif: JOIN_ENROLLMENT,
      repondre: () => ligne([{ enrollment_id: ENROLLMENT_ID, campaign_id: CAMPAIGN_ID, current_step: 2 }]),
    },
    { motif: DELAI_ETAPE_SUIVANTE, repondre: () => ligne([{ delay_hours: 48 }]) },
    { motif: POSE_ECHEANCE, repondre: () => ({ rows: [], rowCount: 1 }) },
  ];
}

describe('recordResult — échéance de l’étape suivante au départ réel (issue #111)', () => {
  it('statut `sent` avec étape suivante : mark_action_dispatched puis échéance posée avec le même jitter que le core', async () => {
    const maintenant = new Date('2026-09-17T10:04:00.000Z');
    const { pool, appels } = creerPoolFactice(gestionnairesSucces());

    const ok = await recordResult(pool, { organizationId: ORG_ID, queueId: QUEUE_ID, status: 'sent', now: maintenant });

    expect(ok).toBe(true);
    expect(appels.some((a) => MARK_DISPATCHED.test(a.sql))).toBe(true);

    const requeteJointure = appels.find((a) => JOIN_ENROLLMENT.test(a.sql));
    expect(requeteJointure).toBeDefined();
    expect(requeteJointure!.values).toEqual([ACTION_ID]);

    const requeteDelai = appels.find((a) => DELAI_ETAPE_SUIVANTE.test(a.sql));
    expect(requeteDelai).toBeDefined();
    expect(requeteDelai!.values).toEqual([CAMPAIGN_ID, 2]);

    const pose = appels.find((a) => POSE_ECHEANCE.test(a.sql));
    expect(pose).toBeDefined();
    const attendu = echeanceEtapeSuivante(maintenant.getTime(), ENROLLMENT_ID, 48);
    expect(pose!.values).toEqual([ENROLLMENT_ID, new Date(attendu!).toISOString(), 2]);
    // Garde : jamais posée sur une inscription déjà repartie ailleurs.
    expect(pose!.sql).toMatch(/status = 'active'/i);
    expect(pose!.sql).toMatch(/next_action_at is null/i);
    expect(pose!.sql).toMatch(/current_step = \$3/i);
  });

  it('dernière étape (aucune ligne trouvée) : mark_action_dispatched a lieu, aucune échéance posée', async () => {
    const { pool, appels } = creerPoolFactice(
      gestionnairesSucces([{ motif: DELAI_ETAPE_SUIVANTE, repondre: () => ligne([]) }]),
    );

    const ok = await recordResult(pool, { organizationId: ORG_ID, queueId: QUEUE_ID, status: 'sent' });

    expect(ok).toBe(true);
    expect(appels.some((a) => MARK_DISPATCHED.test(a.sql))).toBe(true);
    expect(appels.some((a) => POSE_ECHEANCE.test(a.sql))).toBe(false);
  });

  it('statut `failed` : ni mark_action_dispatched ni échéance, seule la transition a lieu', async () => {
    const { pool, appels } = creerPoolFactice([{ motif: TRANSITION, repondre: () => ligne([{ action_id: ACTION_ID }]) }]);

    const ok = await recordResult(pool, { organizationId: ORG_ID, queueId: QUEUE_ID, status: 'failed' });

    expect(ok).toBe(true);
    expect(appels).toHaveLength(1);
    expect(appels.some((a) => MARK_DISPATCHED.test(a.sql))).toBe(false);
  });

  it('transition refusée (ligne absente ou déjà traitée) : aucun appel supplémentaire, renvoie false', async () => {
    const { pool, appels } = creerPoolFactice([{ motif: TRANSITION, repondre: () => ligne([]) }]);

    const ok = await recordResult(pool, { organizationId: ORG_ID, queueId: QUEUE_ID, status: 'sent' });

    expect(ok).toBe(false);
    expect(appels).toHaveLength(1);
  });

  it('action_id absent sur la ligne de file : aucun appel de clôture (mark_action_dispatched, échéance)', async () => {
    const { pool, appels } = creerPoolFactice([{ motif: TRANSITION, repondre: () => ligne([{ action_id: null }]) }]);

    const ok = await recordResult(pool, { organizationId: ORG_ID, queueId: QUEUE_ID, status: 'sent' });

    expect(ok).toBe(true);
    expect(appels).toHaveLength(1);
  });
});

describe('claimNext — campagne non active (F14)', () => {
  const QUEUE_ROW_ID = 'file-1';

  interface LigneFile {
    readonly id: string;
    readonly kind: 'invite' | 'message';
    readonly linkedinUrl: string;
    readonly messageBody: string | null;
    /** `null` = ligne sans action de séquenceur (`action_id` nul), jamais concernée par ce garde-fou. */
    readonly campagneStatut: string | null;
  }

  // Mardi 15/09/2026 10:00 UTC (12:00 Paris, en semaine, dans la fenêtre
  // ouvrée par défaut 8h-21h) : même date déterministe que les tests du tick
  // (`sequence.test.ts`).
  const NOW = new Date('2026-09-15T10:00:00.000Z');

  const REQUEUE = /set status = 'pending', processing_started_at = null/i;
  const SETTINGS = /from linkedin_settings/i;
  const COUNTS = /count\(\*\) filter \(where sent_at >= \$2\) as last7/i;
  const DERNIER_ENVOI = /select sent_at from linkedin_action_queue/i;
  const CANDIDAT = /method = 'extension_auto'/i;
  const CLAIM = /set status = 'processing'/i;

  /**
   * Pool factice AVEC ÉTAT, dédié à ce défaut : contrairement à un pool qui
   * répondrait au TEXTE d'une requête sans jamais évaluer son `where` (donc
   * renverrait la même candidate qu'on modélise une campagne en pause ou
   * active), celui-ci décide RÉELLEMENT selon le SQL produit — la candidate
   * n'est écartée que si la requête filtre elle-même sur `camp.status =
   * 'active'` (correctif annulé : comportement d'avant, la ligne repart
   * inconditionnellement) ET que sa campagne modélisée n'est pas `active`.
   * Pacing neutre (aucun réglage en base → défauts `loadPaceStats`, jamais
   * envoyé) pour que seul le garde-fou de campagne décide du résultat.
   */
  function creerPoolFile(candidats: LigneFile[]): { pool: Pool; appels: Appel[] } {
    const appels: Appel[] = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      appels.push({ sql, values });
      if (REQUEUE.test(sql)) return { rows: [], rowCount: 0 };
      if (SETTINGS.test(sql)) return ligne([]);
      if (COUNTS.test(sql)) return ligne([{ last7: '0', today: '0' }]);
      if (DERNIER_ENVOI.test(sql)) return ligne([]);
      if (CANDIDAT.test(sql)) {
        const filtreCampagneActive = /camp\.status\s*=\s*'active'/i.test(sql);
        const eligibles = candidats.filter(
          (c) => !filtreCampagneActive || c.campagneStatut === null || c.campagneStatut === 'active',
        );
        return ligne(eligibles.length > 0 ? [{ id: eligibles[0]!.id }] : []);
      }
      if (CLAIM.test(sql)) {
        const id = values[0] as string;
        const c = candidats.find((x) => x.id === id);
        if (!c) return { rows: [], rowCount: 0 };
        return ligne([{ id: c.id, kind: c.kind, linkedinUrl: c.linkedinUrl, messageBody: c.messageBody }]);
      }
      throw new Error(`requete non prevue par le test :\n${sql}`);
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    return { pool, appels };
  }

  it('campagne mise en pause (ou archivée) : la ligne déjà en file n’est pas réclamée', async () => {
    const { pool, appels } = creerPoolFile([
      { id: QUEUE_ROW_ID, kind: 'invite', linkedinUrl: 'https://linkedin.com/in/x', messageBody: null, campagneStatut: 'paused' },
    ]);

    const resultat = await claimNext(pool, ORG_ID, NOW);

    expect(resultat).toEqual({ action: null, reason: 'queue_empty' });
    expect(appels.some((a) => CLAIM.test(a.sql))).toBe(false);
  });

  it('campagne active (non-régression) : la ligne est réclamée normalement', async () => {
    const { pool } = creerPoolFile([
      { id: QUEUE_ROW_ID, kind: 'invite', linkedinUrl: 'https://linkedin.com/in/x', messageBody: null, campagneStatut: 'active' },
    ]);

    const resultat = await claimNext(pool, ORG_ID, NOW);

    expect(resultat).toEqual({
      action: { id: QUEUE_ROW_ID, kind: 'invite', linkedinUrl: 'https://linkedin.com/in/x', messageBody: null },
      reason: null,
    });
  });

  it('ligne sans action de séquenceur (action_id nul) : jamais bloquée par ce garde-fou', async () => {
    const { pool } = creerPoolFile([
      { id: QUEUE_ROW_ID, kind: 'message', linkedinUrl: 'https://linkedin.com/in/y', messageBody: 'Bonjour', campagneStatut: null },
    ]);

    const resultat = await claimNext(pool, ORG_ID, NOW);

    expect(resultat.action?.id).toBe(QUEUE_ROW_ID);
  });
});
