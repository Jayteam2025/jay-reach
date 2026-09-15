import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { ErreurGraph } from '@jay-reach/providers/mail';
import type { MessageGraph } from '@jay-reach/providers/mail';
import { traiterEvenementEmail } from '@jay-reach/core';
import type * as JayReachCore from '@jay-reach/core';
import { deterministicUuid, currentBucket } from '../ids.js';
import {
  releverGraph,
  enqueueReleveGraph,
  estReponseANotreEnvoi,
  versEvenementRepondu,
  type ClientGraph,
} from './releve-graph.js';

vi.mock('@jay-reach/core', async (importOriginal) => {
  const reel = await importOriginal<typeof JayReachCore>();
  return { ...reel, traiterEvenementEmail: vi.fn(async () => ({ stored: true, effect: 'reply' })) };
});

const ORG_ID = 'org-1';
const traiterEvenementEmailMock = vi.mocked(traiterEvenementEmail);

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
      throw new Error(`requête non prévue par le test :\n${sql}`);
    }
    return trouve.repondre(values);
  });
  return { pool: { query } as unknown as Pool, appels };
}

// Motifs de requêtes communs à plusieurs scénarios.
const CONFIG_CREDENTIALS = /select config from credentials where/i;
const SENDERS_SELECT = /select id, identity from senders where/i;
const CURSEUR_SELECT = /select cursor_ms from provider_sync_state where/i;
const CURSEUR_UPSERT = /insert into provider_sync_state/i;
const CONTACTS_FILTRE1 = /select id, email from contacts where/i;
const DEDUP_LOOKUP = /select 1 from thread_messages tm/i;

/** Gestionnaires par défaut : identifiants configurés, aucune boîte, aucun curseur. */
function gestionnairesBase(): Gestionnaire[] {
  return [
    { motif: CONFIG_CREDENTIALS, repondre: () => ligne([{ config: {} }]) },
    { motif: SENDERS_SELECT, repondre: () => ligne([]) },
    { motif: CURSEUR_SELECT, repondre: () => ligne([]) },
    { motif: CURSEUR_UPSERT, repondre: () => ligne([]) },
  ];
}

function avecBase(...specifiques: Gestionnaire[]): Gestionnaire[] {
  return [...specifiques, ...gestionnairesBase()];
}

function messageGraph(partiel: Partial<MessageGraph> & Pick<MessageGraph, 'id' | 'conversationId' | 'from' | 'receivedDateTime'>): MessageGraph {
  return {
    internetMessageId: null,
    subject: null,
    to: [],
    sentDateTime: null,
    bodyText: '',
    headers: {},
    ...partiel,
  };
}

function clientFactice(overrides: Partial<ClientGraph> = {}): ClientGraph {
  return {
    listerMessagesRecus: vi.fn(async () => [] as MessageGraph[]),
    listerEnvoyesDansConversation: vi.fn(async () => [] as MessageGraph[]),
    ...overrides,
  };
}

beforeEach(() => {
  process.env.MS_GRAPH_TENANT_ID = 'tenant-test';
  process.env.MS_GRAPH_CLIENT_ID = 'client-test';
  process.env.MS_GRAPH_CLIENT_SECRET = 'secret-test';
  traiterEvenementEmailMock.mockClear();
});

afterEach(() => {
  delete process.env.MS_GRAPH_TENANT_ID;
  delete process.env.MS_GRAPH_CLIENT_ID;
  delete process.env.MS_GRAPH_CLIENT_SECRET;
  vi.restoreAllMocks();
});

describe('estReponseANotreEnvoi', () => {
  const recu = messageGraph({
    id: 'recu-1',
    conversationId: 'conv-1',
    from: 'Julien@Exemple.fr',
    receivedDateTime: '2026-09-15T10:00:00Z',
  });

  it('casse différente de l’adresse → vrai', () => {
    const envoye = messageGraph({
      id: 'envoye-1',
      conversationId: 'conv-1',
      from: 'ventes@exemple.fr',
      to: ['julien@exemple.fr'],
      sentDateTime: '2026-09-15T09:00:00Z',
      receivedDateTime: '2026-09-15T09:00:00Z',
    });
    expect(estReponseANotreEnvoi(recu, [envoye])).toBe(true);
  });

  it('envoyé postérieur au reçu → faux', () => {
    const envoye = messageGraph({
      id: 'envoye-1',
      conversationId: 'conv-1',
      from: 'ventes@exemple.fr',
      to: ['julien@exemple.fr'],
      sentDateTime: '2026-09-15T11:00:00Z',
      receivedDateTime: '2026-09-15T11:00:00Z',
    });
    expect(estReponseANotreEnvoi(recu, [envoye])).toBe(false);
  });

  it('conversation différente → faux', () => {
    const envoye = messageGraph({
      id: 'envoye-1',
      conversationId: 'conv-autre',
      from: 'ventes@exemple.fr',
      to: ['julien@exemple.fr'],
      sentDateTime: '2026-09-15T09:00:00Z',
      receivedDateTime: '2026-09-15T09:00:00Z',
    });
    expect(estReponseANotreEnvoi(recu, [envoye])).toBe(false);
  });
});

describe('versEvenementRepondu', () => {
  it('porte transport, boîte et identifiants Graph, plus les en-têtes d’auto-réponse présents', () => {
    const recu = messageGraph({
      id: 'msg-recu-1',
      conversationId: 'conv-1',
      internetMessageId: 'imid-1',
      subject: 'Re: Contact',
      from: 'julien@exemple.fr',
      receivedDateTime: '2026-09-15T10:00:00Z',
      bodyText: 'Merci pour votre message.',
      headers: { 'auto-submitted': 'auto-replied', 'x-mailer': 'peu importe' },
    });
    const ev = versEvenementRepondu(recu, 'ventes@exemple.fr');
    expect(ev).toEqual({
      type: 'repondu',
      email: 'julien@exemple.fr',
      corps: 'Merci pour votre message.',
      sujet: 'Re: Contact',
      messageId: 'msg-recu-1',
      aMs: new Date('2026-09-15T10:00:00Z').getTime(),
      headers: {
        transport: 'microsoft_graph',
        mailbox: 'ventes@exemple.fr',
        graph_message_id: 'msg-recu-1',
        conversation_id: 'conv-1',
        internet_message_id: 'imid-1',
        subject: 'Re: Contact',
        'auto-submitted': 'auto-replied',
      },
    });
  });

  it('corps tronqué à 20000 caractères', () => {
    const recu = messageGraph({
      id: 'msg-1',
      conversationId: 'conv-1',
      from: 'julien@exemple.fr',
      receivedDateTime: '2026-09-15T10:00:00Z',
      bodyText: 'a'.repeat(20_500),
    });
    const ev = versEvenementRepondu(recu, 'ventes@exemple.fr');
    expect((ev as { corps: string }).corps).toHaveLength(20_000);
  });
});

describe('releverGraph', () => {
  it('sans identifiants Microsoft Graph configurés, la relève est ignorée', async () => {
    delete process.env.MS_GRAPH_TENANT_ID;
    const { pool } = creerPoolFactice(avecBase());
    const client = clientFactice();

    const resultat = await releverGraph({ pool }, { organizationId: ORG_ID }, client);

    expect(resultat).toEqual({ boites: 0, lus: 0, retenus: 0, enregistres: 0 });
    expect(client.listerMessagesRecus).not.toHaveBeenCalled();
  });

  it('boîte sans inbox_provider → aucun appel Graph', async () => {
    const { pool } = creerPoolFactice(avecBase());
    const client = clientFactice();

    const resultat = await releverGraph({ pool }, { organizationId: ORG_ID }, client);

    expect(resultat).toEqual({ boites: 0, lus: 0, retenus: 0, enregistres: 0 });
    expect(client.listerMessagesRecus).not.toHaveBeenCalled();
  });

  it('message d’un expéditeur inconnu → ignoré sans appel sentitems', async () => {
    const recu = messageGraph({
      id: 'recu-1',
      conversationId: 'conv-1',
      from: 'inconnu@exemple.fr',
      receivedDateTime: '2026-09-15T10:00:00Z',
    });
    const { pool } = creerPoolFactice(
      avecBase(
        { motif: SENDERS_SELECT, repondre: () => ligne([{ id: 'sender-1', identity: 'ventes@exemple.fr' }]) },
        { motif: CONTACTS_FILTRE1, repondre: () => ligne([]) },
      ),
    );
    const client = clientFactice({ listerMessagesRecus: vi.fn(async () => [recu]) });

    const resultat = await releverGraph({ pool }, { organizationId: ORG_ID }, client);

    expect(client.listerEnvoyesDansConversation).not.toHaveBeenCalled();
    expect(traiterEvenementEmailMock).not.toHaveBeenCalled();
    expect(resultat).toEqual({ boites: 1, lus: 1, retenus: 0, enregistres: 0 });
  });

  it('message d’un contact sans envoi dans la conversation → ignoré', async () => {
    const recu = messageGraph({
      id: 'recu-1',
      conversationId: 'conv-1',
      from: 'julien@exemple.fr',
      receivedDateTime: '2026-09-15T10:00:00Z',
    });
    const { pool } = creerPoolFactice(
      avecBase(
        { motif: SENDERS_SELECT, repondre: () => ligne([{ id: 'sender-1', identity: 'ventes@exemple.fr' }]) },
        { motif: CONTACTS_FILTRE1, repondre: () => ligne([{ id: 'contact-1', email: 'julien@exemple.fr' }]) },
      ),
    );
    const client = clientFactice({
      listerMessagesRecus: vi.fn(async () => [recu]),
      listerEnvoyesDansConversation: vi.fn(async () => []),
    });

    const resultat = await releverGraph({ pool }, { organizationId: ORG_ID }, client);

    expect(client.listerEnvoyesDansConversation).toHaveBeenCalledTimes(1);
    expect(traiterEvenementEmailMock).not.toHaveBeenCalled();
    expect(resultat).toEqual({ boites: 1, lus: 1, retenus: 0, enregistres: 0 });
  });

  it('réponse valide → traiterEvenementEmail reçoit type repondu, messageId Graph, headers.transport et corps texte', async () => {
    const recu = messageGraph({
      id: 'msg-recu-1',
      conversationId: 'conv-1',
      internetMessageId: 'imid-1',
      subject: 'Re: Contact',
      from: 'julien@exemple.fr',
      receivedDateTime: '2026-09-15T10:00:00Z',
      bodyText: 'Merci pour votre message, je suis intéressé.',
    });
    const envoye = messageGraph({
      id: 'envoye-1',
      conversationId: 'conv-1',
      from: 'ventes@exemple.fr',
      to: ['julien@exemple.fr'],
      sentDateTime: '2026-09-15T09:00:00Z',
      receivedDateTime: '2026-09-15T09:00:00Z',
    });
    const { pool } = creerPoolFactice(
      avecBase(
        { motif: SENDERS_SELECT, repondre: () => ligne([{ id: 'sender-1', identity: 'ventes@exemple.fr' }]) },
        { motif: CONTACTS_FILTRE1, repondre: () => ligne([{ id: 'contact-1', email: 'julien@exemple.fr' }]) },
        { motif: DEDUP_LOOKUP, repondre: () => ligne([]) },
      ),
    );
    const client = clientFactice({
      listerMessagesRecus: vi.fn(async () => [recu]),
      listerEnvoyesDansConversation: vi.fn(async () => [envoye]),
    });

    const resultat = await releverGraph({ pool }, { organizationId: ORG_ID }, client);

    expect(traiterEvenementEmailMock).toHaveBeenCalledTimes(1);
    const [, org, ev, origine] = traiterEvenementEmailMock.mock.calls[0]!;
    expect(org).toBe(ORG_ID);
    expect(origine).toBe('microsoft_graph');
    expect(ev).toMatchObject({
      type: 'repondu',
      messageId: 'msg-recu-1',
      corps: 'Merci pour votre message, je suis intéressé.',
      headers: expect.objectContaining({ transport: 'microsoft_graph' }),
    });
    expect(resultat).toEqual({ boites: 1, lus: 1, retenus: 1, enregistres: 1 });
  });

  it('message déjà présent (provider_message_id) → ignoré', async () => {
    const recu = messageGraph({
      id: 'msg-recu-1',
      conversationId: 'conv-1',
      from: 'julien@exemple.fr',
      receivedDateTime: '2026-09-15T10:00:00Z',
    });
    const envoye = messageGraph({
      id: 'envoye-1',
      conversationId: 'conv-1',
      from: 'ventes@exemple.fr',
      to: ['julien@exemple.fr'],
      sentDateTime: '2026-09-15T09:00:00Z',
      receivedDateTime: '2026-09-15T09:00:00Z',
    });
    const { pool } = creerPoolFactice(
      avecBase(
        { motif: SENDERS_SELECT, repondre: () => ligne([{ id: 'sender-1', identity: 'ventes@exemple.fr' }]) },
        { motif: CONTACTS_FILTRE1, repondre: () => ligne([{ id: 'contact-1', email: 'julien@exemple.fr' }]) },
        { motif: DEDUP_LOOKUP, repondre: () => ligne([{ '?column?': 1 }]) },
      ),
    );
    const client = clientFactice({
      listerMessagesRecus: vi.fn(async () => [recu]),
      listerEnvoyesDansConversation: vi.fn(async () => [envoye]),
    });

    const resultat = await releverGraph({ pool }, { organizationId: ORG_ID }, client);

    expect(traiterEvenementEmailMock).not.toHaveBeenCalled();
    expect(resultat).toEqual({ boites: 1, lus: 1, retenus: 1, enregistres: 0 });
  });

  it('erreur Graph sur une boîte unique → le curseur ne bouge pas (reste à curseurDepart) et last_error est posé (L9)', async () => {
    const CURSEUR_DEPART = 555_000;
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: SENDERS_SELECT, repondre: () => ligne([{ id: 'sender-1', identity: 'ventes@exemple.fr' }]) },
        { motif: CURSEUR_SELECT, repondre: () => ligne([{ cursor_ms: CURSEUR_DEPART }]) },
      ),
    );
    const listerMessagesRecus = vi.fn(async () => {
      throw new ErreurGraph('graph_http', 500, 'erreur');
    });
    const client = clientFactice({ listerMessagesRecus });

    const resultat = await releverGraph({ pool }, { organizationId: ORG_ID }, client);

    expect(resultat).toEqual({ boites: 1, lus: 0, retenus: 0, enregistres: 0 });
    const upsert = appels.find((a) => CURSEUR_UPSERT.test(a.sql));
    expect(upsert).toBeDefined();
    // Bloquant (L9) : le curseur ne doit JAMAIS avancer quand une boîte a
    // échoué — sinon une panne de plus de dix minutes ferait sortir les
    // réponses reçues pendant la panne de la fenêtre relue au passage
    // suivant (perte silencieuse).
    expect(upsert!.values[2]).toBe(CURSEUR_DEPART);
    expect(upsert!.values[3]).toBe('graph_http 500');
  });

  it('toutes les boîtes réussissent → le curseur avance à maintenant et last_error redevient null (L9)', async () => {
    const avant = Date.now();
    const { pool, appels } = creerPoolFactice(
      avecBase(
        { motif: SENDERS_SELECT, repondre: () => ligne([{ id: 'sender-1', identity: 'ventes@exemple.fr' }]) },
        { motif: CURSEUR_SELECT, repondre: () => ligne([{ cursor_ms: 555_000 }]) },
      ),
    );
    const client = clientFactice({ listerMessagesRecus: vi.fn(async () => []) });

    await releverGraph({ pool }, { organizationId: ORG_ID }, client);
    const apres = Date.now();

    const upsert = appels.find((a) => CURSEUR_UPSERT.test(a.sql));
    expect(upsert).toBeDefined();
    expect(upsert!.values[2] as number).toBeGreaterThanOrEqual(avant);
    expect(upsert!.values[2] as number).toBeLessThanOrEqual(apres);
    expect(upsert!.values[3]).toBeNull();
  });

  it('erreur sur la 1re boîte, succès sur la 2e → la 2e est traitée ET le curseur n’avance pas (L9)', async () => {
    const CURSEUR_DEPART = 555_000;
    const { pool, appels } = creerPoolFactice(
      avecBase(
        {
          motif: SENDERS_SELECT,
          repondre: () =>
            ligne([
              { id: 'sender-1', identity: 'ventes@exemple.fr' },
              { id: 'sender-2', identity: 'support@exemple.fr' },
            ]),
        },
        { motif: CURSEUR_SELECT, repondre: () => ligne([{ cursor_ms: CURSEUR_DEPART }]) },
      ),
    );
    const listerMessagesRecus = vi.fn(async (_cfg: unknown, boite: string) => {
      if (boite === 'ventes@exemple.fr') {
        throw new ErreurGraph('graph_http', 500, 'erreur');
      }
      return [];
    });
    const client = clientFactice({ listerMessagesRecus });

    const resultat = await releverGraph({ pool }, { organizationId: ORG_ID }, client);

    expect(listerMessagesRecus).toHaveBeenCalledTimes(2);
    expect(listerMessagesRecus).toHaveBeenNthCalledWith(2, expect.anything(), 'support@exemple.fr', expect.any(String));
    expect(resultat).toEqual({ boites: 2, lus: 0, retenus: 0, enregistres: 0 });
    const upsert = appels.find((a) => CURSEUR_UPSERT.test(a.sql));
    expect(upsert).toBeDefined();
    expect(upsert!.values[2]).toBe(CURSEUR_DEPART);
    expect(upsert!.values[3]).toBe('graph_http 500');
  });
});

describe('enqueueReleveGraph', () => {
  it('produit un job par organisation avec un id déterministe', async () => {
    const rows = [
      { organization_id: 'org-1', config: { sync_interval_min: '10' } },
      { organization_id: 'org-2', config: null },
    ];
    const { pool } = creerPoolFactice([{ motif: /select organization_id, config from credentials/i, repondre: () => ligne(rows) }]);
    const insert = vi.fn(async (_jobs: unknown[]) => undefined);
    const boss = { insert } as unknown as PgBoss;

    await enqueueReleveGraph(boss, pool);

    expect(insert).toHaveBeenCalledTimes(2);
    const bucket1 = currentBucket(10 * 60_000);
    const bucket2 = currentBucket(5 * 60_000);
    expect(insert.mock.calls[0]![0]).toEqual([
      { name: 'inbox.sync_graph', id: deterministicUuid('releve-graph', 'org-1', bucket1), data: { organizationId: 'org-1' } },
    ]);
    expect(insert.mock.calls[1]![0]).toEqual([
      { name: 'inbox.sync_graph', id: deterministicUuid('releve-graph', 'org-2', bucket2), data: { organizationId: 'org-2' } },
    ]);
  });

  it('n’enfile pas deux fois dans la même fenêtre', async () => {
    const rows = [{ organization_id: 'org-1', config: {} }];
    const { pool } = creerPoolFactice([{ motif: /select organization_id, config from credentials/i, repondre: () => ligne(rows) }]);
    const insert = vi.fn(async (_jobs: unknown[]) => undefined);
    const boss = { insert } as unknown as PgBoss;

    await enqueueReleveGraph(boss, pool);
    await enqueueReleveGraph(boss, pool);

    const id1 = (insert.mock.calls[0]![0] as { id: string }[])[0]!.id;
    const id2 = (insert.mock.calls[1]![0] as { id: string }[])[0]!.id;
    expect(id1).toBe(id2);
  });
});
