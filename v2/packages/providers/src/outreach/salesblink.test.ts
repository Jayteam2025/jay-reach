import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ErreurSalesBlink,
  listerBoites,
  santeBoite,
  creerGabaritNeutre,
  pousserLeads,
  creerSequenceEtape,
  activerEtPlanifier,
  listerEnvoisSortis,
  listerReponses,
  listerRapports,
  PAGES_MAX_PAR_DEFAUT,
  TAILLE_PAGE_RAPPORTS,
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

describe('listerBoites', () => {
  it('lit alias, senderName, sendingEnabled/receivingEnabled et le plafond de sequence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reponseJson({
          success: true,
          data: [
            {
              id: 'boite-uuid-1',
              alias: 'exemple@exemple.fr',
              google_email: 'exemple@exemple.fr',
              senderName: 'Boite de test',
              serviceName: 'Google',
              senderType: 'OAUTH',
              sendingEnabled: true,
              receivingEnabled: false,
              readyForOutreach: 'unknown',
              sequence_max_daily_frequency: 20,
              maxDailyFrequency: 50,
              mailbox_subscription_expired: false,
              warmupEnabled: true,
            },
          ],
        }),
      ),
    );

    const [boite] = await listerBoites(CLE_TEST);

    expect(boite).toMatchObject({
      id: 'boite-uuid-1',
      email: 'exemple@exemple.fr',
      nom: 'Boite de test',
      connectee: true,
      envoiActif: true,
      receptionActive: false,
      plafondQuotidien: 20,
    });
  });

  it("replie sur google_email quand alias est absent, et sur l'email quand senderName est absent", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reponseJson({
          success: true,
          data: [
            {
              id: 'boite-uuid-2',
              google_email: 'repli@exemple.fr',
              sendingEnabled: false,
              receivingEnabled: false,
            },
          ],
        }),
      ),
    );

    const [boite] = await listerBoites(CLE_TEST);

    expect(boite).toMatchObject({
      email: 'repli@exemple.fr',
      nom: 'repli@exemple.fr',
      connectee: false,
      envoiActif: false,
      receptionActive: false,
      plafondQuotidien: null,
    });
  });
});

describe('santeBoite', () => {
  it('mappe derniereErreur depuis app/error/errorTime, message tronque a 200 caracteres', async () => {
    const messageLong = 'Command failed NO true 3 NO [ALERT] IMAP access is disabled for your domain. '.repeat(4);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reponseJson({
          success: true,
          data: {
            sender_id: 'boite-uuid-1',
            email: 'exemple@exemple.fr',
            connected: true,
            processing: false,
            sending_enabled: false,
            receiving_enabled: false,
            health_score: 50,
            error: {
              app: 'imap-check',
              errorFunction: 'imap-worker.action',
              error: messageLong,
              errorTime: '11/09/2026 12:28:18',
            },
          },
        }),
      ),
    );

    const sante = await santeBoite('boite-uuid-1', CLE_TEST);

    expect(sante.connectee).toBe(true);
    expect(sante.envoiActif).toBe(false);
    expect(sante.receptionActive).toBe(false);
    expect(sante.sante).toBe(50);
    expect(sante.derniereErreur?.app).toBe('imap-check');
    expect(sante.derniereErreur?.a).toBe('11/09/2026 12:28:18');
    expect(sante.derniereErreur?.message).toBe(messageLong.slice(0, 200));
  });

  it('derniereErreur vaut null quand la boite est saine', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reponseJson({
          success: true,
          data: {
            connected: true,
            sending_enabled: true,
            receiving_enabled: true,
            health_score: 100,
            error: null,
          },
        }),
      ),
    );

    const sante = await santeBoite('boite-uuid-1', CLE_TEST);
    expect(sante.derniereErreur).toBeNull();
  });
});

describe('listerRapports', () => {
  it('parse time (chaine de millisecondes) en horodatageMs numerique', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reponseJson({
          success: true,
          data: [
            {
              id: 'rapport-1',
              time: '1789050100069',
              type: 'outreach',
              message: 'Sent',
              email: 'exemple@exemple.fr',
              sequence: 'sequence-uuid-1',
              sender: 'boite-uuid-1',
            },
          ],
        }),
      ),
    );

    const rapports = await listerRapports({ message: 'Sent', depuisMs: 0 }, CLE_TEST);

    expect(rapports).toHaveLength(1);
    expect(rapports[0]).toMatchObject({
      id: 'rapport-1',
      horodatageMs: 1789050100069,
      type: 'outreach',
      message: 'Sent',
      sequenceId: 'sequence-uuid-1',
    });
  });

  it("lit le corps JSON d'une erreur dans body", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reponseJson({
          success: true,
          data: [
            {
              id: 'rapport-2',
              time: '1789050200000',
              type: 'error',
              message: 'Error',
              email: 'exemple@exemple.fr',
              sequence: 'sequence-uuid-1',
              body: '{"message":"Email Sender sending disabled. Needs to reconnect."}',
            },
          ],
        }),
      ),
    );

    const [rapport] = await listerRapports({ message: 'Error', depuisMs: 0 }, CLE_TEST);
    expect(rapport?.corps).toBe('{"message":"Email Sender sending disabled. Needs to reconnect."}');
  });

  it('pagine sur skip=0 puis skip=1 quand la premiere page est pleine (100 rapports)', async () => {
    const urlsAppelees: string[] = [];
    const rapportFictif = (id: string) => ({
      id,
      time: '1700000000000',
      type: 'outreach',
      message: 'Sent',
      email: 'exemple@exemple.fr',
      sequence: 'sequence-uuid-1',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urlsAppelees.push(url);
        const lot =
          urlsAppelees.length === 1
            ? Array.from({ length: 100 }, (_, i) => rapportFictif(`rapport-${i}`))
            : [rapportFictif('rapport-100')];
        return reponseJson({ success: true, data: lot });
      }),
    );

    const rapports = await listerRapports({ message: 'Sent', depuisMs: 0 }, CLE_TEST);

    expect(urlsAppelees).toHaveLength(2);
    expect(urlsAppelees[0]).toContain('skip=0');
    expect(urlsAppelees[1]).toContain('skip=1');
    expect(rapports).toHaveLength(101);
  });
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

  it('503 leve ErreurSalesBlink code serveur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reponseJson({ success: false, message: 'Service indisponible' }, 503)));

    await expect(listerBoites(CLE_TEST)).rejects.toMatchObject({ code: 'serveur', statut: 503 });
  });

  it("un corps non-JSON sur un 200 leve ErreurSalesBlink sans faire fuiter la cle", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>pas du json</html>', { status: 200 })),
    );

    let erreurCapturee: ErreurSalesBlink | undefined;
    try {
      await listerBoites(CLE_TEST);
    } catch (erreur) {
      erreurCapturee = erreur as ErreurSalesBlink;
    }

    expect(erreurCapturee).toBeInstanceOf(ErreurSalesBlink);
    expect(erreurCapturee?.message).not.toContain(CLE_TEST);
  });
});

describe('creerGabaritNeutre', () => {
  it('envoie un FormData avec les placeholders jr_subject/jr_body, sans Content-Type pose a la main, et renvoie data.id', async () => {
    let entetesRecues: Record<string, string> | undefined;
    let corpsRecu: FormData | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        entetesRecues = init.headers as Record<string, string>;
        corpsRecu = init.body as FormData;
        return reponseJson({ success: true, data: { id: 'gabarit-uuid-1' } });
      }),
    );

    const id = await creerGabaritNeutre('Gabarit de test', '<p>Contenu fixe</p>', CLE_TEST);

    expect(id).toBe('gabarit-uuid-1');
    expect(corpsRecu).toBeInstanceOf(FormData);
    expect(corpsRecu?.get('subject_line')).toBe('{{jr_subject}}');
    expect(String(corpsRecu?.get('content'))).toContain('{{jr_body}}');
    expect(entetesRecues?.['Content-Type']).toBeUndefined();
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

describe('fenêtre from/to et plafond de pages', () => {
  it('listerReponses envoie from et to quand jusquaMs est fourni', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return reponseJson({ success: true, data: [] });
      }),
    );

    await listerReponses(1000, CLE_TEST, { jusquaMs: 2000 });

    expect(urls[0]).toContain('from=1000');
    expect(urls[0]).toContain('to=2000');
  });

  it('listerReponses omet to quand jusquaMs est absent (retrocompatible)', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return reponseJson({ success: true, data: [] });
      }),
    );

    await listerReponses(1000, CLE_TEST);

    expect(urls[0]).toContain('from=1000');
    expect(urls[0]).not.toContain('to=');
  });

  it('listerRapports envoie from et to quand jusquaMs est fourni', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return reponseJson({ success: true, data: [] });
      }),
    );

    await listerRapports({ message: 'Bounced', depuisMs: 1000, jusquaMs: 2000 }, CLE_TEST);

    expect(urls[0]).toContain('from=1000');
    expect(urls[0]).toContain('to=2000');
  });

  it('listerEnvoisSortis encode la fenêtre dans le paramètre date, borne haute = jusquaMs', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return reponseJson({ success: true, data: { result: [] } });
      }),
    );

    await listerEnvoisSortis(1000, CLE_TEST, { jusquaMs: 2000 });

    expect(urls[0]).toContain('date=1000-2000');
  });

  it('maxPages borne le nombre de pages récupérées, même si chaque page est pleine (listerRapports)', async () => {
    const urls: string[] = [];
    const rapportFictif = (id: string) => ({
      id,
      time: '1700000000000',
      type: 'outreach',
      message: 'Sent',
      email: 'exemple@exemple.fr',
      sequence: 'sequence-1',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return reponseJson({ success: true, data: Array.from({ length: 100 }, (_, i) => rapportFictif(`r-${urls.length}-${i}`)) });
      }),
    );

    const rapports = await listerRapports({ message: 'Sent', depuisMs: 0, maxPages: 2 }, CLE_TEST);

    expect(urls).toHaveLength(2);
    expect(rapports).toHaveLength(200);
  });

  it('sans maxPages explicite, s’arrête à PAGES_MAX_PAR_DEFAUT pages pleines (listerRapports)', async () => {
    const urls: string[] = [];
    const rapportFictif = (id: string) => ({
      id,
      time: '1700000000000',
      type: 'outreach',
      message: 'Sent',
      email: 'exemple@exemple.fr',
      sequence: 'sequence-1',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return reponseJson({ success: true, data: Array.from({ length: 100 }, (_, i) => rapportFictif(`r-${urls.length}-${i}`)) });
      }),
    );

    const rapports = await listerRapports({ message: 'Sent', depuisMs: 0 }, CLE_TEST);

    expect(urls).toHaveLength(PAGES_MAX_PAR_DEFAUT);
    expect(rapports).toHaveLength(PAGES_MAX_PAR_DEFAUT * TAILLE_PAGE_RAPPORTS);
  });
});
