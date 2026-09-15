import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { ErreurSalesBlink, PAGES_MAX_PAR_DEFAUT, TAILLE_PAGE_RAPPORTS } from '@jay-reach/providers/outreach';
import type { EnvoiSorti, Rapport, SanteBoite } from '@jay-reach/providers/outreach';
import { deterministicUuid, currentBucket } from '../ids.js';
import {
  releverSalesBlink,
  enqueueReleveSalesBlink,
  FENETRE_RELEVE_MAX_MS,
  RETARD_SECURITE_MS,
  type ClientReleveSalesBlink,
} from './releve-salesblink.js';

const ORG_ID = 'org-1';

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

function santeSaine(): SanteBoite {
  return { connectee: true, envoiActif: true, receptionActive: true, sante: 100, derniereErreur: null };
}

function clientFactice(overrides: Partial<ClientReleveSalesBlink> = {}): ClientReleveSalesBlink {
  return {
    listerEnvoisSortis: vi.fn(async () => [] as EnvoiSorti[]),
    listerReponses: vi.fn(async () => [] as Rapport[]),
    listerRapports: vi.fn(async () => [] as Rapport[]),
    listerTachesReponse: vi.fn(async () => ({ taches: [] as EnvoiSorti[], sature: false })),
    santeBoite: vi.fn(async () => santeSaine()),
    reconnecterBoite: vi.fn(async () => undefined),
    replanifier: vi.fn(async () => undefined),
    ...overrides,
  };
}

// Motifs de requetes communs a plusieurs scenarios.
const CONFIG_CREDENTIALS = /select config from credentials/i;
const CURSEUR_SELECT = /select cursor_ms, last_error from provider_sync_state/i;
const CURSEUR_UPSERT = /insert into provider_sync_state/i;
const SENDERS_SELECT = /select id, identity, provider_ref, provider_state from senders/i;
const SENDERS_UPDATE = /update senders set provider_state/i;
const MAJ_LIVREE_SEQUENCE = /update actions set status = 'delivered'[\s\S]*sequence_id/i;
const MAJ_LIVREE_REPLY = /update actions set status = 'delivered'[\s\S]*reply_task_id/i;
const LOOKUP_ERREUR_SEQUENCE = /payload ->> 'essais'[\s\S]*sequence_id/i;
const LOOKUP_ERREUR_REPLY = /payload ->> 'essais'[\s\S]*reply_task_id/i;
const REMETTRE_EN_ATTENTE = /update actions set status = 'scheduled'/i;
const BINDING_REPLANIFIE = /update email_transport_bindings set last_replanned_at/i;
const MAJ_PROVIDER_MESSAGE_ID = /update thread_messages set provider_message_id/i;
const CONTACT_LOOKUP = /select id from contacts where/i;
const SUPPRESSION_INSERT = /insert into suppressions/i;
const ENROLLMENT_UPDATE = /update enrollments[\s\S]*set status/i;
const NOTIFICATIONS_INSERT = /insert into notifications/i;
const DEDUP_LOOKUP = /select m\.id from thread_messages/i;
const THREAD_SELECT = /select id from threads where/i;
const THREAD_INSERT = /insert into threads/i;
const THREAD_MESSAGE_INSERT = /insert into thread_messages/i;
const OUTCOME_INSERT = /insert into outcomes/i;

/** Gestionnaires par defaut : chemin neutre, aucune ligne nulle part. */
function gestionnairesBase(): Gestionnaire[] {
  return [
    { motif: CONFIG_CREDENTIALS, repondre: () => ligne([{ config: {} }]) },
    { motif: CURSEUR_SELECT, repondre: () => ligne([]) },
    { motif: SENDERS_SELECT, repondre: () => ligne([]) },
    { motif: CURSEUR_UPSERT, repondre: () => ligne([]) },
  ];
}

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

describe('releverSalesBlink', () => {
  it('sans clé SalesBlink configurée, la relève est ignorée', async () => {
    delete process.env.SALESBLINK_API_KEY;
    const { pool } = creerPoolFactice([{ motif: CONFIG_CREDENTIALS, repondre: () => ligne([{ config: {} }]) }]);
    const client = clientFactice();

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    expect(client.listerEnvoisSortis).not.toHaveBeenCalled();
  });

  it('un envoi terminé marque l’action delivered et pose message_id', async () => {
    const envoi: EnvoiSorti = {
      id: 'envoi-1',
      messageId: 'msg-1',
      email: 'marie@exemple.fr',
      sequenceId: 'seq-1',
      termine: true,
      termineMs: 2000,
      planifieMs: 1500,
      typeTache: 'email',
      corpsHtml: null,
      sujet: null,
      deSoi: false,
      destinataire: null,
      references: [],
    };
    const client = clientFactice({ listerEnvoisSortis: vi.fn(async () => [envoi]) });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: MAJ_LIVREE_SEQUENCE, repondre: () => ligne([{ id: 'action-livree-1' }]) },
        { motif: MAJ_PROVIDER_MESSAGE_ID, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const maj = appels.find((a) => MAJ_LIVREE_SEQUENCE.test(a.sql));
    expect(maj).toBeDefined();
    expect(maj!.values).toEqual([ORG_ID, 'msg-1', new Date(2000).toISOString(), 'seq-1', 'marie@exemple.fr']);
    // I4 : provider_message_id se pose sur le fil, rattaché par l'action livrée.
    const filMaj = appels.find((a) => MAJ_PROVIDER_MESSAGE_ID.test(a.sql));
    expect(filMaj).toBeDefined();
    expect(filMaj!.values).toEqual(['action-livree-1', 'msg-1']);
    // Fenêtre non saturée : last_error reste null.
    const curseur = appels.find((a) => CURSEUR_UPSERT.test(a.sql));
    expect(curseur!.values[3]).toBeNull();
  });

  it('un rapport Bounced ouvre une suppression et arrête l’inscription (rebond)', async () => {
    const rapport: Rapport = {
      id: 'r1',
      horodatageMs: 4242,
      type: 'log',
      message: 'Bounced',
      email: 'marie@exemple.fr',
      sequenceId: null,
      corps: null,
    };
    const client = clientFactice({
      listerRapports: vi.fn(async (p: { message: string }) => (p.message === 'Bounced' ? [rapport] : [])),
    });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: CURSEUR_SELECT, repondre: () => ligne([{ cursor_ms: 100 }]) },
        { motif: CONTACT_LOOKUP, repondre: () => ligne([{ id: 'contact-1' }]) },
        { motif: SUPPRESSION_INSERT, repondre: () => ligne([]) },
        { motif: ENROLLMENT_UPDATE, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    expect(appels.some((a) => SUPPRESSION_INSERT.test(a.sql))).toBe(true);
    const maj = appels.find((a) => ENROLLMENT_UPDATE.test(a.sql));
    expect(maj).toBeDefined();
    expect(maj!.values[2]).toBe('bounced');
    // Le curseur avance à la fin de la fenêtre traitée (départ 100 + une
    // heure), pas au max des horodatages des événements (4242 + 1) : un flux
    // plus lent ne doit jamais être sauté par un curseur déjà passé plus loin.
    const curseur = appels.find((a) => CURSEUR_UPSERT.test(a.sql));
    expect(curseur!.values[2]).toBe(100 + FENETRE_RELEVE_MAX_MS);
    expect(curseur!.values[3]).toBeNull();
  });

  it('un envoi terminé après la fin de la fenêtre n’avance pas le curseur au-delà de jusqua (I1)', async () => {
    const jusqua = 100 + FENETRE_RELEVE_MAX_MS;
    const envoi: EnvoiSorti = {
      id: 'envoi-tardif',
      messageId: 'msg-tardif',
      email: 'marie@exemple.fr',
      sequenceId: 'seq-1',
      termine: true,
      // Au-delà de la fenêtre traitée : mesuré le 11/09, `completed_time` d'un
      // envoi peut tomber après la fin de la fenêtre demandée à l'API, qui ne
      // le documente même pas comme filtre. Avant le correctif, le curseur
      // aurait sauté ici jusqu'à `jusqua + 500000`.
      termineMs: jusqua + 500_000,
      planifieMs: 50,
      typeTache: 'email',
      corpsHtml: null,
      sujet: null,
      deSoi: false,
      destinataire: null,
      references: [],
    };
    const client = clientFactice({ listerEnvoisSortis: vi.fn(async () => [envoi]) });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: CURSEUR_SELECT, repondre: () => ligne([{ cursor_ms: 100 }]) },
        { motif: MAJ_LIVREE_SEQUENCE, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const curseur = appels.find((a) => CURSEUR_UPSERT.test(a.sql));
    expect(curseur).toBeDefined();
    expect(curseur!.values[2]).toBe(jusqua);
  });

  it('fenêtre trop fraîche (< 2 min) : les flux datés sont sautés, tâches reply et santé tournent quand même', async () => {
    const curseurRecent = Date.now() - RETARD_SECURITE_MS / 2;
    const client = clientFactice();
    const { pool, appels } = creerPoolFactice([
      { motif: CONFIG_CREDENTIALS, repondre: () => ligne([{ config: {} }]) },
      { motif: CURSEUR_SELECT, repondre: () => ligne([{ cursor_ms: curseurRecent }]) },
      { motif: SENDERS_SELECT, repondre: () => ligne([]) },
      { motif: CURSEUR_UPSERT, repondre: () => ligne([]) },
    ]);

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    expect(client.listerEnvoisSortis).not.toHaveBeenCalled();
    expect(client.listerReponses).not.toHaveBeenCalled();
    expect(client.listerRapports).not.toHaveBeenCalled();
    expect(client.listerTachesReponse).toHaveBeenCalledTimes(1);
    const curseur = appels.find((a) => CURSEUR_UPSERT.test(a.sql));
    expect(curseur).toBeDefined();
    expect(curseur!.values[2]).toBe(curseurRecent);
    expect(curseur!.values[3]).toBeNull();
  });

  it('fenêtre trop fraîche : un last_error non résolu du passage précédent n’est pas effacé (minor)', async () => {
    const curseurRecent = Date.now() - RETARD_SECURITE_MS / 2;
    const client = clientFactice();
    const { pool, appels } = creerPoolFactice([
      { motif: CONFIG_CREDENTIALS, repondre: () => ligne([{ config: {} }]) },
      { motif: CURSEUR_SELECT, repondre: () => ligne([{ cursor_ms: curseurRecent, last_error: 'fenetre_saturee:envois' }]) },
      { motif: SENDERS_SELECT, repondre: () => ligne([]) },
      { motif: CURSEUR_UPSERT, repondre: () => ligne([]) },
    ]);

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const curseur = appels.find((a) => CURSEUR_UPSERT.test(a.sql));
    expect(curseur).toBeDefined();
    expect(curseur!.values[3]).toBe('fenetre_saturee:envois');
  });

  it('une fenêtre saturée sur un flux avance quand même le curseur mais pose last_error', async () => {
    const envoisSatures: EnvoiSorti[] = Array.from({ length: PAGES_MAX_PAR_DEFAUT * TAILLE_PAGE_RAPPORTS }, (_, i) => ({
      id: `envoi-${i}`,
      messageId: null,
      email: `x${i}@exemple.fr`,
      sequenceId: null,
      termine: false,
      termineMs: null,
      planifieMs: null,
      typeTache: 'reply',
      corpsHtml: null,
      sujet: null,
      deSoi: false,
      destinataire: null,
      references: [],
    }));
    const client = clientFactice({ listerEnvoisSortis: vi.fn(async () => envoisSatures) });
    const { pool, appels } = creerPoolFactice(avecBase());

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const curseur = appels.find((a) => CURSEUR_UPSERT.test(a.sql));
    expect(curseur).toBeDefined();
    expect(curseur!.values[3]).toBe('fenetre_saturee:envois');
  });

  it('une file de tâches reply saturée (totalCount) pose last_error (minor)', async () => {
    const client = clientFactice({
      listerTachesReponse: vi.fn(async () => ({ taches: [], sature: true })),
    });
    const { pool, appels } = creerPoolFactice(avecBase());

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const curseur = appels.find((a) => CURSEUR_UPSERT.test(a.sql));
    expect(curseur).toBeDefined();
    expect(curseur!.values[3]).toBe('fenetre_saturee:taches_reply');
  });

  it('une réponse sans email est ignorée par versEvenementsRepondus (aucun traitement)', async () => {
    const rapport: Rapport = {
      id: 'r-sans-email',
      horodatageMs: 999,
      type: 'reply',
      message: 'Replied',
      email: null,
      sequenceId: null,
      corps: 'Bonjour',
    };
    const client = clientFactice({ listerReponses: vi.fn(async () => [rapport]) });
    const { pool, appels } = creerPoolFactice(avecBase());

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    expect(appels.some((a) => CONTACT_LOOKUP.test(a.sql))).toBe(false);
  });

  it(
    'une réponse au corps vide (/replies) se complète avec le corps de la tâche /inbox correspondante ' +
      '(décision 1) : retenue par destinataire (adressée à notre expéditeur), en excluant notre propre ' +
      'relance même quand self ment (self=false sur les deux, vérifié le 14/09)',
    async () => {
      const rapport: Rapport = {
        id: 'r-repondu-1',
        horodatageMs: 3000,
        type: 'reply',
        message: 'Replied',
        email: 'prospect@exemple.test',
        sequenceId: 'seq-1',
        corps: '',
      };
      const tacheProspect: EnvoiSorti = {
        id: 'tache-prospect-1',
        messageId: 'msg-graph-1',
        email: 'PROSPECT@exemple.test',
        sequenceId: 'seq-1',
        termine: true,
        termineMs: null,
        planifieMs: 5000,
        typeTache: 'reply',
        corpsHtml: '<p>Merci pour votre message</p>',
        sujet: 'Re: Prise de contact',
        deSoi: false,
        // Adressée à NOTRE expéditeur : c'est la réponse du prospect.
        destinataire: 'expediteur@exemple.test',
        references: [],
      };
      const tacheRelanceASoi: EnvoiSorti = {
        id: 'tache-soi-1',
        messageId: null,
        email: 'prospect@exemple.test',
        sequenceId: 'seq-1',
        // termine: true, planifieMs récent : ne déclenche ni le repli pour
        // relance trop vieille ni une erreur, seulement le marquage livré de
        // l'étape 6 (MAJ_LIVREE_REPLY ci-dessous) — hors sujet pour ce test.
        termine: true,
        termineMs: null,
        planifieMs: Date.now(),
        typeTache: 'reply',
        corpsHtml: '<p>Notre relance</p>',
        sujet: 'Relance',
        // self=false ici aussi (mesuré le 14/09) : la garde !deSoi ne suffirait
        // pas seule à l'écarter. Adressée AU prospect (son propre email) :
        // c'est `destinataire` qui l'exclut.
        deSoi: false,
        destinataire: 'prospect@exemple.test',
        references: [],
      };
      const client = clientFactice({
        listerReponses: vi.fn(async () => [rapport]),
        listerTachesReponse: vi.fn(async () => ({ taches: [tacheProspect, tacheRelanceASoi], sature: false })),
      });
      const { pool, appels } = creerPoolFactice(
        avecBase(
          { motif: CONTACT_LOOKUP, repondre: () => ligne([{ id: 'contact-1' }]) },
          { motif: DEDUP_LOOKUP, repondre: () => ligne([]) },
          { motif: THREAD_SELECT, repondre: () => ligne([]) },
          { motif: THREAD_INSERT, repondre: () => ligne([{ id: 'thread-1' }]) },
          { motif: THREAD_MESSAGE_INSERT, repondre: () => ligne([]) },
          { motif: ENROLLMENT_UPDATE, repondre: () => ligne([]) },
          { motif: OUTCOME_INSERT, repondre: () => ligne([]) },
          { motif: NOTIFICATIONS_INSERT, repondre: () => ligne([]) },
          // Les deux tâches sont `termine: true` : l'étape 6 marque aussi
          // l'action de relance livrée, sans lien avec ce que ce test vérifie.
          { motif: MAJ_LIVREE_REPLY, repondre: () => ligne([]) },
          { motif: /update actions set status = 'skipped'/i, repondre: () => ligne([]) },
        ),
      );

      await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

      const insertionMessage = appels.find((a) => THREAD_MESSAGE_INSERT.test(a.sql));
      expect(insertionMessage).toBeDefined();
      // Rapprochement par email insensible à la casse + séquence, HTML converti
      // en texte : jamais la tâche self (nos propres relances).
      expect(insertionMessage!.values[1]).toBe('Merci pour votre message');
    },
  );

  it(
    "l'identifiant de la tâche /inbox appariée devient provider_message_id, " +
      "l'identifiant du journal /replies reste en en-tête (L14)",
    async () => {
      const rapport: Rapport = {
        id: 'r-repondu-id',
        horodatageMs: 3000,
        type: 'reply',
        message: 'Replied',
        email: 'prospect@exemple.test',
        sequenceId: 'seq-1',
        corps: '',
      };
      const tacheProspect: EnvoiSorti = {
        id: 'tache-prospect-id',
        messageId: 'inbox-msg-1',
        email: 'prospect@exemple.test',
        sequenceId: 'seq-1',
        termine: true,
        termineMs: null,
        planifieMs: 5000,
        typeTache: 'reply',
        corpsHtml: '<p>Merci pour votre message</p>',
        sujet: 'Re: Prise de contact',
        deSoi: false,
        destinataire: 'expediteur@exemple.test',
        references: [],
      };
      const client = clientFactice({
        listerReponses: vi.fn(async () => [rapport]),
        listerTachesReponse: vi.fn(async () => ({ taches: [tacheProspect], sature: false })),
      });
      const { pool, appels } = creerPoolFactice(
        avecBase(
          { motif: CONTACT_LOOKUP, repondre: () => ligne([{ id: 'contact-1' }]) },
          { motif: DEDUP_LOOKUP, repondre: () => ligne([]) },
          { motif: THREAD_SELECT, repondre: () => ligne([]) },
          { motif: THREAD_INSERT, repondre: () => ligne([{ id: 'thread-1' }]) },
          { motif: THREAD_MESSAGE_INSERT, repondre: () => ligne([]) },
          { motif: ENROLLMENT_UPDATE, repondre: () => ligne([]) },
          { motif: OUTCOME_INSERT, repondre: () => ligne([]) },
          { motif: NOTIFICATIONS_INSERT, repondre: () => ligne([]) },
          { motif: MAJ_LIVREE_REPLY, repondre: () => ligne([]) },
          { motif: MAJ_PROVIDER_MESSAGE_ID, repondre: () => ligne([]) },
          { motif: /update actions set status = 'skipped'/i, repondre: () => ligne([]) },
        ),
      );

      await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

      const insertionMessage = appels.find((a) => THREAD_MESSAGE_INSERT.test(a.sql));
      expect(insertionMessage).toBeDefined();
      expect(insertionMessage!.values[2]).toBe('inbox-msg-1');
      expect(JSON.parse(String(insertionMessage!.values[3]))).toEqual({
        subject: 'Re: Prise de contact',
        salesblink_reply_id: 'r-repondu-id',
        salesblink_inbox_message_id: 'inbox-msg-1',
      });
    },
  );

  it("sans tâche /inbox appariée, l'identifiant du journal reste le repli et l'en-tête de tâche est nulle", async () => {
    const rapport: Rapport = {
      id: 'r-repondu-sans-tache',
      horodatageMs: 3000,
      type: 'reply',
      message: 'Replied',
      email: 'prospect@exemple.test',
      sequenceId: 'seq-1',
      corps: '',
    };
    const client = clientFactice({
      listerReponses: vi.fn(async () => [rapport]),
      listerTachesReponse: vi.fn(async () => ({ taches: [], sature: false })),
    });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: CONTACT_LOOKUP, repondre: () => ligne([{ id: 'contact-1' }]) },
        { motif: DEDUP_LOOKUP, repondre: () => ligne([]) },
        { motif: THREAD_SELECT, repondre: () => ligne([]) },
        { motif: THREAD_INSERT, repondre: () => ligne([{ id: 'thread-1' }]) },
        { motif: THREAD_MESSAGE_INSERT, repondre: () => ligne([]) },
        { motif: ENROLLMENT_UPDATE, repondre: () => ligne([]) },
        { motif: OUTCOME_INSERT, repondre: () => ligne([]) },
        { motif: NOTIFICATIONS_INSERT, repondre: () => ligne([]) },
        { motif: /update actions set status = 'skipped'/i, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const insertionMessage = appels.find((a) => THREAD_MESSAGE_INSERT.test(a.sql));
    expect(insertionMessage!.values[2]).toBe('r-repondu-sans-tache');
    expect(JSON.parse(String(insertionMessage!.values[3]))).toEqual({
      subject: null,
      salesblink_reply_id: 'r-repondu-sans-tache',
      salesblink_inbox_message_id: null,
    });
  });

  it('plusieurs tâches /inbox correspondantes : la plus récente (planifieMs) l’emporte', async () => {
    const rapport: Rapport = {
      id: 'r-repondu-2',
      horodatageMs: 3000,
      type: 'reply',
      message: 'Replied',
      email: 'prospect@exemple.test',
      sequenceId: 'seq-1',
      corps: '',
    };
    const ancienne: EnvoiSorti = {
      id: 'tache-ancienne',
      messageId: null,
      email: 'prospect@exemple.test',
      sequenceId: 'seq-1',
      termine: true,
      termineMs: null,
      planifieMs: 1000,
      typeTache: 'reply',
      corpsHtml: '<p>Premier message</p>',
      sujet: null,
      deSoi: false,
      destinataire: 'expediteur@exemple.test',
      references: [],
    };
    const recente: EnvoiSorti = {
      id: 'tache-recente',
      messageId: null,
      email: 'prospect@exemple.test',
      sequenceId: 'seq-1',
      termine: true,
      termineMs: null,
      planifieMs: 6000,
      typeTache: 'reply',
      corpsHtml: '<p>Message le plus récent</p>',
      sujet: null,
      deSoi: false,
      destinataire: 'expediteur@exemple.test',
      references: [],
    };
    const client = clientFactice({
      listerReponses: vi.fn(async () => [rapport]),
      listerTachesReponse: vi.fn(async () => ({ taches: [ancienne, recente], sature: false })),
    });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: CONTACT_LOOKUP, repondre: () => ligne([{ id: 'contact-1' }]) },
        { motif: DEDUP_LOOKUP, repondre: () => ligne([]) },
        { motif: THREAD_SELECT, repondre: () => ligne([]) },
        { motif: THREAD_INSERT, repondre: () => ligne([{ id: 'thread-1' }]) },
        { motif: THREAD_MESSAGE_INSERT, repondre: () => ligne([]) },
        { motif: ENROLLMENT_UPDATE, repondre: () => ligne([]) },
        { motif: OUTCOME_INSERT, repondre: () => ligne([]) },
        { motif: NOTIFICATIONS_INSERT, repondre: () => ligne([]) },
        // Les deux tâches sont `termine: true` : l'étape 6 marque aussi
        // l'action de relance livrée, sans lien avec ce que ce test vérifie.
        { motif: MAJ_LIVREE_REPLY, repondre: () => ligne([]) },
        { motif: /update actions set status = 'skipped'/i, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const insertionMessage = appels.find((a) => THREAD_MESSAGE_INSERT.test(a.sql));
    expect(insertionMessage!.values[1]).toBe('Message le plus récent');
  });

  it(
    'deux réponses du même prospect dans un même passage : chacune récupère le bon corps, ' +
      'appariées par rang chronologique (revue du 14/09)',
    async () => {
      const rapportAncien: Rapport = {
        id: 'r-repondu-ancien',
        horodatageMs: 1000,
        type: 'reply',
        message: 'Replied',
        email: 'prospect@exemple.test',
        sequenceId: 'seq-1',
        corps: '',
      };
      const rapportRecent: Rapport = {
        id: 'r-repondu-recent',
        horodatageMs: 2000,
        type: 'reply',
        message: 'Replied',
        email: 'prospect@exemple.test',
        sequenceId: 'seq-1',
        corps: '',
      };
      const tacheAncienne: EnvoiSorti = {
        id: 'tache-ancienne-1',
        messageId: null,
        email: 'prospect@exemple.test',
        sequenceId: 'seq-1',
        termine: true,
        termineMs: null,
        planifieMs: 1500,
        typeTache: 'reply',
        corpsHtml: '<p>Premier message</p>',
        sujet: null,
        deSoi: false,
        destinataire: 'expediteur@exemple.test',
        references: [],
      };
      const tacheRecente: EnvoiSorti = {
        id: 'tache-recente-1',
        messageId: null,
        email: 'prospect@exemple.test',
        sequenceId: 'seq-1',
        termine: true,
        termineMs: null,
        planifieMs: 2500,
        typeTache: 'reply',
        corpsHtml: '<p>Second message</p>',
        sujet: null,
        deSoi: false,
        destinataire: 'expediteur@exemple.test',
        references: [],
      };
      const client = clientFactice({
        listerReponses: vi.fn(async () => [rapportAncien, rapportRecent]),
        listerTachesReponse: vi.fn(async () => ({ taches: [tacheAncienne, tacheRecente], sature: false })),
      });
      const { pool, appels } = creerPoolFactice(
        avecBase(
          { motif: CONTACT_LOOKUP, repondre: () => ligne([{ id: 'contact-1' }]) },
          { motif: DEDUP_LOOKUP, repondre: () => ligne([]) },
          { motif: THREAD_SELECT, repondre: () => ligne([]) },
          { motif: THREAD_INSERT, repondre: () => ligne([{ id: 'thread-1' }]) },
          { motif: THREAD_MESSAGE_INSERT, repondre: () => ligne([]) },
          { motif: ENROLLMENT_UPDATE, repondre: () => ligne([]) },
          { motif: OUTCOME_INSERT, repondre: () => ligne([]) },
          { motif: NOTIFICATIONS_INSERT, repondre: () => ligne([]) },
          { motif: MAJ_LIVREE_REPLY, repondre: () => ligne([]) },
          { motif: /update actions set status = 'skipped'/i, repondre: () => ligne([]) },
        ),
      );

      await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

      const insertions = appels.filter((a) => THREAD_MESSAGE_INSERT.test(a.sql));
      expect(insertions).toHaveLength(2);
      // Ordre respecté : la réponse la plus ancienne prend la tâche la plus
      // ancienne, la plus récente prend la plus récente — jamais l'inverse.
      expect(insertions[0]!.values[1]).toBe('Premier message');
      expect(insertions[1]!.values[1]).toBe('Second message');
    },
  );

  it(
    'deux réponses du même prospect et une seule tâche disponible : seule la plus récente ' +
      'reçoit le corps, l’autre reste vide et journalise un avertissement sans email ni corps',
    async () => {
      const rapportAncien: Rapport = {
        id: 'r-repondu-ancien-2',
        horodatageMs: 1000,
        type: 'reply',
        message: 'Replied',
        email: 'prospect@exemple.test',
        sequenceId: 'seq-1',
        corps: '',
      };
      const rapportRecent: Rapport = {
        id: 'r-repondu-recent-2',
        horodatageMs: 2000,
        type: 'reply',
        message: 'Replied',
        email: 'prospect@exemple.test',
        sequenceId: 'seq-1',
        corps: '',
      };
      const seuleTache: EnvoiSorti = {
        id: 'tache-seule',
        messageId: null,
        email: 'prospect@exemple.test',
        sequenceId: 'seq-1',
        termine: true,
        termineMs: null,
        planifieMs: 1500,
        typeTache: 'reply',
        corpsHtml: '<p>Seul message disponible</p>',
        sujet: null,
        deSoi: false,
        destinataire: 'expediteur@exemple.test',
        references: [],
      };
      const client = clientFactice({
        listerReponses: vi.fn(async () => [rapportAncien, rapportRecent]),
        listerTachesReponse: vi.fn(async () => ({ taches: [seuleTache], sature: false })),
      });
      const { pool, appels } = creerPoolFactice(
        avecBase(
          { motif: CONTACT_LOOKUP, repondre: () => ligne([{ id: 'contact-1' }]) },
          { motif: DEDUP_LOOKUP, repondre: () => ligne([]) },
          { motif: THREAD_SELECT, repondre: () => ligne([]) },
          { motif: THREAD_INSERT, repondre: () => ligne([{ id: 'thread-1' }]) },
          { motif: THREAD_MESSAGE_INSERT, repondre: () => ligne([]) },
          { motif: ENROLLMENT_UPDATE, repondre: () => ligne([]) },
          { motif: OUTCOME_INSERT, repondre: () => ligne([]) },
          { motif: NOTIFICATIONS_INSERT, repondre: () => ligne([]) },
          { motif: MAJ_LIVREE_REPLY, repondre: () => ligne([]) },
          { motif: /update actions set status = 'skipped'/i, repondre: () => ligne([]) },
        ),
      );
      const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

      const insertions = appels.filter((a) => THREAD_MESSAGE_INSERT.test(a.sql));
      expect(insertions).toHaveLength(2);
      expect(insertions[0]!.values[1]).toBe('');
      expect(insertions[1]!.values[1]).toBe('Seul message disponible');
      // L'avertissement nomme l'identifiant de la réponse restée sans corps,
      // jamais son email ni un corps (même vide, rien à propos du contenu).
      const messagesAvertissement = avertissement.mock.calls.map((appel) => String(appel[0]));
      expect(messagesAvertissement.some((m) => m.includes('r-repondu-ancien-2') && m.includes('sans tâche /inbox correspondante'))).toBe(
        true,
      );
      expect(messagesAvertissement.some((m) => m.includes('prospect@exemple.test'))).toBe(false);

      avertissement.mockRestore();
    },
  );

  it('deux prospects différents sur la même séquence : aucun croisement de corps', async () => {
    const rapportA: Rapport = {
      id: 'r-repondu-a',
      horodatageMs: 1000,
      type: 'reply',
      message: 'Replied',
      email: 'prospect-a@exemple.test',
      sequenceId: 'seq-1',
      corps: '',
    };
    const rapportB: Rapport = {
      id: 'r-repondu-b',
      horodatageMs: 2000,
      type: 'reply',
      message: 'Replied',
      email: 'prospect-b@exemple.test',
      sequenceId: 'seq-1',
      corps: '',
    };
    const tacheA: EnvoiSorti = {
      id: 'tache-a',
      messageId: null,
      email: 'prospect-a@exemple.test',
      sequenceId: 'seq-1',
      termine: true,
      termineMs: null,
      planifieMs: 1500,
      typeTache: 'reply',
      corpsHtml: '<p>Message A</p>',
      sujet: null,
      deSoi: false,
      destinataire: 'expediteur@exemple.test',
      references: [],
    };
    const tacheB: EnvoiSorti = {
      id: 'tache-b',
      messageId: null,
      email: 'prospect-b@exemple.test',
      sequenceId: 'seq-1',
      termine: true,
      termineMs: null,
      planifieMs: 2500,
      typeTache: 'reply',
      corpsHtml: '<p>Message B</p>',
      sujet: null,
      deSoi: false,
      destinataire: 'expediteur@exemple.test',
      references: [],
    };
    const client = clientFactice({
      listerReponses: vi.fn(async () => [rapportA, rapportB]),
      listerTachesReponse: vi.fn(async () => ({ taches: [tacheA, tacheB], sature: false })),
    });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: CONTACT_LOOKUP, repondre: () => ligne([{ id: 'contact-1' }]) },
        { motif: DEDUP_LOOKUP, repondre: () => ligne([]) },
        { motif: THREAD_SELECT, repondre: () => ligne([]) },
        { motif: THREAD_INSERT, repondre: () => ligne([{ id: 'thread-1' }]) },
        { motif: THREAD_MESSAGE_INSERT, repondre: () => ligne([]) },
        { motif: ENROLLMENT_UPDATE, repondre: () => ligne([]) },
        { motif: OUTCOME_INSERT, repondre: () => ligne([]) },
        { motif: NOTIFICATIONS_INSERT, repondre: () => ligne([]) },
        { motif: MAJ_LIVREE_REPLY, repondre: () => ligne([]) },
        { motif: /update actions set status = 'skipped'/i, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const insertions = appels.filter((a) => THREAD_MESSAGE_INSERT.test(a.sql));
    expect(insertions).toHaveLength(2);
    expect(insertions[0]!.values[1]).toBe('Message A');
    expect(insertions[1]!.values[1]).toBe('Message B');
  });

  it('un rapport Error remet l’action en attente avec essais=1 et replanifie la séquence', async () => {
    const rapport: Rapport = {
      id: 'r1',
      horodatageMs: 555,
      type: 'error',
      message: 'Error',
      email: 'marie@exemple.fr',
      sequenceId: 'seq-1',
      corps: '{"message":"Panne"}',
    };
    const client = clientFactice({
      listerRapports: vi.fn(async (p: { message: string }) => (p.message === 'Error' ? [rapport] : [])),
    });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: LOOKUP_ERREUR_SEQUENCE, repondre: () => ligne([{ id: 'action-1', essais: null }]) },
        { motif: REMETTRE_EN_ATTENTE, repondre: () => ligne([]) },
        { motif: BINDING_REPLANIFIE, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const maj = appels.find((a) => REMETTRE_EN_ATTENTE.test(a.sql));
    expect(maj).toBeDefined();
    expect(maj!.values[0]).toBe('action-1');
    expect(JSON.parse(maj!.values[1] as string)).toEqual({ essais: 1 });
    expect(client.replanifier).toHaveBeenCalledTimes(1);
    expect(client.replanifier).toHaveBeenCalledWith('seq-1', 'cle-de-test');
    expect(appels.some((a) => BINDING_REPLANIFIE.test(a.sql))).toBe(true);
  });

  it('une tâche reply en erreur remet l’action en attente immédiatement (sans attendre le délai)', async () => {
    const tache: EnvoiSorti = {
      id: 'tache-1',
      messageId: null,
      email: 'marie@exemple.fr',
      sequenceId: null,
      termine: false,
      termineMs: null,
      planifieMs: Date.now(),
      typeTache: 'reply',
      corpsHtml: null,
      sujet: null,
      deSoi: false,
      destinataire: null,
      references: [],
      erreur: 'Email Sender sending disabled.',
    };
    const client = clientFactice({ listerTachesReponse: vi.fn(async () => ({ taches: [tache], sature: false })) });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: LOOKUP_ERREUR_REPLY, repondre: () => ligne([{ id: 'action-2', essais: '0' }]) },
        { motif: REMETTRE_EN_ATTENTE, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const maj = appels.find((a) => REMETTRE_EN_ATTENTE.test(a.sql));
    expect(maj).toBeDefined();
    expect(maj!.values[0]).toBe('action-2');
    expect(JSON.parse(maj!.values[1] as string)).toEqual({ essais: 1 });
  });

  it('une tâche reply en erreur après trop d’essais force le repli (mode_force) plutôt qu’un nouvel essai', async () => {
    const tache: EnvoiSorti = {
      id: 'tache-4',
      messageId: null,
      email: 'marie@exemple.fr',
      sequenceId: null,
      termine: false,
      termineMs: null,
      planifieMs: Date.now(),
      typeTache: 'reply',
      corpsHtml: null,
      sujet: null,
      deSoi: false,
      destinataire: null,
      references: [],
      erreur: 'Panne persistante',
    };
    const client = clientFactice({ listerTachesReponse: vi.fn(async () => ({ taches: [tache], sature: false })) });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: LOOKUP_ERREUR_REPLY, repondre: () => ligne([{ id: 'action-9', essais: '2' }]) },
        { motif: REMETTRE_EN_ATTENTE, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const maj = appels.find((a) => REMETTRE_EN_ATTENTE.test(a.sql));
    expect(maj).toBeDefined();
    expect(maj!.values[0]).toBe('action-9');
    expect(JSON.parse(maj!.values[1] as string)).toEqual({ mode_force: 'relance_repli' });
  });

  it('une tâche reply trop vieille force le repli et notifie', async () => {
    const septHeures = 7 * 60 * 60 * 1000;
    const tache: EnvoiSorti = {
      id: 'tache-2',
      messageId: null,
      email: 'marie@exemple.fr',
      sequenceId: null,
      termine: false,
      termineMs: null,
      planifieMs: Date.now() - septHeures,
      typeTache: 'reply',
      corpsHtml: null,
      sujet: null,
      deSoi: false,
      destinataire: null,
      references: [],
    };
    const client = clientFactice({ listerTachesReponse: vi.fn(async () => ({ taches: [tache], sature: false })) });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: LOOKUP_ERREUR_REPLY, repondre: () => ligne([{ id: 'action-3', essais: '0' }]) },
        { motif: REMETTRE_EN_ATTENTE, repondre: () => ligne([]) },
        { motif: NOTIFICATIONS_INSERT, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const maj = appels.find((a) => REMETTRE_EN_ATTENTE.test(a.sql));
    expect(maj).toBeDefined();
    expect(JSON.parse(maj!.values[1] as string)).toEqual({ mode_force: 'relance_repli' });
    const notif = appels.find((a) => NOTIFICATIONS_INSERT.test(a.sql));
    expect(notif).toBeDefined();
    // Événement distinct de contact.replied : une relance en retard ne doit pas compter comme une réponse.
    expect(notif!.values[2]).toBe('email.reply_late');
  });

  it('une tâche reply terminée marque l’action liée delivered', async () => {
    const tache: EnvoiSorti = {
      id: 'tache-3',
      messageId: 'msg-repondu-1',
      email: 'marie@exemple.fr',
      sequenceId: null,
      termine: true,
      termineMs: 9000,
      planifieMs: 8000,
      typeTache: 'reply',
      corpsHtml: null,
      sujet: null,
      deSoi: false,
      destinataire: null,
      references: [],
    };
    const client = clientFactice({ listerTachesReponse: vi.fn(async () => ({ taches: [tache], sature: false })) });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: MAJ_LIVREE_REPLY, repondre: () => ligne([{ id: 'action-livree-2' }]) },
        { motif: MAJ_PROVIDER_MESSAGE_ID, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    const maj = appels.find((a) => MAJ_LIVREE_REPLY.test(a.sql));
    expect(maj).toBeDefined();
    expect(maj!.values).toEqual([ORG_ID, 'msg-repondu-1', new Date(9000).toISOString(), 'tache-3']);
    // I4 : provider_message_id se pose sur le fil, rattaché par l'action livrée.
    const filMaj = appels.find((a) => MAJ_PROVIDER_MESSAGE_ID.test(a.sql));
    expect(filMaj).toBeDefined();
    expect(filMaj!.values).toEqual(['action-livree-2', 'msg-repondu-1']);
  });

  it('une boîte envoiActif=false déclenche reconnecterBoite puis, toujours inactive, notifie une fois', async () => {
    const client = clientFactice({
      santeBoite: vi.fn(async () => ({ connectee: false, envoiActif: false, receptionActive: false, sante: 10, derniereErreur: null })),
    });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        {
          motif: SENDERS_SELECT,
          repondre: () =>
            ligne([{ id: 'sender-1', identity: 'expediteur@exemple.fr', provider_ref: 'sb-sender-1', provider_state: {} }]),
        },
        { motif: SENDERS_UPDATE, repondre: () => ligne([]) },
        { motif: NOTIFICATIONS_INSERT, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    expect(client.reconnecterBoite).toHaveBeenCalledTimes(1);
    expect(client.reconnecterBoite).toHaveBeenCalledWith('sb-sender-1', 'cle-de-test');
    expect(client.santeBoite).toHaveBeenCalledTimes(2);
    const notif = appels.find((a) => NOTIFICATIONS_INSERT.test(a.sql));
    expect(notif).toBeDefined();
    // Événement distinct de contact.replied : un expéditeur déconnecté ne doit pas compter comme une réponse.
    expect(notif!.values[2]).toBe('sender.disconnected');
    const maj = appels.find((a) => SENDERS_UPDATE.test(a.sql));
    expect(maj).toBeDefined();
    const etat = JSON.parse(maj!.values[1] as string);
    expect(etat.sending_enabled).toBe(false);
    expect(typeof etat.derniere_notification_ms).toBe('number');
  });

  it('ne notifie pas deux fois dans l’heure pour le même expéditeur', async () => {
    const ilYA10Min = Date.now() - 10 * 60 * 1000;
    const client = clientFactice({
      santeBoite: vi.fn(async () => ({ connectee: false, envoiActif: false, receptionActive: false, sante: 10, derniereErreur: null })),
    });
    const { pool, appels } = creerPoolFactice(
      avecBase(
        {
          motif: SENDERS_SELECT,
          repondre: () =>
            ligne([
              {
                id: 'sender-1',
                identity: 'expediteur@exemple.fr',
                provider_ref: 'sb-sender-1',
                provider_state: { derniere_notification_ms: ilYA10Min },
              },
            ]),
        },
        { motif: SENDERS_UPDATE, repondre: () => ligne([]) },
      ),
    );

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    // Aucun gestionnaire NOTIFICATIONS_INSERT n'est enregistré : un appel non
    // prévu ferait échouer le test plutôt que de passer silencieusement.
    expect(appels.some((a) => NOTIFICATIONS_INSERT.test(a.sql))).toBe(false);
  });

  it('en cas d’ErreurSalesBlink, le curseur n’avance pas et last_error porte code+statut', async () => {
    const client = clientFactice({
      listerEnvoisSortis: vi.fn(async () => {
        throw new ErreurSalesBlink('serveur', 503, 'Erreur interne SalesBlink');
      }),
    });
    const { pool, appels } = creerPoolFactice([
      { motif: CONFIG_CREDENTIALS, repondre: () => ligne([{ config: {} }]) },
      { motif: CURSEUR_SELECT, repondre: () => ligne([{ cursor_ms: 1000 }]) },
      { motif: CURSEUR_UPSERT, repondre: () => ligne([]) },
    ]);

    await releverSalesBlink({ pool }, { organizationId: ORG_ID }, client);

    expect(client.listerReponses).not.toHaveBeenCalled();
    const curseur = appels.find((a) => CURSEUR_UPSERT.test(a.sql));
    expect(curseur).toBeDefined();
    expect(curseur!.values[2]).toBe(1000);
    expect(curseur!.values[3]).toBe('serveur 503');
  });
});

describe('enqueueReleveSalesBlink', () => {
  it('produit un job par organisation avec un id déterministe', async () => {
    const rows = [
      { organization_id: 'org-1', config: { sync_interval_min: '10' } },
      { organization_id: 'org-2', config: null },
    ];
    const { pool } = creerPoolFactice([
      { motif: /select organization_id, config from credentials/i, repondre: () => ligne(rows) },
    ]);
    const insert = vi.fn(async (_jobs: unknown[]) => undefined);
    const boss = { insert } as unknown as PgBoss;

    const n = await enqueueReleveSalesBlink(boss, pool);

    expect(n).toBe(2);
    expect(insert).toHaveBeenCalledTimes(2);
    const bucket1 = currentBucket(10 * 60_000);
    const bucket2 = currentBucket(5 * 60_000);
    expect(insert.mock.calls[0]![0]).toEqual([
      { name: 'inbox.sync', id: deterministicUuid('releve-salesblink', 'org-1', bucket1), data: { organizationId: 'org-1' } },
    ]);
    expect(insert.mock.calls[1]![0]).toEqual([
      { name: 'inbox.sync', id: deterministicUuid('releve-salesblink', 'org-2', bucket2), data: { organizationId: 'org-2' } },
    ]);
  });
});
