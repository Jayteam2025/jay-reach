import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { rejouerActionsEmailEnAttente, REJEU_ACTIONS_EMAIL_MS, type Contexte } from './traitements.js';
import { deterministicUuid, currentBucket } from './ids.js';

const ACTION_ID = 'action-en-attente-1';
const ORG_ID = 'org-1';

function ligneActionEnAttente(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action_id: ACTION_ID,
    organization_id: ORG_ID,
    enrollment_id: 'enrollment-1',
    step_id: 'etape-1',
    sender_id: 'sender-1',
    contact_id: 'contact-1',
    campaign_id: 'campagne-1',
    template_parent_id: 'gabarit-famille-1',
    locale: null,
    ...overrides,
  };
}

/** Pool factice : renvoie toujours les mêmes lignes, quelle que soit la requête. */
function creerPoolFactice(rows: unknown[]): Pool {
  return { query: vi.fn(async () => ({ rows, rowCount: rows.length })) } as unknown as Pool;
}

function creerContexteFactice(rows: unknown[]): { ctx: Contexte; insert: ReturnType<typeof vi.fn> } {
  const insert = vi.fn(async () => undefined);
  const boss = { insert } as unknown as PgBoss;
  const pool = creerPoolFactice(rows);
  return { ctx: { pool, boss }, insert };
}

describe('rejouerActionsEmailEnAttente', () => {
  it('une action en attente produit exactement un job actions.dispatch', async () => {
    const { ctx, insert } = creerContexteFactice([ligneActionEnAttente()]);

    const rejouees = await rejouerActionsEmailEnAttente(ctx);

    expect(rejouees).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
    const lot = insert.mock.calls[0]![0] as { name: string; id: string; data: unknown }[];
    expect(lot).toHaveLength(1);
    const bucket = currentBucket(REJEU_ACTIONS_EMAIL_MS);
    expect(lot[0]!.name).toBe('actions.dispatch');
    expect(lot[0]!.id).toBe(deterministicUuid('dispatch-rejeu', ACTION_ID, bucket));
    expect(lot[0]!.data).toEqual({
      organizationId: ORG_ID,
      channel: 'email',
      actionId: ACTION_ID,
      email: {
        enrollmentId: 'enrollment-1',
        contactId: 'contact-1',
        stepId: 'etape-1',
        campaignId: 'campagne-1',
        templateParentId: 'gabarit-famille-1',
        senderId: 'sender-1',
        locale: null,
      },
    });
  });

  it('aucune action retournée par la requête (trop récente) ne produit aucun job', async () => {
    const { ctx, insert } = creerContexteFactice([]);

    const rejouees = await rejouerActionsEmailEnAttente(ctx);

    expect(rejouees).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it('la requête filtre sur l’inscription active/completed et l’absence de suppression email (C1)', async () => {
    // Le pool factice de ce fichier renvoie toujours les mêmes lignes, quelle
    // que soit la requête : il ne peut donc pas rejouer le filtrage réel de
    // Postgres. On vérifie ici que le garde-fou est bien dans la requête —
    // et le test juste au-dessus (« aucune action retournée… ») couvre déjà
    // le cas où ce filtre exclut la ligne : la fonction ne produit alors
    // aucun job, exactement le scénario d'une inscription `replied`.
    const { ctx } = creerContexteFactice([ligneActionEnAttente()]);

    await rejouerActionsEmailEnAttente(ctx);

    const sql = (ctx.pool.query as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(sql).toContain(`e.status in ('active', 'completed')`);
    expect(sql).toMatch(/not exists[\s\S]*from suppressions/i);
    expect(sql).toMatch(/scope = 'email'/);
    expect(sql).toMatch(/sup\.value = c\.email/);
  });

  it('le balayage réenfile une action d’une inscription completed (hotfix dernier email, 11/09)', async () => {
    // Même limite du pool factice que le test C1 ci-dessus : il ne filtre pas
    // réellement par statut, donc ce test documente et vérifie que la requête
    // autorise `completed` dans son filtre — sans quoi le dernier email d'une
    // séquence, dont l'inscription passe à `completed` avant l'envoi (voir
    // `sequence.ts`), ne serait jamais repris par ce balayage.
    const { ctx, insert } = creerContexteFactice([ligneActionEnAttente()]);

    const rejouees = await rejouerActionsEmailEnAttente(ctx);

    expect(rejouees).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
    const sql = (ctx.pool.query as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(sql).toContain(`e.status in ('active', 'completed')`);
  });

  it('deux passages dans le même seau produisent le même id de job', async () => {
    const { ctx: ctx1, insert: insert1 } = creerContexteFactice([ligneActionEnAttente()]);
    const { ctx: ctx2, insert: insert2 } = creerContexteFactice([ligneActionEnAttente()]);

    await rejouerActionsEmailEnAttente(ctx1);
    await rejouerActionsEmailEnAttente(ctx2);

    const id1 = (insert1.mock.calls[0]![0] as { id: string }[])[0]!.id;
    const id2 = (insert2.mock.calls[0]![0] as { id: string }[])[0]!.id;
    expect(id1).toBe(id2);
  });
});
