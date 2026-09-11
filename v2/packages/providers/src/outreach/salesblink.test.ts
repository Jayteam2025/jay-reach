import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ErreurSalesBlink,
  listerBoites,
  pousserLeads,
  creerSequenceEtape,
  activerEtPlanifier,
  listerEnvoisSortis,
  listerReponses,
  type LeadSalesBlink,
} from './salesblink.js';

const CLE_TEST = 'cle-de-test-tres-secrete';

function reponseJson(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pousserLeads', () => {
  it('decoupe 600 leads en deux appels (500 puis 100) avec remove_duplicates a true', async () => {
    const corpsEnvoyes: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        corpsEnvoyes.push(JSON.parse(String(init.body)));
        return reponseJson({ success: true });
      }),
    );

    const leads: LeadSalesBlink[] = Array.from({ length: 600 }, (_, i) => ({
      email: `lead${i}@exemple.test`,
      jr_subject: 'Objet',
      jr_body: 'Corps',
      jr_action_id: 'action-1',
    }));

    await pousserLeads('liste-1', leads, CLE_TEST);

    expect(corpsEnvoyes).toHaveLength(2);
    expect((corpsEnvoyes[0]?.contacts as unknown[]).length).toBe(500);
    expect((corpsEnvoyes[1]?.contacts as unknown[]).length).toBe(100);
    for (const corps of corpsEnvoyes) {
      expect(corps.list_id).toBe('liste-1');
      expect(corps.remove_duplicates).toBe(true);
    }
  });
});

describe('creerSequenceEtape', () => {
  it('envoie exactement les champs attendus, evergreen a true et 7 entrees d\'heures', async () => {
    let corpsEnvoye: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        corpsEnvoye = JSON.parse(String(init.body));
        return reponseJson({ success: true, data: { id: 'sequence-1' } });
      }),
    );

    const heures = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((name) => ({
      name,
      enabled: name !== 'Saturday' && name !== 'Sunday',
      fromTime: '09:00',
      toTime: '17:00',
    }));

    const id = await creerSequenceEtape(
      {
        nom: 'Etape 1',
        idBoite: 'boite-1',
        idListe: 'liste-1',
        idGabarit: 'gabarit-1',
        fuseau: 'Europe/Paris',
        heures,
      },
      CLE_TEST,
    );

    expect(id).toBe('sequence-1');
    expect(corpsEnvoye).toMatchObject({
      name: 'Etape 1',
      senders: 'boite-1',
      lists: ['liste-1'],
      steps: [{ type: 'email', template_id: 'gabarit-1' }],
      evergreen: true,
      paused: true,
      launchTimingMode: 'now',
      timezone: 'Europe/Paris',
      stopWhenReplyRecieved: true,
      sendToOnlyVerifiedEmail: false,
      validEmail: true,
      riskyEmail: true,
      invalidEmail: true,
      checkEmailBeforeSending: false,
      delayEnabled: false,
    });
    expect((corpsEnvoye?.emailSendingHours as unknown[]).length).toBe(7);
  });
});

describe('activerEtPlanifier', () => {
  it('demarre la sequence (POST .../status) puis la replanifie (PATCH)', async () => {
    const appels: { url: string; methode: string; corps: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        appels.push({ url, methode: String(init.method), corps: init.body ? JSON.parse(String(init.body)) : null });
        return reponseJson({ success: true });
      }),
    );

    await activerEtPlanifier('sequence-1', CLE_TEST);

    expect(appels).toHaveLength(2);
    expect(appels[0]?.methode).toBe('POST');
    expect(appels[0]?.url).toContain('/sequences/sequence-1/status');
    expect(appels[0]?.corps).toEqual({ status: 'ACTIVE' });
    expect(appels[1]?.methode).toBe('PATCH');
    expect(appels[1]?.url).toContain('/sequences/sequence-1');
    expect(appels[1]?.url).not.toContain('/status');
    expect(appels[1]?.corps).toEqual({ launchTimingMode: 'now', paused: false });
  });
});

describe('gestion des erreurs HTTP', () => {
  it('429 leve ErreurSalesBlink code limite', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reponseJson({ success: false, message: 'Too many requests' }, 429)));

    await expect(listerBoites(CLE_TEST)).rejects.toMatchObject({ code: 'limite', statut: 429 });
  });

  it('403 leve ErreurSalesBlink code client avec le message SalesBlink tronque a 200 caracteres', async () => {
    const messageLong = 'Requete refusee : '.repeat(30);
    vi.stubGlobal('fetch', vi.fn(async () => reponseJson({ success: false, message: messageLong }, 403)));

    let erreurCapturee: ErreurSalesBlink | undefined;
    try {
      await listerBoites(CLE_TEST);
    } catch (erreur) {
      erreurCapturee = erreur as ErreurSalesBlink;
    }

    expect(erreurCapturee).toBeInstanceOf(ErreurSalesBlink);
    expect(erreurCapturee?.code).toBe('client');
    expect(erreurCapturee?.statut).toBe(403);
    expect(erreurCapturee?.message.length).toBeLessThanOrEqual(200);
  });

  it("un fetch qui rejette leve ErreurSalesBlink code reseau", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connexion reinitialisee');
      }),
    );

    await expect(listerBoites(CLE_TEST)).rejects.toMatchObject({ code: 'reseau', statut: null });
  });
});

describe('en-tete Authorization', () => {
  it("porte la cle nue et n'apparait jamais dans le message d'une erreur", async () => {
    let entetesRecus: Record<string, string> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        entetesRecus = init.headers as Record<string, string>;
        return reponseJson({ success: false, message: 'acces refuse' }, 403);
      }),
    );

    let erreurCapturee: ErreurSalesBlink | undefined;
    try {
      await listerBoites(CLE_TEST);
    } catch (erreur) {
      erreurCapturee = erreur as ErreurSalesBlink;
    }

    expect(entetesRecus?.Authorization).toBe(CLE_TEST);
    expect(entetesRecus?.Authorization).not.toMatch(/^Bearer/);
    expect(erreurCapturee?.message).not.toContain(CLE_TEST);
  });
});

describe('listerEnvoisSortis', () => {
  it('lit data.result et convertit completed_time en nombre', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reponseJson({
          success: true,
          data: {
            result: [
              {
                id: 'tache-1',
                messageId: 'msg-1',
                email: 'lead@exemple.test',
                sequence: 'sequence-1',
                completed: true,
                completed_time: '1700000000000',
                scheduled_time: 1699999000000,
                task_type: 'email',
              },
            ],
          },
        }),
      ),
    );

    const envois = await listerEnvoisSortis(1699000000000, CLE_TEST);

    expect(envois).toHaveLength(1);
    expect(envois[0]).toMatchObject({
      id: 'tache-1',
      messageId: 'msg-1',
      email: 'lead@exemple.test',
      sequenceId: 'sequence-1',
      termine: true,
      termineMs: 1700000000000,
      planifieMs: 1699999000000,
      typeTache: 'email',
    });
    expect(envois[0]?.erreur).toBeUndefined();
  });

  it("remplit erreur depuis error.message.message, tronque a 200 caracteres, sans le fuiter ailleurs", async () => {
    const messageInterieur = 'Email Sender sending disabled. Needs to reconnect.';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reponseJson({
          success: true,
          data: {
            result: [
              {
                id: 'tache-2',
                messageId: null,
                email: 'lead2@exemple.test',
                sequence: 'sequence-1',
                completed: false,
                completed_time: null,
                scheduled_time: null,
                task_type: 'reply',
                error: { message: { message: messageInterieur } },
              },
            ],
          },
        }),
      ),
    );

    const [envoi] = await listerEnvoisSortis(0, CLE_TEST);

    expect(envoi?.erreur).toBe(messageInterieur);
    expect(envoi?.termine).toBe(false);
    expect(envoi?.termineMs).toBeNull();
  });
});

describe('listerReponses', () => {
  it('accepte un tableau nu (sans enveloppe success/data)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reponseJson([
          {
            id: 'reponse-1',
            time: 1700000000000,
            message: 'Replied',
            type: 'reply',
            sequence: 'sequence-1',
            email: 'lead@exemple.test',
          },
        ]),
      ),
    );

    const rapports = await listerReponses(0, CLE_TEST);

    expect(rapports).toHaveLength(1);
    expect(rapports[0]).toMatchObject({
      id: 'reponse-1',
      horodatageMs: 1700000000000,
      type: 'reply',
      message: 'Replied',
      email: 'lead@exemple.test',
      sequenceId: 'sequence-1',
    });
  });
});
