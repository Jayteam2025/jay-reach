import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { echeanceEtapeSuivante, actionIdempotencyKey, poserEcheanceApresDepart } from '@jay-reach/core';
import {
  tickDueEnrollments,
  mettreInscriptionEnPause,
  rattraperEcheancesManquantes,
  chargerContraintesSender,
  compterEntreesDuJour,
  reprendreAbsencesEchues,
} from './sequence.js';

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
// Revue F5, point 2 : `loadSenders`/`chargerContraintesSender` lisent le
// fuseau de l'organisation (`fuseauDeLOrganisation`, clé 'fuseau' en dur,
// motif distinct de `ORG_SETTINGS` ci-dessus qui porte la clé en paramètre).
const FUSEAU_ORGANISATION = /from organization_settings where organization_id = \$1 and key = 'fuseau'/i;
const DEJA_PARTIS = /from actions where step_id = \$1 and status in \('dispatched', 'delivered'\)/i;
// Garde départ réel (issue #111) : statut de l'action de l'étape PRÉCÉDENTE.
const ACTION_PRECEDENTE = /select status from actions where enrollment_id = \$1 and step_id = \$2/i;
// `rattraperEcheancesManquantes` (tour de correction 2, issue #111) : une
// seule requête (jointure latérale sur l'étape précédente puis sur `actions`)
// renvoie déjà les vraies candidates, plus de requête par ligne.
const RATTRAPAGE_CANDIDATS = /select e\.id, e\.campaign_id, e\.current_step, a\.dispatched_at\s+from enrollments e\s+join lateral/i;
// `reprendreAbsencesEchues` (F10) : tourne AVANT le rattrapage, même motif de
// défaut neutre — aucune candidate par défaut, no-op pour les tests qui
// l'ignorent (voir la suite dédiée `reprendreAbsencesEchues (F10)`). Jointure
// `campaigns camp` ajoutée par le filtre de statut (F14, mineur) : le motif
// matche sur les colonnes préfixées `e.`, qui ne sont apparues qu'avec elle.
const ABSENCE_CANDIDATS = /select e\.id, e\.organization_id, e\.contact_id, e\.campaign_id, e\.current_step, e\.resume_at\s+from enrollments e\s+join campaigns camp on camp\.id = e\.campaign_id\s+where e\.status = 'paused_absence'/i;

/** Gestionnaires par défaut : une seule inscription due, une étape email, un
 * expéditeur actif disponible, rien qui défère ou bloque en amont du gate. */
function gestionnairesBase(overridesLigne: Record<string, unknown> = {}): Gestionnaire[] {
  return [
    { motif: DUE, repondre: () => ligne([ligneDue(overridesLigne)]) },
    { motif: FUSEAU_ORGANISATION, repondre: () => ligne([{ value: 'Europe/Paris' }]) },
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
    // Reprise d'absence (F10) : tourne encore avant — même défaut neutre.
    { motif: ABSENCE_CANDIDATS, repondre: () => ligne([]) },
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

  it('revue F5, point 2 : le jour compté (used_today) des expéditeurs suit le fuseau de l’organisation, pas celui du serveur', async () => {
    const { pool, appels } = creerPoolFactice(gestionnairesBase());

    await tickDueEnrollments(pool, NOW);

    const requeteFuseau = appels.find((a) => FUSEAU_ORGANISATION.test(a.sql));
    expect(requeteFuseau).toBeDefined();
    expect(requeteFuseau!.values).toEqual([ORG_ID]);

    const requeteSenders = appels.find((a) => SENDERS.test(a.sql));
    expect(requeteSenders).toBeDefined();
    expect(requeteSenders!.sql).toMatch(/date_trunc\('day', now\(\) at time zone \(\$2::jsonb ->> s\.organization_id::text\)\)/i);
    expect(requeteSenders!.sql).not.toContain("date_trunc('day', now())");
    // Relecture : `used_this_hour` doit suivre le même fuseau que `used_today`
    // ci-dessus, pas l'heure du serveur (décalage non entier, Inde/Népal).
    expect(requeteSenders!.sql).toMatch(/date_trunc\('hour', now\(\) at time zone \(\$2::jsonb ->> s\.organization_id::text\)\)/i);
    expect(requeteSenders!.sql).not.toContain("date_trunc('hour', now())");
    // La carte {orgId -> fuseau} part en un seul paramètre jsonb (un lot de
    // tick peut mélanger plusieurs organisations) — ici une seule, résolue
    // via la requête `FUSEAU_ORGANISATION` ci-dessus.
    expect(JSON.parse(requeteSenders!.values[1] as string)).toEqual({ [ORG_ID]: 'Europe/Paris' });
  });
});

describe('tickDueEnrollments — expéditeur par canal (revue finale, C1)', () => {
  /** Aucune ligne `senders` active : le cas du canal serveur, qui n'en crée jamais. */
  const SANS_EXPEDITEUR: Gestionnaire = { motif: SENDERS, repondre: () => ligne([]) };
  const etape = (channel: string): Gestionnaire => ({
    motif: STEPS,
    repondre: () => ligne([{ id: STEP_ID, channel, delay_hours: 24, template_parent_id: null }]),
  });

  it('une étape d’invitation LinkedIn crée son action sans aucune ligne `senders` active', async () => {
    const { pool, appels } = creerPoolFactice([
      SANS_EXPEDITEUR,
      etape('linkedin_invite'),
      ...gestionnairesBase({ linkedin_url: 'https://www.linkedin.com/in/jeanne-dupont/' }),
    ]);

    const jobs = await tickDueEnrollments(pool, NOW);

    const insertion = appels.find((a) => INSERT_ACTION.test(a.sql));
    expect(insertion).toBeDefined();
    // Pas d'expéditeur attribué, donc aucun lien contact/expéditeur écrit.
    expect(insertion!.sql).toMatch(/sender_id\)/);
    expect(insertion!.values.at(-1)).toBeNull();
    expect(appels.some((a) => INSERT_BINDING.test(a.sql))).toBe(false);
    // Aucune pause `sender_unavailable`.
    expect(appels.some((a) => UPDATE_PAUSE.test(a.sql))).toBe(false);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ channel: 'linkedin_invite', actionId: ACTION_ID });
  });

  it('une étape email continue d’exiger la sienne : sans expéditeur actif, pause et aucune action', async () => {
    const { pool, appels } = creerPoolFactice([SANS_EXPEDITEUR, ...gestionnairesBase({ email_status: 'valid' })]);

    const jobs = await tickDueEnrollments(pool, NOW);

    expect(jobs).toEqual([]);
    expect(appels.some((a) => INSERT_ACTION.test(a.sql))).toBe(false);
    const pause = appels.find((a) => UPDATE_PAUSE.test(a.sql));
    expect(pause).toBeDefined();
    expect(pause!.values).toEqual([ENROLLMENT_ID, 'sender_unavailable:email']);
  });
});

describe('tickDueEnrollments — campagne non active (F14)', () => {
  /**
   * Pool factice AVEC ÉTAT, dédié à ce défaut : contrairement à
   * `creerPoolFactice` (qui répond au TEXTE d'une requête sans jamais évaluer
   * son `where`, donc renverrait la même ligne due qu'on modélise une
   * campagne brouillon ou active), celui-ci décide RÉELLEMENT selon le SQL
   * produit — la ligne due n'est renvoyée que si la requête ne filtre PAS sur
   * `camp.status = 'active'` (correctif annulé : comportement d'avant, la
   * ligne repart inconditionnellement) OU que la campagne modélisée est bien
   * `active`. Sans le correctif, les tests « brouillon »/« en pause » ci-dessous
   * verraient donc la ligne due traitée comme avant — exactement le défaut
   * constaté (F14) — et rougiraient sur `expect(jobs).toEqual([])`.
   */
  function creerPoolAvecStatutCampagne(statutCampagne: string): { pool: Pool; appels: Appel[] } {
    const base = gestionnairesBase();
    const appels: Appel[] = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      appels.push({ sql, values });
      if (DUE.test(sql)) {
        const filtreCampagneActive = /camp\.status\s*=\s*'active'/i.test(sql);
        const renvoyer = !filtreCampagneActive || statutCampagne === 'active';
        return ligne(renvoyer ? [ligneDue()] : []);
      }
      const trouve = base.find((g) => g.motif.test(sql));
      if (!trouve) throw new Error(`requete non prevue par le test :\n${sql}`);
      return trouve.repondre(values);
    });
    return { pool: { query } as unknown as Pool, appels };
  }

  // `jobs` seul ne suffit pas à prouver que la ligne a été écartée : le socle
  // par défaut (`ligneDue()`, `email_status: null`) fait déjà refuser le gate
  // et renvoie `jobs: []` même quand la ligne EST traitée (voir le test
  // « campagne active » ci-dessous, où `jobs` vaut aussi `[]`). La preuve
  // réelle est qu'AUCUNE requête du corps de boucle (chargement de l'étape)
  // n'a été tentée — sans ça, ces trois tests seraient verts même code annulé
  // (constaté : ils passaient à tort avant cette relecture).
  it('campagne en brouillon (jamais lancée) : l’inscription due n’est pas sélectionnée, aucun envoi', async () => {
    const { pool, appels } = creerPoolAvecStatutCampagne('draft');

    const jobs = await tickDueEnrollments(pool, NOW);

    expect(jobs).toEqual([]);
    expect(appels.some((a) => STEPS.test(a.sql))).toBe(false);
  });

  it('campagne mise en pause : l’inscription due n’est pas sélectionnée, aucun envoi', async () => {
    const { pool, appels } = creerPoolAvecStatutCampagne('paused');

    const jobs = await tickDueEnrollments(pool, NOW);

    expect(jobs).toEqual([]);
    expect(appels.some((a) => STEPS.test(a.sql))).toBe(false);
  });

  it('campagne archivée : l’inscription due n’est pas sélectionnée, aucun envoi', async () => {
    const { pool, appels } = creerPoolAvecStatutCampagne('archived');

    const jobs = await tickDueEnrollments(pool, NOW);

    expect(jobs).toEqual([]);
    expect(appels.some((a) => STEPS.test(a.sql))).toBe(false);
  });

  it('campagne active (non-régression) : l’inscription due est bien sélectionnée et traitée', async () => {
    const { pool, appels } = creerPoolAvecStatutCampagne('active');

    const jobs = await tickDueEnrollments(pool, NOW);

    // Même comportement que le socle par défaut (`gestionnairesBase()` seul,
    // gate email refusé faute d'`email_status`) : aucun job d'envoi, mais
    // l'étape a été chargée et l'action bloquée prouvent que la ligne A ÉTÉ
    // sélectionnée et traitée — contrairement aux trois tests ci-dessus où
    // rien n'est même tenté.
    expect(jobs).toEqual([]);
    expect(appels.some((a) => STEPS.test(a.sql))).toBe(true);
    const bloquee = appels.find((a) => UPDATE_BLOQUE.test(a.sql));
    expect(bloquee).toBeDefined();
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

  // Revue F5, correctif mineur : rapport précédent, comptage. Même garantie que la fonction
  // sœur du cœur (`mettreEnPause`, `campagnes.test.ts`) — un journal qui échoue ne doit jamais
  // faire échouer CE handler ni retenter pg-boss, l'inscription est déjà en pause en base.
  it('un échec du journal n’empêche jamais la mise en pause de réussir', async () => {
    const INSERT_JOURNAL = /insert into audit_events/i;
    const { pool, appels } = creerPoolFactice([
      { motif: UPDATE_PAUSE, repondre: () => ligne([{ organization_id: ORG_ID, contact_id: CONTACT_ID, campaign_id: CAMPAIGN_ID }]) },
      {
        motif: INSERT_JOURNAL,
        repondre: () => {
          throw new Error('table audit_events indisponible');
        },
      },
    ]);
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(mettreInscriptionEnPause(pool, ENROLLMENT_ID, 2, 'salesblink_client_error')).resolves.toBeUndefined();

    expect(appels.some((a) => UPDATE_PAUSE.test(a.sql))).toBe(true);
    expect(avertissement).toHaveBeenCalledWith('[journal] enrollment_paused', expect.any(Error));
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

describe("tickDueEnrollments — garde-fou clé d'idempotence déjà prise (revue transversale, lot 2)", () => {
  it("l'action de l'étape courante existe déjà (`on conflict … do nothing`) : un avertissement nommant l'inscription, aucune exception, l'inscription n'avance pas", async () => {
    // Reproduit la signature du défaut 1 (inscription figée) au niveau du
    // tick lui-même : une clé d'idempotence déjà prise pour `current_step`
    // est le plus souvent un rejeu bénin, mais c'est EXACTEMENT ce qui se
    // reproduit à chaque passage pour une inscription restée bloquée sans
    // progression — avant ce garde-fou, ce cas ne laissait aucune trace.
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gestionnaires = gestionnairesBase().map((g) =>
      g.motif === INSERT_ACTION ? { motif: INSERT_ACTION, repondre: () => ({ rows: [], rowCount: 0 }) } : g,
    );
    const { pool, appels } = creerPoolFactice(gestionnaires);

    const jobs = await tickDueEnrollments(pool, NOW);

    expect(jobs).toEqual([]);
    expect(appels.some((a) => UPDATE_AVANCEMENT.test(a.sql))).toBe(false);
    expect(avertissement).toHaveBeenCalledTimes(1);
    expect(avertissement.mock.calls[0]![0]).toContain(ENROLLMENT_ID);

    avertissement.mockRestore();
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

describe('chargerContraintesSender (revue F5, point 2)', () => {
  it('lit le jour calendaire par « at time zone », jamais `date_trunc(\'day\', now())` (fuseau de l’organisation, pas celui du serveur)', async () => {
    const { pool, appels } = creerPoolFactice([
      { motif: FUSEAU_ORGANISATION, repondre: () => ligne([{ value: 'Pacific/Kiritimati' }]) },
      {
        motif: /from senders s where s\.id/i,
        repondre: () =>
          ligne([
            { daily_quota: 30, hourly_quota: 5, timezone: 'Europe/Paris', business_hours: null, used_today: 4, used_this_hour: 1 },
          ]),
      },
    ]);

    const contraintes = await chargerContraintesSender(pool, SENDER_ID, ORG_ID);

    const requeteFuseau = appels.find((a) => FUSEAU_ORGANISATION.test(a.sql));
    expect(requeteFuseau).toBeDefined();
    expect(requeteFuseau!.values).toEqual([ORG_ID]);

    const requeteSender = appels.find((a) => /from senders s where s\.id/i.test(a.sql));
    expect(requeteSender).toBeDefined();
    expect(requeteSender!.sql).toMatch(/dispatched_at >= date_trunc\('day', now\(\) at time zone \$2\) at time zone \$2/i);
    expect(requeteSender!.sql).not.toContain("date_trunc('day', now())");
    // Relecture : `used_this_hour` doit suivre le même fuseau que `used_today`
    // ci-dessus, pas l'heure du serveur (décalage non entier, Inde/Népal).
    expect(requeteSender!.sql).toMatch(/dispatched_at >= date_trunc\('hour', now\(\) at time zone \$2\) at time zone \$2/i);
    expect(requeteSender!.sql).not.toContain("date_trunc('hour', now())");
    expect(requeteSender!.values).toEqual([SENDER_ID, 'Pacific/Kiritimati']);

    expect(contraintes).toEqual({
      dailyQuota: 30,
      hourlyQuota: 5,
      timezone: 'Europe/Paris',
      businessHours: null,
      usedToday: 4,
      usedThisHour: 1,
    });
  });
});

describe('compterEntreesDuJour (revue F5, point 1, tour de correction 2)', () => {
  it('lit le jour calendaire par « at time zone », jamais `date_trunc(\'day\', now())` (fuseau de l’organisation, pas celui du serveur)', async () => {
    const { pool, appels } = creerPoolFactice([
      { motif: FUSEAU_ORGANISATION, repondre: () => ligne([{ value: 'Pacific/Kiritimati' }]) },
      { motif: /from enrollments\s+where campaign_id/i, repondre: () => ligne([{ n: '3' }]) },
    ]);

    const n = await compterEntreesDuJour(pool, CAMPAIGN_ID, ORG_ID);

    const requeteFuseau = appels.find((a) => FUSEAU_ORGANISATION.test(a.sql));
    expect(requeteFuseau).toBeDefined();
    expect(requeteFuseau!.values).toEqual([ORG_ID]);

    const requeteCompte = appels.find((a) => /from enrollments\s+where campaign_id/i.test(a.sql));
    expect(requeteCompte).toBeDefined();
    expect(requeteCompte!.sql).toMatch(/started_at >= date_trunc\('day', now\(\) at time zone \$2\) at time zone \$2/i);
    expect(requeteCompte!.sql).not.toContain("date_trunc('day', now())");
    expect(requeteCompte!.values).toEqual([CAMPAIGN_ID, 'Pacific/Kiritimati']);
    expect(n).toBe(3);
  });
});

describe('reprendreAbsencesEchues (F10)', () => {
  const STEP_ID_ABSENCE = 'etape-en-attente';

  interface EtatInscriptionAbsence {
    status: string;
    next_action_at: string | Date | null;
    current_step: number;
  }

  interface CandidatAbsence {
    id: string;
    organization_id: string;
    contact_id: string | null;
    campaign_id: string;
    current_step: number;
    resume_at: string | Date;
    /** Statut modélisé de `campaign_id` — défaut `'active'` (F14, mineur). */
    campaignStatus?: string;
  }

  interface ReponsesAbsence {
    /** Étape au rang `current_step` : absente simule une séquence qui l'a perdue. */
    etape?: { id: string; delay_hours: number };
    /** Action `blocked`/`failed` déjà en base pour cette étape (cas `paused -> paused_absence`). */
    actionBloquee?: { messageId: string | null };
  }

  /**
   * Pool factice AVEC ÉTAT, réservé à `reprendreAbsencesEchues` : contrairement
   * à `creerPoolFactice` (qui répond au TEXTE d'une requête, sans jamais
   * évaluer son `where`), celui-ci modélise l'inscription en mémoire et
   * évalue RÉELLEMENT les gardes des deux UPDATE sur `enrollments` — sans ça,
   * un test ne peut pas voir une régression du type « next_action_at pas
   * remis à null avant la pose d'échéance » : le TEXTE de la requête de pose
   * ne change pas, seul son EFFET réel change selon l'état qu'elle trouve.
   * `next_action_at` de l'état initial modélise le fait établi que
   * `record-reply.ts` le pose au même instant que `resume_at`, à la pause —
   * jamais `null` au départ.
   */
  function creerPoolAbsence(
    candidats: CandidatAbsence[],
    etatInitial: EtatInscriptionAbsence,
    reponses: ReponsesAbsence = {},
  ): { pool: Pool; appels: Appel[]; etat: () => EtatInscriptionAbsence } {
    let etat: EtatInscriptionAbsence = { ...etatInitial };
    const appels: Appel[] = [];
    const ACTIVATION = /update enrollments\s+set status = 'active'.*where id = \$1 and status = 'paused_absence'/is;
    const POSE =
      /update enrollments\s+set next_action_at = \$2\s+where id = \$1\s+and status = 'active'\s+and next_action_at is null\s+and current_step = \$3/i;
    // Requête combinée (id + delay_hours) : sert aux DEUX issues, poser
    // l'échéance ou calculer le `scheduled_for` du rejeu (voir le code).
    const ETAPE = /select id, delay_hours from sequence_steps/i;
    // Requête interne de `poserEcheanceApresDepart`/`poserEcheanceDepuisDispatch`
    // (`sequencer/echeance.ts`, non modifiée) : ne sélectionne que `delay_hours`,
    // jamais `id` — distincte de `ETAPE` ci-dessus (préfixe différent, aucun
    // recouvrement possible).
    const DELAI_ETAPE = /select delay_hours from sequence_steps/i;
    // Existence d'une action bloquée/en échec à rejouer, décidée AVANT toute
    // écriture : `deja_envoyee` remplace l'ancien filtre SQL sur
    // `message_id`, désormais une colonne calculée par ligne.
    const LIGNE_BLOQUEE = /select id, \(payload ->> 'message_id'\) is not null as deja_envoyee/i;
    const REJEU_ACTION = /update actions\s+set status = 'scheduled'/i;
    const JOURNAL = /insert into audit_events/i;
    // Repli (étape supprimée pendant la pause) : ni délai à lire, ni action à
    // rejouer — sans lui, `next_action_at` resterait `null` pour toujours.
    const REPLI =
      /update enrollments\s+set next_action_at = now\(\)\s+where id = \$1 and status = 'active' and next_action_at is null/i;

    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      appels.push({ sql, values });
      if (ABSENCE_CANDIDATS.test(sql)) {
        // F14 (mineur) : décide RÉELLEMENT selon le SQL produit — une
        // candidate dont la campagne modélisée n'est pas active n'est
        // renvoyée que si la requête ne filtre PAS sur `camp.status =
        // 'active'` (correctif annulé, comportement d'avant).
        const filtreCampagneActive = /camp\.status\s*=\s*'active'/i.test(sql);
        const visibles = filtreCampagneActive
          ? candidats.filter((c) => (c.campaignStatus ?? 'active') === 'active')
          : candidats;
        return ligne(visibles);
      }
      if (ACTIVATION.test(sql)) {
        if (etat.status !== 'paused_absence') return { rows: [], rowCount: 0 };
        etat = {
          ...etat,
          status: 'active',
          // Si le code omettait `next_action_at = null` dans le SET, cette
          // valeur resterait celle posée par `record-reply.ts` à la pause —
          // c'est exactement le bug rapporté.
          next_action_at: /next_action_at\s*=\s*null/i.test(sql) ? null : etat.next_action_at,
        };
        return { rows: [], rowCount: 1 };
      }
      if (POSE.test(sql)) {
        const [, nextActionAt, currentStep] = values as [string, string, number];
        const okGarde = etat.status === 'active' && etat.next_action_at === null && etat.current_step === currentStep;
        if (!okGarde) return { rows: [], rowCount: 0 };
        etat = { ...etat, next_action_at: nextActionAt };
        return { rows: [], rowCount: 1 };
      }
      if (ETAPE.test(sql)) {
        return ligne(reponses.etape ? [{ id: reponses.etape.id, delay_hours: reponses.etape.delay_hours }] : []);
      }
      if (DELAI_ETAPE.test(sql)) {
        return ligne(reponses.etape ? [{ delay_hours: reponses.etape.delay_hours }] : []);
      }
      if (LIGNE_BLOQUEE.test(sql)) {
        return ligne(
          reponses.actionBloquee
            ? [{ id: 'action-bloquee', deja_envoyee: reponses.actionBloquee.messageId !== null }]
            : [],
        );
      }
      if (REJEU_ACTION.test(sql)) {
        const rejouee = reponses.actionBloquee != null && reponses.actionBloquee.messageId === null;
        return { rows: [], rowCount: rejouee ? 1 : 0 };
      }
      if (JOURNAL.test(sql)) return { rows: [{}], rowCount: 1 };
      if (REPLI.test(sql)) {
        const okGarde = etat.status === 'active' && etat.next_action_at === null;
        if (!okGarde) return { rows: [], rowCount: 0 };
        etat = { ...etat, next_action_at: 'now()' };
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`requete non prevue par le test :\n${sql}`);
    });
    return { pool: { query } as unknown as Pool, appels, etat: () => etat };
  }

  it("exemple de l'énoncé : étape partie le 1er, délai de l'étape suivante 4 jours (96h), absence jusqu'au 20 → prochain envoi le 24 (retour + délai), jamais le jour du retour", async () => {
    const resumeAt = new Date('2026-09-20T00:00:00.000Z');
    const now = new Date('2026-09-21T08:00:00.000Z'); // le moteur repasse après le retour
    const candidat: CandidatAbsence = {
      id: ENROLLMENT_ID,
      organization_id: ORG_ID,
      contact_id: CONTACT_ID,
      campaign_id: CAMPAIGN_ID,
      current_step: 2,
      resume_at: resumeAt,
    };
    const { pool, etat } = creerPoolAbsence(
      [candidat],
      { status: 'paused_absence', next_action_at: resumeAt, current_step: 2 }, // posé par record-reply.ts à la pause
      { etape: { id: STEP_ID_ABSENCE, delay_hours: 96 } },
    );

    await reprendreAbsencesEchues(pool, now);

    // Le 20 (retour) + 4 jours = le 24 — jamais le jour du retour lui-même.
    // Cette assertion sur l'ÉTAT (pas sur le texte d'une requête) rougit si
    // l'activation omet `next_action_at = null` : la garde de la pose
    // d'échéance échouerait alors, et `next_action_at` resterait `resumeAt`.
    const attendu = echeanceEtapeSuivante(resumeAt.getTime(), ENROLLMENT_ID, 96);
    expect(etat().next_action_at).toEqual(new Date(attendu!).toISOString());
    expect(new Date(attendu!).getUTCDate()).toBe(24);
  });

  it('reprise échue depuis plusieurs jours : l’échéance se calcule depuis resume_at, jamais depuis now', async () => {
    const resumeAt = new Date('2026-09-10T00:00:00.000Z');
    const now = new Date('2026-09-15T10:00:00.000Z'); // 5 jours de retard (worker resté arrêté)
    const candidat: CandidatAbsence = {
      id: ENROLLMENT_ID,
      organization_id: ORG_ID,
      contact_id: CONTACT_ID,
      campaign_id: CAMPAIGN_ID,
      current_step: 1,
      resume_at: resumeAt,
    };
    const { pool, etat } = creerPoolAbsence(
      [candidat],
      { status: 'paused_absence', next_action_at: resumeAt, current_step: 1 },
      { etape: { id: STEP_ID_ABSENCE, delay_hours: 24 } },
    );

    await reprendreAbsencesEchues(pool, now);

    const attendu = echeanceEtapeSuivante(resumeAt.getTime(), ENROLLMENT_ID, 24);
    expect(etat().next_action_at).toEqual(new Date(attendu!).toISOString());
  });

  it('idempotent : une candidate déjà active (réactivée par un passage précédent ou concurrent) ne pose aucune échéance', async () => {
    const resumeAt = new Date('2026-09-10T00:00:00.000Z');
    const candidat: CandidatAbsence = {
      id: ENROLLMENT_ID,
      organization_id: ORG_ID,
      contact_id: CONTACT_ID,
      campaign_id: CAMPAIGN_ID,
      current_step: 1,
      resume_at: resumeAt,
    };
    const { pool, appels, etat } = creerPoolAbsence(
      [candidat],
      { status: 'active', next_action_at: new Date('2026-09-30T00:00:00.000Z'), current_step: 1 }, // déjà reprise
      { etape: { id: STEP_ID_ABSENCE, delay_hours: 24 } },
    );

    await reprendreAbsencesEchues(pool, new Date('2026-09-15T10:00:00.000Z'));

    // L'activation échoue (statut déjà `active`) : rien d'autre n'est tenté,
    // et l'échéance déjà en place n'est pas touchée.
    expect(appels.filter((a) => /select id from sequence_steps|select delay_hours/i.test(a.sql))).toHaveLength(0);
    expect(appels.filter((a) => /insert into audit_events/i.test(a.sql))).toHaveLength(0);
    expect(etat().next_action_at).toEqual(new Date('2026-09-30T00:00:00.000Z'));
  });

  it('pause -> paused_absence direct (LIVE_STATUSES accepte paused) : l’étape déjà tentée, bloquée en base, est rejouée — jamais `now()` (défaut 2 de la revue transversale)', async () => {
    const resumeAt = new Date('2026-09-10T00:00:00.000Z');
    const now = new Date('2026-09-15T10:00:00.000Z');
    const candidat: CandidatAbsence = {
      id: ENROLLMENT_ID,
      organization_id: ORG_ID,
      contact_id: CONTACT_ID,
      campaign_id: CAMPAIGN_ID,
      current_step: 3, // étape restée bloquée, pas encore partie
      resume_at: resumeAt,
    };
    const { pool, appels, etat } = creerPoolAbsence(
      [candidat],
      { status: 'paused_absence', next_action_at: resumeAt, current_step: 3 },
      { etape: { id: STEP_ID_ABSENCE, delay_hours: 48 }, actionBloquee: { messageId: null } },
    );

    await reprendreAbsencesEchues(pool, now);

    const rejeu = appels.find((a) => /update actions\s+set status = 'scheduled'/i.test(a.sql));
    expect(rejeu).toBeDefined();
    // Le délai (48h) repart depuis le RETOUR, jamais `now()` : sinon le
    // message partirait le jour même de la reprise, exactement ce que la
    // règle produit interdit (défaut 2).
    const attendu = echeanceEtapeSuivante(resumeAt.getTime(), ENROLLMENT_ID, 48);
    expect(rejeu!.values).toEqual([
      actionIdempotencyKey(ENROLLMENT_ID, STEP_ID_ABSENCE),
      ORG_ID,
      new Date(attendu!).toISOString(),
    ]);
    expect(rejeu!.values).not.toContain(now.toISOString());

    // L'échéance de l'inscription n'est PAS posée en plus du rejeu (défaut 1) :
    // sans ça, le départ réel de cette action ne pourrait plus jamais poser
    // l'échéance suivante (garde `next_action_at is null` déjà consommée), et
    // l'inscription boucle au tick sans avancer.
    expect(appels.some((a) => /update enrollments\s+set next_action_at = \$2/i.test(a.sql))).toBe(false);
    expect(etat().next_action_at).toBeNull();
  });

  it('pause -> paused_absence direct, mais l’action bloquée porte déjà une preuve d’envoi : pas rejouée (même garde M3 que la reprise manuelle), l’échéance se pose normalement', async () => {
    const resumeAt = new Date('2026-09-10T00:00:00.000Z');
    const candidat: CandidatAbsence = {
      id: ENROLLMENT_ID,
      organization_id: ORG_ID,
      contact_id: CONTACT_ID,
      campaign_id: CAMPAIGN_ID,
      current_step: 3,
      resume_at: resumeAt,
    };
    const { pool, appels, etat } = creerPoolAbsence(
      [candidat],
      { status: 'paused_absence', next_action_at: resumeAt, current_step: 3 },
      { etape: { id: STEP_ID_ABSENCE, delay_hours: 48 }, actionBloquee: { messageId: 'msg-deja-envoye' } },
    );

    await reprendreAbsencesEchues(pool, new Date('2026-09-15T10:00:00.000Z'));

    const rejeu = appels.find((a) => /update actions\s+set status = 'scheduled'/i.test(a.sql));
    expect(rejeu).toBeUndefined();
    // Rien à rejouer : l'échéance se pose comme dans le cas normal.
    const attendu = echeanceEtapeSuivante(resumeAt.getTime(), ENROLLMENT_ID, 48);
    expect(etat().next_action_at).toEqual(new Date(attendu!).toISOString());
  });

  it("la boucle du défaut 1 ne se reproduit plus : après le rejeu d'une étape bloquée, le départ réel de l'action peut poser l'échéance suivante (deux passages)", async () => {
    const resumeAt = new Date('2026-09-10T00:00:00.000Z');
    const candidat: CandidatAbsence = {
      id: ENROLLMENT_ID,
      organization_id: ORG_ID,
      contact_id: CONTACT_ID,
      campaign_id: CAMPAIGN_ID,
      current_step: 3,
      resume_at: resumeAt,
    };
    const { pool, etat } = creerPoolAbsence(
      [candidat],
      { status: 'paused_absence', next_action_at: resumeAt, current_step: 3 },
      { etape: { id: STEP_ID_ABSENCE, delay_hours: 48 }, actionBloquee: { messageId: null } },
    );

    // Passage 1 : reprise après absence — l'étape bloquée est rejouée.
    // Sans le correctif, `poserEcheanceDepuisDispatch` aurait déjà posé
    // `next_action_at` ICI (appelé malgré le rejeu), et l'assertion suivante
    // rougirait.
    await reprendreAbsencesEchues(pool, new Date('2026-09-15T10:00:00.000Z'));
    expect(etat().next_action_at).toBeNull();

    // Passage 2 : départ réel de l'action rejouée, simulé comme le ferait le
    // gestionnaire d'envoi (`email-salesblink.ts`) via `poserEcheanceApresDepart`
    // — sur le MÊME état, partagé avec le passage 1. Sans le correctif,
    // `next_action_at` serait déjà non nul (posé au passage 1) et sa garde
    // `next_action_at is null` échouerait : c'est exactement le blocage qui
    // faisait boucler l'inscription indéfiniment au tick, sans plus jamais
    // avancer.
    const posee = await poserEcheanceApresDepart(
      pool,
      { enrollmentId: ENROLLMENT_ID, campaignId: CAMPAIGN_ID, currentStep: 3 },
      new Date('2026-09-15T11:00:00.000Z'),
    );

    expect(posee).toBe(true);
    expect(etat().next_action_at).not.toBeNull();
  });

  it('le passage paused_absence -> active est journalisé (enrollment_resumed)', async () => {
    const resumeAt = new Date('2026-09-10T00:00:00.000Z');
    const candidat: CandidatAbsence = {
      id: ENROLLMENT_ID,
      organization_id: ORG_ID,
      contact_id: CONTACT_ID,
      campaign_id: CAMPAIGN_ID,
      current_step: 1,
      resume_at: resumeAt,
    };
    const { pool, appels } = creerPoolAbsence(
      [candidat],
      { status: 'paused_absence', next_action_at: resumeAt, current_step: 1 },
      { etape: { id: STEP_ID_ABSENCE, delay_hours: 24 } },
    );

    await reprendreAbsencesEchues(pool, new Date('2026-09-15T10:00:00.000Z'));

    const journal = appels.find((a) => /insert into audit_events/i.test(a.sql));
    expect(journal).toBeDefined();
    expect(String(journal!.values)).toMatch(/enrollment_resumed/);
    expect(String(journal!.values)).toContain(ORG_ID);
    expect(String(journal!.values)).toContain(CONTACT_ID);
  });

  it('étape supprimée pendant la pause (repli) : next_action_at reste rattrapable, jamais null pour toujours', async () => {
    const resumeAt = new Date('2026-09-10T00:00:00.000Z');
    const candidat: CandidatAbsence = {
      id: ENROLLMENT_ID,
      organization_id: ORG_ID,
      contact_id: CONTACT_ID,
      campaign_id: CAMPAIGN_ID,
      current_step: 5, // rang qui n'existe plus dans sequence_steps
      resume_at: resumeAt,
    };
    // Ni `etape` ni `actionBloquee` fournis : la séquence a perdu ce rang,
    // `poserEcheanceDepuisDispatch` et le rejeu d'action ne peuvent rien
    // écrire (aucune ligne trouvée par leurs deux lectures respectives).
    const { pool, etat } = creerPoolAbsence([candidat], {
      status: 'paused_absence',
      next_action_at: resumeAt,
      current_step: 5,
    });

    await reprendreAbsencesEchues(pool, new Date('2026-09-15T10:00:00.000Z'));

    // Sans repli, `next_action_at` resterait `null` (posé par l'activation) :
    // invisible du tick (`next_action_at <= now` exclut NULL) et de
    // `rattraperEcheancesManquantes` (même lecture d'étape, même échec).
    expect(etat().next_action_at).not.toBeNull();
    expect(etat().status).toBe('active');
  });

  it('aucune candidate (requête vide) : rien d’autre interrogé', async () => {
    const { pool, appels } = creerPoolFactice([{ motif: ABSENCE_CANDIDATS, repondre: () => ligne([]) }]);

    await reprendreAbsencesEchues(pool);

    expect(appels).toHaveLength(1);
  });

  it('campagne archivée pendant l’absence (F14, mineur) : l’inscription reste paused_absence, aucune reprise', async () => {
    const resumeAt = new Date('2026-09-10T00:00:00.000Z');
    const candidat: CandidatAbsence = {
      id: ENROLLMENT_ID,
      organization_id: ORG_ID,
      contact_id: CONTACT_ID,
      campaign_id: CAMPAIGN_ID,
      current_step: 1,
      resume_at: resumeAt,
      campaignStatus: 'archived',
    };
    const { pool, appels, etat } = creerPoolAbsence(
      [candidat],
      { status: 'paused_absence', next_action_at: resumeAt, current_step: 1 },
      { etape: { id: STEP_ID_ABSENCE, delay_hours: 24 } },
    );

    await reprendreAbsencesEchues(pool, new Date('2026-09-15T10:00:00.000Z'));

    // La campagne n'est plus active : la candidate n'est même pas sélectionnée
    // par la requête (filtrée en SQL) — aucune activation, aucune pose
    // d'échéance, aucun journal, l'inscription reste telle quelle.
    expect(etat().status).toBe('paused_absence');
    expect(appels.some((a) => /update enrollments\s+set status = 'active'/i.test(a.sql))).toBe(false);
    expect(appels.some((a) => /insert into audit_events/i.test(a.sql))).toBe(false);
  });
});
