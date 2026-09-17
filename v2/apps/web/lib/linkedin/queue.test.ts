import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { echeanceEtapeSuivante } from '@jay-reach/core';
import { recordResult } from './queue.js';

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
// `poserEcheanceApresDepart` (issue #111).
const JOIN_ENROLLMENT = /from actions a\s+join enrollments en/i;
const DELAI_ETAPE_SUIVANTE = /select delay_hours from sequence_steps where campaign_id = \$1 and position = \$2/i;
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
    { motif: POSE_ECHEANCE, repondre: () => ligne([]) },
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
