import { describe, expect, it, vi } from 'vitest';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import {
  activerSessionLinkedIn,
  bloquerSessionLinkedIn,
  confirmerIpAttendue,
  enregistrerObservationSortie,
  prendreVerrouLinkedIn,
} from './linkedin-session.js';

interface Appel {
  sql: string;
  params: unknown[];
}

/** Contexte factice : consigne chaque requête, rend `rowCount` pour celles qui touchent `linkedin_server_sessions`. */
function faux(rowCount = 1): { ctx: Contexte; appels: Appel[] } {
  const appels: Appel[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    appels.push({ sql, params });
    const touche = /linkedin_server_sessions/i.test(sql);
    return { rows: touche && rowCount > 0 ? [{}] : [], rowCount: touche ? rowCount : 0 };
  }) as unknown as Executeur['query'];
  return { ctx: { ex: { query }, organisationId: 'org-1', utilisateurId: null, role: null }, appels };
}

describe('bloquerSessionLinkedIn', () => {
  it('pose le motif et la date', async () => {
    const { ctx, appels } = faux();
    await bloquerSessionLinkedIn(ctx, 'defi');
    const ecriture = appels.find((a) => /linkedin_server_sessions/i.test(a.sql));
    expect(ecriture).toBeDefined();
    expect(ecriture!.sql).toMatch(/status\s*=\s*'bloquee'/);
    expect(ecriture!.sql).toMatch(/blocked_at\s*=\s*now\(\)/);
    expect(ecriture!.sql).toMatch(/blocked_reason/);
    expect(ecriture!.params).toContain('defi');
    expect(ecriture!.params).toContain('org-1');
  });

  it('emet une notification linkedin.session_blocked', async () => {
    const { ctx, appels } = faux();
    await bloquerSessionLinkedIn(ctx, 'cookie_refuse');
    const notif = appels.find((a) => /into notifications/i.test(a.sql));
    expect(notif).toBeDefined();
    expect(notif!.params).toContain('linkedin.session_blocked');
    expect(notif!.params[0]).toBe('org-1');
  });

  it('ne renotifie pas une session déjà bloquée', async () => {
    const { ctx, appels } = faux(0);
    await bloquerSessionLinkedIn(ctx, 'defi');
    expect(appels.some((a) => /into notifications/i.test(a.sql))).toBe(false);
  });
});

describe('activerSessionLinkedIn', () => {
  it('efface le motif', async () => {
    const { ctx, appels } = faux();
    await activerSessionLinkedIn(ctx, '203.0.113.7');
    const ecriture = appels.find((a) => /linkedin_server_sessions/i.test(a.sql))!;
    expect(ecriture.sql).toMatch(/status\s*=\s*'active'/);
    expect(ecriture.sql).toMatch(/blocked_reason\s*=\s*null/i);
    expect(ecriture.sql).toMatch(/blocked_at\s*=\s*null/i);
    expect(ecriture.params).toContain('203.0.113.7');
  });
});

describe('prendreVerrouLinkedIn', () => {
  it('rend false quand un verrou valide existe', async () => {
    const { ctx, appels } = faux(0);
    expect(await prendreVerrouLinkedIn(ctx, 'worker-a', 60_000)).toBe(false);
    expect(appels[0]!.sql).toMatch(/lock_until is null or lock_until < now\(\) or lock_owner = \$2/i);
  });

  it('rend true quand le verrou a expiré', async () => {
    const { ctx } = faux(1);
    expect(await prendreVerrouLinkedIn(ctx, 'worker-a', 60_000)).toBe(true);
  });
});

describe('enregistrerObservationSortie', () => {
  it("ecrit l'IP, l'operateur et le pays vus, sans toucher a l'IP attendue ni a l'etat", async () => {
    const { ctx, appels } = faux();
    await enregistrerObservationSortie(ctx, { ip: '203.0.113.7', operateur: 'AS64500 Exemple', pays: 'FR' });
    const ecriture = appels.find((a) => /linkedin_server_sessions/i.test(a.sql));
    expect(ecriture).toBeDefined();
    expect(ecriture!.params).toEqual(['org-1', '203.0.113.7', 'AS64500 Exemple', 'FR']);
    expect(ecriture!.sql).toMatch(/last_egress_ip\s*=\s*\$2/);
    expect(ecriture!.sql).toMatch(/last_egress_org\s*=\s*\$3/);
    expect(ecriture!.sql).toMatch(/last_egress_country\s*=\s*\$4/);
    expect(ecriture!.sql).not.toMatch(/expected_egress_ip\s*=/);
    expect(ecriture!.sql).not.toMatch(/status\s*=/);
  });

  it("ecrit null pour l'operateur et le pays quand ils manquent", async () => {
    const { ctx, appels } = faux();
    await enregistrerObservationSortie(ctx, { ip: '203.0.113.7' });
    expect(appels.find((a) => /linkedin_server_sessions/i.test(a.sql))!.params).toEqual([
      'org-1',
      '203.0.113.7',
      null,
      null,
    ]);
  });
});

describe('confirmerIpAttendue', () => {
  it("remplace l'IP attendue et ne leve que le blocage sortie_inattendue", async () => {
    const { ctx, appels } = faux();
    await confirmerIpAttendue(ctx, '198.51.100.9');
    const ecriture = appels.find((a) => /linkedin_server_sessions/i.test(a.sql));
    expect(ecriture!.params).toEqual(['org-1', '198.51.100.9']);
    expect(ecriture!.sql).toMatch(/expected_egress_ip\s*=\s*\$2/);
    expect(ecriture!.sql).toMatch(/blocked_reason\s*=\s*'sortie_inattendue'/);
    expect(ecriture!.sql).toMatch(/where\s+organization_id\s*=\s*\$1/);
  });

  it("rend false quand la session n'existe pas", async () => {
    const { ctx } = faux(0);
    expect(await confirmerIpAttendue(ctx, '198.51.100.9')).toBe(false);
  });
});
