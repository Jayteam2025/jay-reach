import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { echeanceEtapeSuivante } from '@jay-reach/core';
import { tickDueEnrollments, mettreInscriptionEnPause, rattraperEcheancesManquantes } from './sequence.js';

// Restauration systématique après CHAQUE test du fichier (tour de correction 2,
// fiabilisation) : un `vi.spyOn(console, 'warn')` non restauré (test qui lance
// une exception avant son propre `.mockRestore()`, par exemple) reste actif
// pour le test suivant et fausse ses assertions sur `console.warn` — cause
// probable de l'instabilité observée (1 échec sur 3 exécutions de la suite
// complète en TZ=UTC). `restoreAllMocks` ici, plutôt qu'un `mockRestore()`
// individuel par test, protège aussi contre l'oubli dans un futur test.
afterEach(() => {
  vi.restoreAllMocks();
});

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
    entry_rules: null,
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
// I2 (relecture des premiers envois) : défaut d'organisation, puis comptage
// des envois déjà partis pour l'étape.
const ORG_SETTINGS = /from organization_settings where organization_id = \$1 and key = \$2/i;
const DEJA_PARTIS = /from actions where step_id = \$1 and status in \('dispatched', 'delivered'\)/i;
// Garde départ réel (issue #111) : statut de l'action de l'étape PRÉCÉDENTE.
const ACTION_PRECEDENTE = /select status from actions where enrollment_id = \$1 and step_id = \$2/i;
// `rattraperEcheancesManquantes` (tour de correction 2, issue #111) : une
// seule requête (jointure latérale sur l'étape précédente puis sur `actions`)
// renvoie déjà les vraies candidates, plus de requête par ligne.
const RATTRAPAGE_CANDIDATS = /select e\.id, e\.campaign_id, e\.current_step, a\.dispatched_at\s+from enrollments e\s+join lateral/i;

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
    // Défaut = 0 (aucune ligne en base) : court-circuite avant le comptage
    // des envois déjà partis, sans casser les tests qui ignorent I2.
    { motif: ORG_SETTINGS, repondre: () => ligne([]) },
    // `current_step: 0` par défaut (`ligneDue()`) : jamais interrogée dans les
    // tests existants (pas d'étape précédente), gardée pour les tests qui
    // avancent `current_step` sans avoir à définir leur propre défaut « part ».
    { motif: ACTION_PRECEDENTE, repondre: () => ligne([{ status: 'dispatched' }]) },
    // Rattrapage (tour de correction 1) : tourne AVANT chaque `tickDueEnrollments`
    // — aucun candidat par défaut, no-op pour tous les tests qui l'ignorent.
    { motif: RATTRAPAGE_CANDIDATS, repondre: () => ligne([]) },
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

describe('tickDueEnrollments — relecture des premiers envois (I2)', () => {
  /** Isole le statut posé par `INSERT_ACTION`, quel que soit ce qui suit (gate email, avancement…). */
  function statutInsere(appels: Appel[]): unknown {
    const insert = appels.find((a) => INSERT_ACTION.test(a.sql));
    expect(insert).toBeDefined();
    return insert!.values[4];
  }

  it('seuil de campagne 3, deux envois déjà partis pour l’étape → la troisième passe en relecture', async () => {
    const gestionnaires = gestionnairesBase({ entry_rules: { relecturePremiersEnvois: 3 } });
    // Sans ce gestionnaire, `creerPoolFactice` lèverait une erreur explicite :
    // le comptage des déjà-partis doit bien être interrogé.
    gestionnaires.push({ motif: DEJA_PARTIS, repondre: () => ligne([{ n: 2 }]) });
    const { pool, appels } = creerPoolFactice(gestionnaires);

    const jobs = await tickDueEnrollments(pool, NOW);

    expect(statutInsere(appels)).toBe('pending_approval');
    expect(jobs).toEqual([]); // pas de dispatch tant que non approuvé

    // L'inscription n'avance pas : elle reste sur l'étape courante, en attente.
    const avancement = appels.find((a) => UPDATE_AVANCEMENT.test(a.sql));
    expect(avancement).toBeDefined();
    expect(avancement!.values[1]).toBe(0);
  });

  it('seuil de campagne 3, trois envois déjà partis → la quatrième part directement', async () => {
    const gestionnaires = gestionnairesBase({ entry_rules: { relecturePremiersEnvois: 3 } });
    gestionnaires.push({ motif: DEJA_PARTIS, repondre: () => ligne([{ n: 3 }]) });
    const { pool, appels } = creerPoolFactice(gestionnaires);

    await tickDueEnrollments(pool, NOW);

    expect(statutInsere(appels)).toBe('scheduled');
  });

  it('seuil 0 sur la campagne → jamais de relecture par ce chemin, sans même compter les envois déjà partis', async () => {
    const gestionnaires = gestionnairesBase({ entry_rules: { relecturePremiersEnvois: 0 } });
    const { pool, appels } = creerPoolFactice(gestionnaires);

    await tickDueEnrollments(pool, NOW);

    expect(statutInsere(appels)).toBe('scheduled');
    expect(appels.some((a) => DEJA_PARTIS.test(a.sql))).toBe(false);
  });

  it('campagne muette sur la relecture → défaut d’organisation lu (`relecture_premiers_envois_defaut`)', async () => {
    const gestionnaires = gestionnairesBase({ entry_rules: null }).map((g) =>
      g.motif === ORG_SETTINGS ? { motif: ORG_SETTINGS, repondre: () => ligne([{ value: 2 }]) } : g,
    );
    gestionnaires.push({ motif: DEJA_PARTIS, repondre: () => ligne([{ n: 1 }]) });
    const { pool, appels } = creerPoolFactice(gestionnaires);

    await tickDueEnrollments(pool, NOW);

    expect(statutInsere(appels)).toBe('pending_approval');
    const lectureDefaut = appels.find((a) => ORG_SETTINGS.test(a.sql));
    expect(lectureDefaut).toBeDefined();
    expect(lectureDefaut!.values).toEqual([ORG_ID, 'relecture_premiers_envois_defaut']);
  });

  it('quatre inscriptions dues sur la MÊME étape dans le même passage, seuil 2, zéro déjà parti en base → seules les deux premières passent en relecture, les deux suivantes partent directement (Important, tour de correction 1)', async () => {
    // Sans l'incrément local du cache, `dejaPartisParEtape` resterait figé à 0
    // pendant tout le passage — les actions créées ici n'atteignent
    // `dispatched`/`delivered` qu'au dispatch, plus tard — et les QUATRE
    // inscriptions passeraient en relecture au lieu des deux premières
    // seulement (« relecture des PREMIERS envois » : les plus anciennes du
    // passage consomment le quota, les suivantes en profitent).
    const quatreLignes = ['enrollment-a', 'enrollment-b', 'enrollment-c', 'enrollment-d'].map((id, i) =>
      ligneDue({ id, contact_id: `contact-${i}`, entry_rules: { relecturePremiersEnvois: 2 } }),
    );
    const gestionnaires = gestionnairesBase().map((g) => (g.motif === DUE ? { motif: DUE, repondre: () => ligne(quatreLignes) } : g));
    gestionnaires.push({ motif: DEJA_PARTIS, repondre: () => ligne([{ n: 0 }]) });
    const { pool, appels } = creerPoolFactice(gestionnaires);

    await tickDueEnrollments(pool, NOW);

    const statuts = appels.filter((a) => INSERT_ACTION.test(a.sql)).map((a) => a.values[4]);
    expect(statuts).toEqual(['pending_approval', 'pending_approval', 'scheduled', 'scheduled']);

    // Une seule lecture du nombre déjà parti en base pour toute l'étape (pas
    // une par inscription) : le reste du décompte vient du cache local.
    expect(appels.filter((a) => DEJA_PARTIS.test(a.sql))).toHaveLength(1);
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

  it('journalise `enrollment_paused` quand l’inscription était bien active (point 3, fil d’activité)', async () => {
    const INSERT_JOURNAL = /insert into audit_events/i;
    const { pool, appels } = creerPoolFactice([
      { motif: UPDATE_PAUSE, repondre: () => ligne([{ organization_id: ORG_ID, contact_id: CONTACT_ID, campaign_id: CAMPAIGN_ID }]) },
      { motif: INSERT_JOURNAL, repondre: () => ligne([]) },
    ]);

    await mettreInscriptionEnPause(pool, ENROLLMENT_ID, 2, 'salesblink_client_error');

    const journal = appels.find((a) => INSERT_JOURNAL.test(a.sql));
    expect(journal).toBeDefined();
    expect(journal!.values[0]).toBe(ORG_ID);
    expect(journal!.values[2]).toBe('contact');
    expect(journal!.values[3]).toBe(CONTACT_ID);
    expect(journal!.values[4]).toBe('enrollment_paused');
    expect(JSON.parse(journal!.values[5] as string)).toMatchObject({ campagneId: CAMPAIGN_ID, motif: 'salesblink_client_error' });
  });

  it('déjà hors "active" (garde SQL) : rien à journaliser', async () => {
    const { pool, appels } = creerPoolFactice([{ motif: UPDATE_PAUSE, repondre: () => ligne([]) }]);

    await mettreInscriptionEnPause(pool, ENROLLMENT_ID, 2, 'salesblink_client_error');

    expect(appels).toHaveLength(1); // aucune écriture de journal
  });
});

describe('tickDueEnrollments — garde départ réel (issue #111)', () => {
  /** Deux étapes : `etape-0` (censée être déjà partie) puis `STEP_ID` (courante). */
  function deuxEtapes(): Reponse {
    return ligne([
      { id: 'etape-0', channel: 'email', delay_hours: 0, template_parent_id: null },
      { id: STEP_ID, channel: 'email', delay_hours: 24, template_parent_id: null },
    ]);
  }

  it('action précédente encore `scheduled` : l’inscription n’avance pas, un seul avertissement, aucune exception', async () => {
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gestionnaires = gestionnairesBase({ current_step: 1 })
      .map((g) => (g.motif === STEPS ? { motif: STEPS, repondre: deuxEtapes } : g))
      .map((g) =>
        g.motif === ACTION_PRECEDENTE ? { motif: ACTION_PRECEDENTE, repondre: () => ligne([{ status: 'scheduled' }]) } : g,
      );
    const { pool, appels } = creerPoolFactice(gestionnaires);

    const jobs = await tickDueEnrollments(pool, NOW);

    expect(jobs).toEqual([]);
    expect(appels.some((a) => INSERT_ACTION.test(a.sql))).toBe(false);
    expect(appels.some((a) => UPDATE_AVANCEMENT.test(a.sql))).toBe(false);
    const requetePrecedente = appels.find((a) => ACTION_PRECEDENTE.test(a.sql));
    expect(requetePrecedente).toBeDefined();
    expect(requetePrecedente!.values).toEqual([ENROLLMENT_ID, 'etape-0']);
    expect(avertissement).toHaveBeenCalledTimes(1);
    expect(avertissement.mock.calls[0]![0]).toContain(ENROLLMENT_ID);

    avertissement.mockRestore();
  });

  it('action précédente `failed` : même garde, même avertissement, aucune exception', async () => {
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gestionnaires = gestionnairesBase({ current_step: 1 })
      .map((g) => (g.motif === STEPS ? { motif: STEPS, repondre: deuxEtapes } : g))
      .map((g) =>
        g.motif === ACTION_PRECEDENTE ? { motif: ACTION_PRECEDENTE, repondre: () => ligne([{ status: 'failed' }]) } : g,
      );
    const { pool, appels } = creerPoolFactice(gestionnaires);

    await tickDueEnrollments(pool, NOW);

    expect(appels.some((a) => INSERT_ACTION.test(a.sql))).toBe(false);
    expect(avertissement).toHaveBeenCalledTimes(1);

    avertissement.mockRestore();
  });

  it('action précédente `dispatched` : la garde ne bloque pas le cas sain, l’inscription avance normalement', async () => {
    const gestionnaires = gestionnairesBase({ current_step: 1 }).map((g) =>
      g.motif === STEPS ? { motif: STEPS, repondre: deuxEtapes } : g,
    );
    const { pool, appels } = creerPoolFactice(gestionnaires);

    await tickDueEnrollments(pool, NOW);

    expect(appels.some((a) => INSERT_ACTION.test(a.sql))).toBe(true);
    expect(appels.some((a) => UPDATE_AVANCEMENT.test(a.sql))).toBe(true);
  });

  it('`current_step` à 0 (première étape) : aucune étape précédente à vérifier, pas de requête émise', async () => {
    const { pool, appels } = creerPoolFactice(gestionnairesBase());

    await tickDueEnrollments(pool, NOW);

    expect(appels.some((a) => ACTION_PRECEDENTE.test(a.sql))).toBe(false);
  });
});

describe('rattraperEcheancesManquantes (tour de correction 2, issue #111)', () => {
  // `poserEcheanceApresDepart` (partagée, @jay-reach/core) : lecture par rang
  // ordinal (`offset`/`limit`), jamais par égalité de `position` (issue #115).
  const DELAI_ETAPE_SUIVANTE =
    /select delay_hours from sequence_steps\s+where campaign_id = \$1\s+order by position asc\s+offset \$2\s+limit 1/i;
  const POSE_ECHEANCE = /update enrollments\s+set next_action_at = \$2\s+where id = \$1/i;

  it('trois inscriptions à échéance nulle (précédente `scheduled`, précédente `dispatched`, inscription `completed`) : une seule ligne candidate renvoyée par la requête, une seule échéance posée', async () => {
    // La requête (tour de correction 2) fait TOUT le filtrage en SQL — jointure
    // latérale sur l'étape précédente puis sur `actions`. Un exécuteur factice
    // ne peut pas exécuter ce SQL : ce test documente le CONTRAT en ne
    // renvoyant, comme le ferait réellement Postgres, que la vraie candidate
    // (celle dont l'action précédente est `dispatched`) — celle dont l'action
    // précédente est encore `scheduled` et celle dont l'inscription est
    // `completed` (donc pas `active`) ne sont jamais renvoyées par le SQL,
    // jamais examinées côté application.
    const dispatchedAt = new Date('2026-09-10T10:04:00.000Z'); // « J »
    const { pool, appels } = creerPoolFactice([
      {
        motif: RATTRAPAGE_CANDIDATS,
        repondre: () => ligne([{ id: ENROLLMENT_ID, campaign_id: CAMPAIGN_ID, current_step: 2, dispatched_at: dispatchedAt }]),
      },
      { motif: DELAI_ETAPE_SUIVANTE, repondre: () => ligne([{ delay_hours: 120 }]) },
      { motif: POSE_ECHEANCE, repondre: () => ({ rows: [], rowCount: 1 }) },
    ]);
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await rattraperEcheancesManquantes(pool);

    const requeteCandidats = appels.find((a) => RATTRAPAGE_CANDIDATS.test(a.sql));
    expect(requeteCandidats).toBeDefined();
    // Gardes de la requête unique : inscription active en attente, étape
    // précédente réellement partie, plus anciennes d'abord.
    expect(requeteCandidats!.sql).toMatch(/e\.status = 'active'/i);
    expect(requeteCandidats!.sql).toMatch(/e\.next_action_at is null/i);
    expect(requeteCandidats!.sql).toMatch(/e\.current_step > 0/i);
    expect(requeteCandidats!.sql).toMatch(/a\.status in \('dispatched', 'delivered'\)/i);
    expect(requeteCandidats!.sql).toMatch(/a\.dispatched_at is not null/i);
    expect(requeteCandidats!.sql).toMatch(/order by a\.dispatched_at asc/i);

    // Une seule ligne candidate → une seule échéance posée, aucune requête
    // « par ligne » supplémentaire pour filtrer davantage côté application.
    expect(appels.filter((a) => DELAI_ETAPE_SUIVANTE.test(a.sql))).toHaveLength(1);
    const pose = appels.find((a) => POSE_ECHEANCE.test(a.sql));
    expect(pose).toBeDefined();
    // Calculée depuis `dispatched_at` (le DÉPART RÉEL déjà connu), jamais `now`.
    const attendu = echeanceEtapeSuivante(dispatchedAt.getTime(), ENROLLMENT_ID, 120);
    expect(pose!.values).toEqual([ENROLLMENT_ID, new Date(attendu!).toISOString(), 2]);

    // Assertion sur le CONTENU de l'avertissement plutôt que sur le nombre total
    // d'appels à `console.warn` (un autre passage aurait pu en émettre un autre) :
    // un `spyOn` non restauré ailleurs ne peut pas rendre cette assertion instable.
    expect(avertissement.mock.calls.some((appel) => String(appel[0]).includes('rattrapée'))).toBe(true);
  });

  it('aucune candidate (requête vide) : aucune échéance posée, aucun avertissement', async () => {
    const { pool, appels } = creerPoolFactice([{ motif: RATTRAPAGE_CANDIDATS, repondre: () => ligne([]) }]);
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await rattraperEcheancesManquantes(pool);

    expect(appels).toHaveLength(1); // aucun candidat : rien d'autre n'est interrogé
    expect(avertissement.mock.calls.some((appel) => String(appel[0]).includes('rattrapée'))).toBe(false);
  });

  it('plusieurs candidates : une échéance posée par ligne, le compte de l’avertissement suit', async () => {
    const dispatchedAt = new Date('2026-09-10T10:04:00.000Z');
    const { pool, appels } = creerPoolFactice([
      {
        motif: RATTRAPAGE_CANDIDATS,
        repondre: () =>
          ligne([
            { id: 'enrollment-a', campaign_id: CAMPAIGN_ID, current_step: 1, dispatched_at: dispatchedAt },
            { id: 'enrollment-b', campaign_id: CAMPAIGN_ID, current_step: 2, dispatched_at: dispatchedAt },
          ]),
      },
      { motif: DELAI_ETAPE_SUIVANTE, repondre: () => ligne([{ delay_hours: 24 }]) },
      { motif: POSE_ECHEANCE, repondre: () => ({ rows: [], rowCount: 1 }) },
    ]);
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await rattraperEcheancesManquantes(pool);

    expect(appels.filter((a) => POSE_ECHEANCE.test(a.sql))).toHaveLength(2);
    const appelAvertissement = avertissement.mock.calls.find((appel) => String(appel[0]).includes('rattrapée'));
    expect(appelAvertissement).toBeDefined();
    expect(String(appelAvertissement![0])).toContain('2');
  });
});
