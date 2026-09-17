import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { tickDueEnrollments, mettreInscriptionEnPause } from './sequence.js';

const ORG_ID = 'org-1';
const ENROLLMENT_ID = 'enrollment-1';
const CAMPAIGN_ID = 'campagne-1';
const CONTACT_ID = 'contact-1';
const STEP_ID = 'etape-1';
const SENDER_ID = 'sender-1';
const ACTION_ID = 'action-1';

// Mardi 15/09/2026 10:00 UTC (12:00 Paris, en semaine, dans la fenêtre
// ouvrée par défaut 9h-18h) : déterministe, indépendant du jour/heure réels
// d'exécution du test.
const NOW = new Date('2026-09-15T10:00:00.000Z');

/** Ligne de `REQUETE_LIGNE_INSCRIPTION`, avec des défauts neutres. */
function ligneDue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ENROLLMENT_ID,
    organization_id: ORG_ID,
    campaign_id: CAMPAIGN_ID,
    contact_id: CONTACT_ID,
    signal_id: null,
    current_step: 0,
    linkedin_url: null,
    email: 'marie.durand@exemple.fr',
    email_status: null, // -> gate refuse (pending_bouncer)
    account_id: null,
    persona_id: null,
    first_name: 'Marie',
    last_name: 'Durand',
    locale: null,
    job_title: null,
    approval_policy: {},
    sending_paused_at: null,
    company_name: null,
    domain: null,
    city: null,
    headcount: null,
    postal_code: null,
    country: null,
    persona_angle: null,
    signal_title: null,
    signal_occurred_at: null,
    signal_location: null,
    signal_url: null,
    context_note: null,
    lk_mode: null,
    raw_row: null,
    ...overrides,
  };
}

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

// Motifs de requêtes de `tickDueEnrollments`.
const DUE = /e\.next_action_at <= \$1/i;
const SENDERS = /from senders s\s+where s\.organization_id = any/i;
const BINDINGS_SELECT = /select contact_id, sender_id, sender_kind\s+from contact_sender_bindings/i;
const SNIPPETS = /from message_snippets/i;
const COMPTES_TOUCHES = /join enrollments e on e\.id = a\.enrollment_id/i;
const DOMAIN_PATTERNS = /from domain_patterns/i;
const STEPS = /from sequence_steps where campaign_id/i;
const SUPPRESSIONS = /from suppressions/i;
const INSERT_ACTION = /insert into actions/i;
const INSERT_BINDING = /insert into contact_sender_bindings/i;
const UPDATE_AVANCEMENT = /update enrollments\s+set current_step/i;
const UPDATE_BLOQUE = /update actions set status = 'blocked'/i;
const UPDATE_PAUSE = /update enrollments\s+set status = 'paused'/i;

/** Gestionnaires par défaut : une seule inscription due, une étape email, un
 * expéditeur actif disponible, rien qui défère ou bloque en amont du gate. */
function gestionnairesBase(overridesLigne: Record<string, unknown> = {}): Gestionnaire[] {
  return [
    { motif: DUE, repondre: () => ligne([ligneDue(overridesLigne)]) },
    {
      motif: SENDERS,
      repondre: () =>
        ligne([
          {
            organization_id: ORG_ID,
            id: SENDER_ID,
            kind: 'email',
            is_active: true,
            used_today: 0,
            used_this_hour: 0,
            daily_quota: null,
            hourly_quota: null,
            timezone: 'Europe/Paris',
            business_hours: null,
          },
        ]),
    },
    { motif: BINDINGS_SELECT, repondre: () => ligne([]) },
    { motif: SNIPPETS, repondre: () => ligne([]) },
    { motif: COMPTES_TOUCHES, repondre: () => ligne([]) },
    { motif: DOMAIN_PATTERNS, repondre: () => ligne([]) },
    {
      motif: STEPS,
      repondre: () =>
        ligne([{ id: STEP_ID, channel: 'email', delay_hours: 24, template_parent_id: null }]),
    },
    { motif: SUPPRESSIONS, repondre: () => ligne([{ n: 0 }]) },
    { motif: INSERT_ACTION, repondre: () => ({ rows: [{ id: ACTION_ID }], rowCount: 1 }) },
    { motif: INSERT_BINDING, repondre: () => ligne([]) },
    { motif: UPDATE_AVANCEMENT, repondre: () => ligne([]) },
    { motif: UPDATE_BLOQUE, repondre: () => ligne([]) },
    { motif: UPDATE_PAUSE, repondre: () => ligne([]) },
  ];
}

describe('tickDueEnrollments', () => {
  it('email non délivrable (gate refusé) : action bloquée ET inscription mise en pause sur l’étape bloquée', async () => {
    const { pool, appels } = creerPoolFactice(gestionnairesBase());

    const jobs = await tickDueEnrollments(pool, NOW);

    // Aucun job d'envoi : le gate a refusé.
    expect(jobs).toEqual([]);

    const bloquee = appels.find((a) => UPDATE_BLOQUE.test(a.sql));
    expect(bloquee).toBeDefined();
    expect(bloquee!.values[1]).toBe('email_gate:pending_bouncer');

    // L'avancement (composeTick) écrit `current_step = 1` avant que le gate ne
    // soit connu : sans le correctif, l'inscription resterait sur cette
    // valeur et le tick suivant tenterait l'étape 2, bloquée à son tour.
    const avancement = appels.find((a) => UPDATE_AVANCEMENT.test(a.sql));
    expect(avancement).toBeDefined();
    expect(avancement!.values[1]).toBe(1);

    const pause = appels.find((a) => UPDATE_PAUSE.test(a.sql));
    expect(pause).toBeDefined();
    expect(pause!.values).toEqual([ENROLLMENT_ID, 0, 'email_gate:pending_bouncer']);
    expect(pause!.sql).toMatch(/where id = \$1 and status = 'active'/i);
  });
});

describe('mettreInscriptionEnPause', () => {
  it('émet la requête de pause avec la garde `status = \'active\'` et le coalesce sur stop_reason', async () => {
    const { pool, appels } = creerPoolFactice([{ motif: UPDATE_PAUSE, repondre: () => ligne([]) }]);

    await mettreInscriptionEnPause(pool, ENROLLMENT_ID, 2, 'salesblink_client_error');

    expect(appels).toHaveLength(1);
    const appel = appels[0]!;
    expect(appel.sql).toMatch(/set status = 'paused'/i);
    expect(appel.sql).toMatch(/next_action_at = null/i);
    expect(appel.sql).toMatch(/coalesce\(stop_reason, \$3\)/i);
    expect(appel.sql).toMatch(/current_step = \$2/i);
    expect(appel.sql).toMatch(/where id = \$1 and status = 'active'/i);
    expect(appel.values).toEqual([ENROLLMENT_ID, 2, 'salesblink_client_error']);
  });
});
