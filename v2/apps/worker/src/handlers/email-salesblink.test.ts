import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { ErreurSalesBlink } from '@jay-reach/providers/outreach';
import { envoyerEmailSalesBlink, assurerObjetsEtape, heuresEnvoiSalesBlink, type ClientSalesBlink } from './email-salesblink.js';
import type { DispatchJob } from './dispatch.js';

const ORG_ID = 'org-1';
const ACTION_ID = 'action-1';
const ENROLLMENT_ID = 'enrollment-1';
const CAMPAIGN_ID = 'campagne-1';
const STEP_ID = 'etape-1';
const SENDER_ID = 'sender-1';

/** Ligne complète de `chargerLigneInscription`, avec des defauts neutres. */
function ligneInscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ENROLLMENT_ID,
    organization_id: ORG_ID,
    campaign_id: CAMPAIGN_ID,
    contact_id: 'contact-1',
    signal_id: null,
    current_step: 1,
    linkedin_url: null,
    email: 'contact@exemple.fr',
    email_status: 'valid',
    account_id: null,
    persona_id: null,
    approval_policy: {},
    sending_paused_at: null,
    lk_mode: null,
    first_name: 'Marie',
    last_name: 'Durand',
    company_name: 'Acme',
    domain: 'acme.fr',
    locale: null,
    job_title: 'Directrice',
    city: 'Lyon',
    headcount: 20,
    persona_angle: null,
    signal_title: null,
    signal_occurred_at: null,
    signal_location: null,
    signal_url: null,
    postal_code: '69000',
    country: 'FR',
    context_note: null,
    ...overrides,
  };
}

function jobEmail(overrides: Partial<NonNullable<DispatchJob['email']>> = {}): DispatchJob {
  return {
    organizationId: ORG_ID,
    channel: 'email',
    actionId: ACTION_ID,
    email: {
      enrollmentId: ENROLLMENT_ID,
      contactId: 'contact-1',
      stepId: STEP_ID,
      campaignId: CAMPAIGN_ID,
      templateParentId: 'gabarit-famille-1',
      senderId: SENDER_ID,
      locale: null,
      ...overrides,
    },
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

function clientFactice(overrides: Partial<ClientSalesBlink> = {}): ClientSalesBlink {
  return {
    creerGabaritNeutre: vi.fn(async () => 'gabarit-neutre-1'),
    creerListe: vi.fn(async () => 'liste-1'),
    creerSequenceEtape: vi.fn(async () => 'sequence-1'),
    activerEtPlanifier: vi.fn(async () => undefined),
    pousserLeads: vi.fn(async () => undefined),
    repondreDansLeFil: vi.fn(async () => ({ idTache: 'tache-reponse-1' })),
    ...overrides,
  };
}

// Motifs de requetes communs a plusieurs scenarios.
const ETAT_ACTION = /select status from actions where id/i;
const INSCRIPTION_ACTIVE = /select en\.status, c\.email from enrollments en/i;
const SUPPRESSION_CHECK = /from suppressions/i;
const CONFIG_CREDENTIALS = /select config from credentials/i;
const SENDER = /from senders where id/i;
const CONTRAINTES_SENDER = /from senders s where s\.id/i;
const PLAFOND = /daily_cap/i;
const CREDIT = /consume_provider_credit/i;
// Spécifique a `chargerLigneInscription` (message-values.ts) : la jointure
// jusqu'a `campaigns camp` la distingue de la requete de defense en profondeur
// C1 ci-dessus, qui interroge aussi `enrollments`/`contacts` mais pas `campaigns`.
const INSCRIPTION = /join campaigns camp/i;
const TEMPLATE = /from message_templates/i;
const ENVOIS_ANTERIEURS = /payload ->> 'message_id'/i;
const MODE_FORCE = /select payload ->> 'mode_force'/i;
const BINDING_SELECT = /select sequence_id, list_id from email_transport_bindings/i;
const BINDING_INSERT = /insert into email_transport_bindings/i;
const GABARIT_NEUTRE_LOOKUP = /select template_id from email_transport_bindings/i;
const CAMPAGNE_NOM = /select name from campaigns/i;
const ETAPE_POSITION = /from sequence_steps/i;
const MARK_DISPATCHED = /mark_action_dispatched/i;
const UPDATE_SUCCES = /update actions set provider_ref/i;
const UPDATE_BLOQUE = /status = 'blocked'/i;
const UPDATE_ECHEC = /status = 'failed'/i;
const UPDATE_SKIPPED = /status = 'skipped'/i;
const UPDATE_ESSAIS = /jsonb_build_object\('essais'/i;
const SELECT_ESSAIS = /payload ->> 'essais'/i;
const THREAD_LOOKUP = /select id from threads where/i;
const THREAD_MESSAGE_INSERT = /insert into thread_messages/i;
const THREAD_UPDATE = /update threads set last_message_at/i;

/** Gestionnaires par defaut du chemin heureux, partages par plusieurs tests. */
function gestionnairesBase(): Gestionnaire[] {
  return [
    { motif: ETAT_ACTION, repondre: () => ligne([{ status: 'scheduled' }]) },
    { motif: INSCRIPTION_ACTIVE, repondre: () => ligne([{ status: 'active', email: 'contact@exemple.fr' }]) },
    { motif: SUPPRESSION_CHECK, repondre: () => ligne([{ n: 0 }]) },
    { motif: CONFIG_CREDENTIALS, repondre: () => ligne([{ config: {} }]) },
    {
      motif: SENDER,
      repondre: () =>
        ligne([
          {
            id: SENDER_ID,
            identity: 'expediteur@exemple.fr',
            provider_ref: 'sb-sender-1',
            provider_state: { sending_enabled: true },
            timezone: 'Europe/Paris',
            business_hours: null,
          },
        ]),
    },
    {
      motif: CONTRAINTES_SENDER,
      repondre: () =>
        ligne([
          { daily_quota: null, hourly_quota: null, timezone: 'Europe/Paris', business_hours: null, used_today: 0, used_this_hour: 0 },
        ]),
    },
    { motif: PLAFOND, repondre: () => ligne([]) },
    { motif: CREDIT, repondre: () => ligne([{ ok: true }]) },
    { motif: INSCRIPTION, repondre: () => ligne([ligneInscription()]) },
    {
      motif: TEMPLATE,
      repondre: () => ligne([{ id: 'gabarit-1', body: 'Bonjour {{prenom}}', subject: 'Objet {{prenom}}', name: 'Gabarit' }]),
    },
    { motif: ENVOIS_ANTERIEURS, repondre: () => ligne([]) },
    { motif: MODE_FORCE, repondre: () => ligne([{ mode_force: null }]) },
    { motif: GABARIT_NEUTRE_LOOKUP, repondre: () => ligne([]) },
    { motif: MARK_DISPATCHED, repondre: () => ligne([{}]) },
    { motif: UPDATE_SUCCES, repondre: () => ligne([]) },
    { motif: THREAD_LOOKUP, repondre: () => ligne([{ id: 'fil-1' }]) },
    { motif: THREAD_MESSAGE_INSERT, repondre: () => ligne([]) },
    { motif: THREAD_UPDATE, repondre: () => ligne([]) },
  ];
}

/**
 * Combine des gestionnaires propres à un test avec le socle par défaut — les
 * premiers gagnent (premier motif qui matche dans `creerPoolFactice`), ce qui
 * permet de surcharger un motif déjà présent dans `gestionnairesBase()`.
 */
function avecBase(...specifiques: Gestionnaire[]): Gestionnaire[] {
  return [...specifiques, ...gestionnairesBase()];
}

beforeEach(() => {
  process.env.SALESBLINK_API_KEY = 'cle-de-test';
});

afterEach(() => {
  delete process.env.SALESBLINK_API_KEY;
  vi.restoreAllMocks();
});

describe('envoyerEmailSalesBlink', () => {
  it('sans provider_ref l’action est bloquée sender_unbound', async () => {
    const { pool, appels } = creerPoolFactice([
      { motif: ETAT_ACTION, repondre: () => ligne([{ status: 'scheduled' }]) },
      { motif: INSCRIPTION_ACTIVE, repondre: () => ligne([{ status: 'active', email: 'contact@exemple.fr' }]) },
      { motif: SUPPRESSION_CHECK, repondre: () => ligne([{ n: 0 }]) },
      { motif: CONFIG_CREDENTIALS, repondre: () => ligne([]) },
      {
        motif: SENDER,
        repondre: () =>
          ligne([
            {
              id: SENDER_ID,
              identity: 'expediteur@exemple.fr',
              provider_ref: null,
              provider_state: null,
              timezone: 'Europe/Paris',
              business_hours: null,
            },
          ]),
      },
      { motif: UPDATE_BLOQUE, repondre: () => ligne([]) },
    ]);
    const client = clientFactice();

    await envoyerEmailSalesBlink({ pool }, jobEmail(), client);

    const blocage = appels.find((a) => UPDATE_BLOQUE.test(a.sql));
    expect(blocage).toBeDefined();
    expect(blocage!.values[0]).toBe(ACTION_ID);
    expect(blocage!.values[1]).toBe('sender_unbound');
    // Aucun appel SalesBlink ne doit avoir eu lieu : bloqué avant tout envoi.
    expect(client.creerListe).not.toHaveBeenCalled();
    expect(client.pousserLeads).not.toHaveBeenCalled();
  });

  it('inscription non active (rejeu/course) : action ignorée sans aucun appel client (C1)', async () => {
    const { pool, appels } = creerPoolFactice([
      { motif: ETAT_ACTION, repondre: () => ligne([{ status: 'scheduled' }]) },
      { motif: INSCRIPTION_ACTIVE, repondre: () => ligne([{ status: 'replied', email: 'contact@exemple.fr' }]) },
      { motif: UPDATE_SKIPPED, repondre: () => ligne([]) },
    ]);
    const client = clientFactice();

    await envoyerEmailSalesBlink({ pool }, jobEmail(), client);

    const skip = appels.find((a) => UPDATE_SKIPPED.test(a.sql));
    expect(skip).toBeDefined();
    expect(skip!.values).toEqual([ACTION_ID, 'enrollment_inactive']);
    expect(client.creerListe).not.toHaveBeenCalled();
    expect(client.pousserLeads).not.toHaveBeenCalled();
    expect(client.repondreDansLeFil).not.toHaveBeenCalled();
  });

  it('adresse supprimée entre l’enfilement et l’exécution : action ignorée sans aucun appel client (C1)', async () => {
    const { pool, appels } = creerPoolFactice([
      { motif: ETAT_ACTION, repondre: () => ligne([{ status: 'scheduled' }]) },
      { motif: INSCRIPTION_ACTIVE, repondre: () => ligne([{ status: 'active', email: 'contact@exemple.fr' }]) },
      { motif: SUPPRESSION_CHECK, repondre: () => ligne([{ n: 1 }]) },
      { motif: UPDATE_SKIPPED, repondre: () => ligne([]) },
    ]);
    const client = clientFactice();

    await envoyerEmailSalesBlink({ pool }, jobEmail(), client);

    const skip = appels.find((a) => UPDATE_SKIPPED.test(a.sql));
    expect(skip).toBeDefined();
    expect(skip!.values).toEqual([ACTION_ID, 'suppressed']);
    expect(client.creerListe).not.toHaveBeenCalled();
    expect(client.pousserLeads).not.toHaveBeenCalled();
  });

  it('quota horaire/journalier de l’expéditeur épuisé : action laissée en attente, aucun appel client (I5)', async () => {
    const { pool, appels } = creerPoolFactice(
      avecBase({
        motif: CONTRAINTES_SENDER,
        repondre: () =>
          ligne([{ daily_quota: 10, hourly_quota: null, timezone: 'Europe/Paris', business_hours: null, used_today: 10, used_this_hour: 0 }]),
      }),
    );
    const client = clientFactice();

    await envoyerEmailSalesBlink({ pool }, jobEmail(), client);

    expect(appels.some((a) => CREDIT.test(a.sql))).toBe(false);
    expect(appels.some((a) => UPDATE_SUCCES.test(a.sql))).toBe(false);
    expect(appels.some((a) => UPDATE_BLOQUE.test(a.sql))).toBe(false);
    expect(client.creerListe).not.toHaveBeenCalled();
    expect(client.pousserLeads).not.toHaveBeenCalled();
  });

  it('le quota d’expéditeur compte les envois partis (dispatched/delivered), pas les créations (fix round 2)', async () => {
    const { pool, appels } = creerPoolFactice(
      // Chemin « relance » : évite `assurerObjetsEtape` (campagne/étape),
      // sans intérêt pour ce test — seul le texte de la requête de quota compte.
      avecBase({
        motif: ENVOIS_ANTERIEURS,
        repondre: () => ligne([{ message_id: 'msg-1', subject: 'Objet' }]),
      }),
    );

    await envoyerEmailSalesBlink({ pool }, jobEmail(), clientFactice());

    const requeteQuota = appels.find((a) => CONTRAINTES_SENDER.test(a.sql));
    expect(requeteQuota).toBeDefined();
    expect(requeteQuota!.sql).toMatch(/status in \('dispatched', 'delivered'\)/);
    expect(requeteQuota!.sql).toMatch(/dispatched_at >= date_trunc\('day', now\(\)\)/);
    expect(requeteQuota!.sql).toMatch(/dispatched_at >= date_trunc\('hour', now\(\)\)/);
    // Une action encore `scheduled` (pas encore partie) n'a pas `dispatched_at`
    // renseigné : elle ne peut donc jamais matcher ce filtre, contrairement au
    // filtre par `created_at` du tick (`loadSenders`), qui l'aurait comptée.
    expect(requeteQuota!.sql).not.toMatch(/created_at/);
  });

  it('premier email : crée liste et séquence puis pousse le lead avec jr_action_id', async () => {
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: BINDING_SELECT, repondre: () => ligne([]) },
        { motif: BINDING_INSERT, repondre: () => ligne([{ sequence_id: 'sequence-1', list_id: 'liste-1' }]) },
        { motif: CAMPAGNE_NOM, repondre: () => ligne([{ name: 'Campagne Test' }]) },
        { motif: ETAPE_POSITION, repondre: () => ligne([{ position: 0 }]) },
      ),
    );
    const client = clientFactice();

    await envoyerEmailSalesBlink({ pool }, jobEmail(), client);

    expect(client.creerListe).toHaveBeenCalledTimes(1);
    expect(client.creerSequenceEtape).toHaveBeenCalledTimes(1);
    // I2 : le nom de la séquence porte l'identité de l'expéditeur — pas
    // partagée entre deux expéditeurs de la même étape.
    const [parametresSequence] = (client.creerSequenceEtape as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { nom: string },
    ];
    expect(parametresSequence.nom).toContain('expediteur@exemple.fr');
    expect(client.activerEtPlanifier).toHaveBeenCalledWith('sequence-1', 'cle-de-test');
    expect(client.pousserLeads).toHaveBeenCalledTimes(1);
    const [listeId, leads] = (client.pousserLeads as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(listeId).toBe('liste-1');
    expect(leads).toEqual([
      expect.objectContaining({
        email: 'contact@exemple.fr',
        first_name: 'Marie',
        last_name: 'Durand',
        company_name: 'Acme',
        jr_subject: 'Objet Marie',
        jr_body: '<p>Bonjour Marie</p>',
        jr_action_id: ACTION_ID,
      }),
    ]);
    // I4 : le message sortant se pose dans le fil, corps en texte brut (pas le HTML).
    const filMessage = appels.find((a) => THREAD_MESSAGE_INSERT.test(a.sql));
    expect(filMessage).toBeDefined();
    expect(filMessage!.values[0]).toBe('fil-1');
    expect(filMessage!.values[1]).toBe('Bonjour Marie');
    const rawFil = JSON.parse(filMessage!.values[2] as string) as Record<string, unknown>;
    expect(rawFil.action_id).toBe(ACTION_ID);
    expect(rawFil.subject).toBe('Objet Marie');
    // fix round 2 : le fil est aussi retouché en last_message_at, même si
    // `assurerFil` (fil déjà existant) ne l'aurait pas fait tout seul.
    const filUpdate = appels.find((a) => THREAD_UPDATE.test(a.sql));
    expect(filUpdate).toBeDefined();
    expect(filUpdate!.values[0]).toBe('fil-1');
  });

  it('gabarit neutre réutilisé s’il existe déjà dans une liaison de l’organisation (minor)', async () => {
    const { pool } = creerPoolFactice(
      avecBase(
        { motif: BINDING_SELECT, repondre: () => ligne([]) },
        { motif: BINDING_INSERT, repondre: () => ligne([{ sequence_id: 'sequence-1', list_id: 'liste-1' }]) },
        { motif: CAMPAGNE_NOM, repondre: () => ligne([{ name: 'Campagne Test' }]) },
        { motif: ETAPE_POSITION, repondre: () => ligne([{ position: 0 }]) },
        { motif: GABARIT_NEUTRE_LOOKUP, repondre: () => ligne([{ template_id: 'gabarit-existant-1' }]) },
      ),
    );
    const client = clientFactice();

    await envoyerEmailSalesBlink({ pool }, jobEmail(), client);

    expect(client.creerGabaritNeutre).not.toHaveBeenCalled();
    const [parametresSequence] = (client.creerSequenceEtape as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { idGabarit: string },
    ];
    expect(parametresSequence.idGabarit).toBe('gabarit-existant-1');
  });

  describe('assurerObjetsEtape (I2)', () => {
    it('deux expéditeurs de la même étape obtiennent chacun leur séquence et leur liste', async () => {
      let compteur = 0;
      const query = vi.fn(async (sql: string, values: unknown[] = []) => {
        if (BINDING_SELECT.test(sql)) return ligne([]);
        if (BINDING_INSERT.test(sql)) {
          const parametres = values as unknown[];
          return ligne([{ sequence_id: parametres[4], list_id: parametres[5] }]);
        }
        if (GABARIT_NEUTRE_LOOKUP.test(sql)) return ligne([]);
        if (CAMPAGNE_NOM.test(sql)) return ligne([{ name: 'Campagne Test' }]);
        if (ETAPE_POSITION.test(sql)) return ligne([{ position: 0 }]);
        throw new Error(`requete non prevue par le test :\n${sql}`);
      });
      const pool = { query } as unknown as Pool;
      const client = clientFactice({
        creerListe: vi.fn(async () => `liste-${++compteur}`),
        creerSequenceEtape: vi.fn(async () => `sequence-${compteur}`),
      });

      const objetsA = await assurerObjetsEtape(
        pool,
        ORG_ID,
        CAMPAIGN_ID,
        STEP_ID,
        { id: 'sender-a', identity: 'a@exemple.fr', providerRef: 'sb-a', timezone: null, businessHours: null },
        'cle-de-test',
        client,
      );
      const objetsB = await assurerObjetsEtape(
        pool,
        ORG_ID,
        CAMPAIGN_ID,
        STEP_ID,
        { id: 'sender-b', identity: 'b@exemple.fr', providerRef: 'sb-b', timezone: null, businessHours: null },
        'cle-de-test',
        client,
      );

      expect(objetsA).not.toEqual(objetsB);
      expect(client.creerSequenceEtape).toHaveBeenCalledTimes(2);
      const noms = (client.creerSequenceEtape as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => (c[0] as { nom: string }).nom,
      );
      expect(noms[0]).toContain('a@exemple.fr');
      expect(noms[1]).toContain('b@exemple.fr');
      expect(noms[0]).not.toBe(noms[1]);
    });
  });

  it('relance : appelle repondreDansLeFil avec le dernier message_id', async () => {
    const { pool, appels } = creerPoolFactice(
      avecBase({
        motif: ENVOIS_ANTERIEURS,
        repondre: () =>
          ligne([
            { message_id: 'msg-ancien', subject: 'Premier objet' },
            { message_id: 'msg-recent', subject: 'Second objet' },
          ]),
      }),
    );
    const client = clientFactice();

    await envoyerEmailSalesBlink({ pool }, jobEmail(), client);

    expect(client.repondreDansLeFil).toHaveBeenCalledTimes(1);
    expect(client.repondreDansLeFil).toHaveBeenCalledWith('msg-recent', '<p>Bonjour Marie</p>', 'cle-de-test');
    expect(client.creerListe).not.toHaveBeenCalled();
    expect(client.pousserLeads).not.toHaveBeenCalled();

    const succes = appels.find((a) => UPDATE_SUCCES.test(a.sql));
    expect(succes).toBeDefined();
    const payload = JSON.parse(succes!.values[2] as string) as Record<string, unknown>;
    expect(payload.mode).toBe('relance');
    expect(payload.reply_task_id).toBe('tache-reponse-1');
  });

  it('429 : l’action reste en attente et essais vaut 1', async () => {
    const client = clientFactice({
      creerListe: vi.fn(async () => {
        throw new ErreurSalesBlink('limite', 429, 'Trop de requetes');
      }),
    });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: BINDING_SELECT, repondre: () => ligne([]) },
        { motif: CAMPAGNE_NOM, repondre: () => ligne([{ name: 'Campagne Test' }]) },
        { motif: ETAPE_POSITION, repondre: () => ligne([{ position: 0 }]) },
        { motif: SELECT_ESSAIS, repondre: () => ligne([{ essais: null }]) },
        { motif: UPDATE_ESSAIS, repondre: () => ligne([]) },
      ),
    );

    await envoyerEmailSalesBlink({ pool }, jobEmail(), client);

    const retry = appels.find((a) => UPDATE_ESSAIS.test(a.sql));
    expect(retry).toBeDefined();
    expect(retry!.values).toEqual([ACTION_ID, 1]);
    // L'action ne doit pas etre marquee bloquee ni echouee : elle reste pending.
    expect(appels.some((a) => UPDATE_BLOQUE.test(a.sql))).toBe(false);
    expect(appels.some((a) => UPDATE_ECHEC.test(a.sql))).toBe(false);
  });

  it('une action déjà dispatched est ignorée (rejeu ou job concurrent)', async () => {
    const { pool, appels } = creerPoolFactice([{ motif: ETAT_ACTION, repondre: () => ligne([{ status: 'dispatched' }]) }]);
    const client = clientFactice();

    await envoyerEmailSalesBlink({ pool }, jobEmail(), client);

    // Rien d'autre n'a ete tente : ni resolution de credentials, ni envoi.
    expect(appels).toHaveLength(1);
    expect(appels[0]!.sql).toMatch(ETAT_ACTION);
    expect(client.creerListe).not.toHaveBeenCalled();
    expect(client.pousserLeads).not.toHaveBeenCalled();
    expect(client.repondreDansLeFil).not.toHaveBeenCalled();
  });

  it('une action déjà bloquée est ignorée (rejeu ou job concurrent)', async () => {
    const { pool, appels } = creerPoolFactice([{ motif: ETAT_ACTION, repondre: () => ligne([{ status: 'blocked' }]) }]);

    await envoyerEmailSalesBlink({ pool }, jobEmail(), clientFactice());

    expect(appels).toHaveLength(1);
  });

  it('une étape sans gabarit ne consomme pas de crédit', async () => {
    const { pool, appels } = creerPoolFactice(avecBase({ motif: UPDATE_BLOQUE, repondre: () => ligne([]) }));
    const client = clientFactice();

    await envoyerEmailSalesBlink({ pool }, jobEmail({ templateParentId: null }), client);

    const blocage = appels.find((a) => UPDATE_BLOQUE.test(a.sql));
    expect(blocage).toBeDefined();
    expect(blocage!.values[1]).toBe('missing_template');
    // Bloqué avant le plafond : aucun crédit n'a été consommé pour un envoi
    // qui n'aura jamais lieu.
    expect(appels.some((a) => CREDIT.test(a.sql))).toBe(false);
    expect(client.creerListe).not.toHaveBeenCalled();
  });

  it('mode_force = relance_repli force le repli et retire mode_force du payload', async () => {
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: MODE_FORCE, repondre: () => ligne([{ mode_force: 'relance_repli' }]) },
        {
          motif: ENVOIS_ANTERIEURS,
          repondre: () => ligne([{ message_id: null, subject: 'Sujet original' }]),
        },
        {
          motif: BINDING_SELECT,
          repondre: () => ligne([{ sequence_id: 'sequence-existante', list_id: 'liste-existante' }]),
        },
      ),
    );
    const client = clientFactice();

    await envoyerEmailSalesBlink({ pool }, jobEmail(), client);

    expect(client.pousserLeads).toHaveBeenCalledTimes(1);
    const [, leads] = (client.pousserLeads as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>[]];
    expect(leads[0]?.jr_subject).toBe('Re: Sujet original');

    const succes = appels.find((a) => UPDATE_SUCCES.test(a.sql));
    expect(succes).toBeDefined();
    // La requete retire explicitement `mode_force` du payload existant.
    expect(succes!.sql).toContain(`- 'mode_force'`);
    const payload = JSON.parse(succes!.values[2] as string) as Record<string, unknown>;
    expect(payload.mode).toBe('relance_repli');
    expect(payload.subject).toBe('Re: Sujet original');
  });
});

describe('heuresEnvoiSalesBlink', () => {
  it('valeur nulle : lundi-vendredi 9h-18h', () => {
    expect(heuresEnvoiSalesBlink(null)).toEqual([
      { name: 'Monday', enabled: true, fromTime: '09:00', toTime: '18:00' },
      { name: 'Tuesday', enabled: true, fromTime: '09:00', toTime: '18:00' },
      { name: 'Wednesday', enabled: true, fromTime: '09:00', toTime: '18:00' },
      { name: 'Thursday', enabled: true, fromTime: '09:00', toTime: '18:00' },
      { name: 'Friday', enabled: true, fromTime: '09:00', toTime: '18:00' },
      { name: 'Saturday', enabled: false, fromTime: '09:00', toTime: '18:00' },
      { name: 'Sunday', enabled: false, fromTime: '09:00', toTime: '18:00' },
    ]);
  });

  it('heures personnalisees : jours et plage respectes', () => {
    const heures = heuresEnvoiSalesBlink({ startHour: 8, endHour: 20, days: [6, 7] });
    expect(heures.find((h) => h.name === 'Saturday')).toEqual({
      name: 'Saturday',
      enabled: true,
      fromTime: '08:00',
      toTime: '20:00',
    });
    expect(heures.find((h) => h.name === 'Monday')?.enabled).toBe(false);
  });

  it('startHour/endHour hors 0-23 sont bornés (minor)', () => {
    const heures = heuresEnvoiSalesBlink({ startHour: -3, endHour: 25, days: [1] });
    const lundi = heures.find((h) => h.name === 'Monday');
    expect(lundi?.fromTime).toBe('00:00');
    expect(lundi?.toTime).toBe('23:00');
  });

  it('endHour <= startHour retombe sur le défaut 09-18 (minor)', () => {
    const heures = heuresEnvoiSalesBlink({ startHour: 18, endHour: 9, days: [1] });
    const lundi = heures.find((h) => h.name === 'Monday');
    expect(lundi?.fromTime).toBe('09:00');
    expect(lundi?.toTime).toBe('18:00');
  });
});
