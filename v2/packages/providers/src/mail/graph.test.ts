import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ErreurGraph,
  listerEnvoyesDansConversation,
  listerMessagesRecus,
  obtenirJeton,
  repondreDansLaBoite,
  type ConfigGraph,
} from './graph.js';

const SECRET_TEST = 'secret-application-tres-confidentiel';

function cfgTest(suffixe: string): ConfigGraph {
  return {
    tenantId: `tenant-${suffixe}`,
    clientId: `client-${suffixe}`,
    clientSecret: SECRET_TEST,
  };
}

function reponseJson(corps: unknown, statut = 200, entetes?: Record<string, string>): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'Content-Type': 'application/json', ...entetes },
  });
}

function reponseJeton(jeton = 'jeton-acces-1', expiresIn = 3600): Response {
  return reponseJson({ access_token: jeton, expires_in: expiresIn, token_type: 'Bearer' });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('obtenirJeton', () => {
  it('envoie grant_type=client_credentials et met en cache (2 appels -> 1 requete)', async () => {
    const cfg = cfgTest('cache');
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(init?.body)).toContain('grant_type=client_credentials');
      expect(String(init?.body)).toContain(`client_id=${cfg.clientId}`);
      expect(String(init?.body)).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
      return reponseJeton();
    });

    const jeton1 = await obtenirJeton(cfg, fetchFn as unknown as typeof fetch);
    const jeton2 = await obtenirJeton(cfg, fetchFn as unknown as typeof fetch);

    expect(jeton1).toBe('jeton-acces-1');
    expect(jeton2).toBe('jeton-acces-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('listerMessagesRecus', () => {
  it('sur 401, renouvelle le jeton une fois puis reessaie', async () => {
    const cfg = cfgTest('401');
    let appelsJeton = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes('login.microsoftonline.com')) {
        appelsJeton += 1;
        return reponseJeton(`jeton-${appelsJeton}`);
      }
      if (String(url).includes('mailFolders/inbox/messages')) {
        // Le premier appel Graph echoue en 401 (jeton perime cote serveur) ;
        // le second (avec un jeton renouvele) reussit.
        if (appelsJeton === 1) return new Response('{"error":{"message":"jeton invalide"}}', { status: 401 });
        return reponseJson({ value: [] });
      }
      throw new Error(`URL inattendue: ${url}`);
    });

    const messages = await listerMessagesRecus(cfg, 'boite@exemple.fr', '2026-01-01T00:00:00Z', fetchFn as unknown as typeof fetch);

    expect(messages).toEqual([]);
    expect(appelsJeton).toBe(2);
  });

  it('sur 429 avec Retry-After, attend (plafonne) puis reessaie une fois', async () => {
    vi.useFakeTimers();
    const cfg = cfgTest('429');
    let appelsGraph = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes('login.microsoftonline.com')) return reponseJeton();
      appelsGraph += 1;
      if (appelsGraph === 1) {
        return reponseJson({}, 429, { 'Retry-After': '1' });
      }
      return reponseJson({
        value: [
          {
            id: 'msg-1',
            conversationId: 'conv-1',
            internetMessageId: '<msg-1@exemple.fr>',
            subject: 'Re: test',
            from: { emailAddress: { address: 'prospect@exemple.fr', name: 'Prospect Exemple' } },
            toRecipients: [{ emailAddress: { address: 'boite@exemple.fr', name: 'Boite' } }],
            receivedDateTime: '2026-01-02T10:00:00Z',
            sentDateTime: null,
            body: { content: 'Bonjour, ca m interesse.' },
            internetMessageHeaders: [{ name: 'Auto-Submitted', value: 'no' }],
          },
        ],
      });
    });

    const promesse = listerMessagesRecus(cfg, 'boite@exemple.fr', '2026-01-01T00:00:00Z', fetchFn as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(1000);
    const messages = await promesse;

    expect(appelsGraph).toBe(2);
    expect(messages).toHaveLength(1);
    expect(messages[0].headers).toEqual({ 'auto-submitted': 'no' });
    expect(messages[0].from).toBe('prospect@exemple.fr');
    expect(messages[0].to).toEqual(['boite@exemple.fr']);
    expect(messages[0].bodyText).toBe('Bonjour, ca m interesse.');
  });

  it("n'expose jamais le secret ni le jeton dans le message d'erreur", async () => {
    const cfg = cfgTest('erreur');
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes('login.microsoftonline.com')) return reponseJeton('jeton-secret-abc');
      return new Response('{"error":{"message":"Application non autorisee sur ce tenant"}}', { status: 403 });
    });

    await expect(listerMessagesRecus(cfg, 'boite@exemple.fr', '2026-01-01T00:00:00Z', fetchFn as unknown as typeof fetch)).rejects.toThrow(
      ErreurGraph,
    );

    try {
      await listerMessagesRecus(cfg, 'boite@exemple.fr', '2026-01-01T00:00:00Z', fetchFn as unknown as typeof fetch);
      throw new Error('aurait du lever ErreurGraph');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurGraph);
      const err = erreur as ErreurGraph;
      expect(err.message).not.toContain(SECRET_TEST);
      expect(err.message).not.toContain('jeton-secret-abc');
      expect(err.code).toBe('graph_http');
      expect(err.statut).toBe(403);
    }
  });

  it('suit @odata.nextLink jusqu a agreger toutes les pages', async () => {
    const cfg = cfgTest('pagination');
    const urlSuite = `${'https://graph.microsoft.com/v1.0'}/users/boite%40exemple.fr/mailFolders/inbox/messages?$skip=50`;
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes('login.microsoftonline.com')) return reponseJeton();
      if (url === urlSuite) {
        return reponseJson({ value: [{ id: 'msg-2', conversationId: 'conv-2', receivedDateTime: '2026-01-01T00:00:00Z' }] });
      }
      return reponseJson({
        value: [{ id: 'msg-1', conversationId: 'conv-1', receivedDateTime: '2026-01-02T00:00:00Z' }],
        '@odata.nextLink': urlSuite,
      });
    });

    const messages = await listerMessagesRecus(cfg, 'boite@exemple.fr', '2026-01-01T00:00:00Z', fetchFn as unknown as typeof fetch);

    expect(messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
  });
});

describe('listerEnvoyesDansConversation', () => {
  it('filtre par conversationId et mappe les champs restreints', async () => {
    const cfg = cfgTest('conversation');
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes('login.microsoftonline.com')) return reponseJeton();
      expect(String(url)).toContain('mailFolders/sentitems/messages');
      expect(new URL(url).searchParams.get('$filter')).toBe("conversationId eq 'conv-1'");
      return reponseJson({
        value: [
          {
            id: 'envoye-1',
            conversationId: 'conv-1',
            internetMessageId: '<envoye-1@exemple.fr>',
            subject: 'Suivi',
            toRecipients: [{ emailAddress: { address: 'prospect@exemple.fr' } }],
            sentDateTime: '2026-01-01T09:00:00Z',
          },
        ],
      });
    });

    const messages = await listerEnvoyesDansConversation(cfg, 'boite@exemple.fr', 'conv-1', fetchFn as unknown as typeof fetch);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'envoye-1',
      conversationId: 'conv-1',
      to: ['prospect@exemple.fr'],
      sentDateTime: '2026-01-01T09:00:00Z',
      from: null,
      bodyText: '',
    });
  });
});

describe('repondreDansLaBoite', () => {
  it('envoie le corps HTML attendu et accepte 202', async () => {
    const cfg = cfgTest('reponse');
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('login.microsoftonline.com')) return reponseJeton();
      expect(String(url)).toContain('/messages/msg-1/reply');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        message: { body: { contentType: 'HTML', content: '<p>Merci pour votre retour.</p>' } },
      });
      expect((init?.headers as Record<string, string>).Prefer).toBe('outlook.timezone="Europe/Paris"');
      return new Response(null, { status: 202 });
    });

    await expect(
      repondreDansLaBoite(cfg, 'boite@exemple.fr', 'msg-1', '<p>Merci pour votre retour.</p>', fetchFn as unknown as typeof fetch),
    ).resolves.toBeUndefined();
  });
});
