import { describe, expect, it } from 'vitest';
import type { Pilote } from './navigateur.js';
import { envoyerInvitation, envoyerMessage, resoudreProfil } from './envoi.js';

type Appel = { url: string; entetes: Record<string, string> | undefined; corps: unknown };
type Reponse = { statut: number; corps?: unknown };

const FEED = 'https://www.linkedin.com/feed/';
const URL_PROFIL = (vanity: string) =>
  `https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${vanity}`;
const URL_INVITATION =
  'https://www.linkedin.com/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2';
const URL_MESSAGE =
  'https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage';
const URL_ME = 'https://www.linkedin.com/voyager/api/me';

const URN_DESTINATAIRE = 'urn:li:fsd_profile:ACoAAdestinataire';
const URN_EXPEDITEUR = 'urn:li:fsd_profile:ACoAAexpediteur';

/** Pilote factice : consigne chaque appel et chaque navigation, rend la reponse choisie par URL. */
function pilote(
  reponses: Record<string, Reponse>,
  urlCourante = 'about:blank',
): { p: Pilote; appels: Appel[]; pages: string[] } {
  const appels: Appel[] = [];
  const pages: string[] = [];
  let courante = urlCourante;
  const p: Pilote = {
    aller: async (url) => {
      pages.push(url);
      courante = url;
    },
    url: async () => courante,
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '',
    attendre: async () => true,
    requete: async (url, entetes, corps) => {
      appels.push({ url, entetes, corps });
      const r = reponses[url];
      if (!r) throw new Error(`requete non prevue : ${url}`);
      return { statut: r.statut, corps: typeof r.corps === 'string' ? r.corps : JSON.stringify(r.corps ?? {}) };
    },
    fermer: async () => undefined,
  };
  return { p, appels, pages };
}

const profilResolu = (vanity = 'jeanne-dupont'): Record<string, Reponse> => ({
  [URL_PROFIL(vanity)]: { statut: 200, corps: { elements: [{ entityUrn: URN_DESTINATAIRE }] } },
});
const moi: Record<string, Reponse> = {
  [URL_ME]: {
    statut: 200,
    corps: {
      data: { '*miniProfile': 'urn:li:fs_miniProfile:ACoAAexpediteur' },
      included: [{ entityUrn: 'urn:li:fs_miniProfile:ACoAAexpediteur', publicIdentifier: 'moi' }],
    },
  },
};

describe('resoudreProfil', () => {
  it('lit le URN dans elements et demande le profil par son identifiant', async () => {
    const { p, appels } = pilote(profilResolu());
    await expect(resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont/')).resolves.toBe(URN_DESTINATAIRE);
    expect(appels).toHaveLength(1);
    expect(appels[0]!.url).toBe(URL_PROFIL('jeanne-dupont'));
    expect(appels[0]!.corps).toBeUndefined();
  });

  it('retombe sur included quand elements est absent, en exigeant le bon identifiant public', async () => {
    const { p } = pilote({
      [URL_PROFIL('jeanne-dupont')]: {
        statut: 200,
        corps: {
          included: [
            { entityUrn: 'urn:li:fsd_profile:AUTRE', publicIdentifier: 'quelquun-d-autre' },
            { entityUrn: URN_DESTINATAIRE, publicIdentifier: 'jeanne-dupont' },
          ],
        },
      },
    });
    await expect(resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont')).resolves.toBe(URN_DESTINATAIRE);
  });

  it('une URN qui ne commence pas par urn:li:fsd_profile: rend profile_not_found', async () => {
    const { p } = pilote({
      [URL_PROFIL('jeanne-dupont')]: { statut: 200, corps: { elements: [{ entityUrn: 'urn:li:company:1' }] } },
    });
    await expect(resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont')).rejects.toMatchObject({
      code: 'profile_not_found',
    });
  });

  it('404 rend profile_not_found', async () => {
    const { p } = pilote({ [URL_PROFIL('jeanne-dupont')]: { statut: 404 } });
    await expect(resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont')).rejects.toMatchObject({
      code: 'profile_not_found',
    });
  });

  it('999 rend le code defi', async () => {
    const { p } = pilote({ [URL_PROFIL('jeanne-dupont')]: { statut: 999 } });
    await expect(resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont')).rejects.toMatchObject({ code: 'defi' });
  });

  it('401 rend not_logged_in, 403 aussi (le jeton CSRF ou la session sont refuses)', async () => {
    for (const statut of [401, 403]) {
      const { p } = pilote({ [URL_PROFIL('jeanne-dupont')]: { statut } });
      await expect(resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont')).rejects.toMatchObject({
        code: 'not_logged_in',
      });
    }
  });

  it('429 rend restricted', async () => {
    const { p } = pilote({ [URL_PROFIL('jeanne-dupont')]: { statut: 429 } });
    await expect(resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont')).rejects.toMatchObject({
      code: 'restricted',
    });
  });

  it('une URL sans identifiant de profil rend invalid_url sans appeler LinkedIn', async () => {
    for (const url of [
      'https://www.linkedin.com/company/acme',
      'https://www.linkedin.com/in/',
      'https://www.linkedin.com/',
      'pas une url',
      'https://exemple.com/in/jeanne-dupont',
      'https://evillinkedin.com/in/jeanne-dupont',
      'https://www.linkedin.com/in/%E0%A4%A',
    ]) {
      const { p, appels, pages } = pilote({});
      await expect(resoudreProfil(p, url)).rejects.toMatchObject({ code: 'invalid_url' });
      expect(appels, url).toEqual([]);
      expect(pages, url).toEqual([]);
    }
  });

  it("encode l'identifiant dans la requete", async () => {
    const { p, appels } = pilote({
      [URL_PROFIL(encodeURIComponent('jeanne dupont-é'))]: { statut: 200, corps: { elements: [{ entityUrn: URN_DESTINATAIRE }] } },
    });
    await resoudreProfil(p, 'https://www.linkedin.com/in/jeanne%20dupont-%C3%A9');
    expect(appels[0]!.url).toBe(URL_PROFIL(encodeURIComponent('jeanne dupont-é')));
  });

  it("n'accepte pas un statut inattendu en silence, et son erreur ne porte pas le corps de la reponse", async () => {
    const { p } = pilote({ [URL_PROFIL('jeanne-dupont')]: { statut: 502, corps: 'proxy://user:SECRET@hote' } });
    const erreur = await resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont').catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(Error);
    expect((erreur as Error).name).toBe('StatutInattendu');
    expect((erreur as Error).message).not.toContain('SECRET');
  });

  it('envoie les en-tetes Voyager sans csrf-token (le pilote le pose)', async () => {
    const { p, appels } = pilote(profilResolu());
    await resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont');
    expect(appels[0]!.entetes).toMatchObject({
      accept: 'application/vnd.linkedin.normalized+json+2.1',
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'fr_FR',
    });
    expect(Object.keys(appels[0]!.entetes ?? {}).map((k) => k.toLowerCase())).not.toContain('csrf-token');
  });

  it("navigue vers le fil avant l'appel quand la page n'est pas sur LinkedIn, pas quand elle y est deja", async () => {
    const a = pilote(profilResolu(), 'about:blank');
    await resoudreProfil(a.p, 'https://www.linkedin.com/in/jeanne-dupont');
    expect(a.pages).toEqual([FEED]);

    const b = pilote(profilResolu(), 'https://www.linkedin.com/feed/');
    await resoudreProfil(b.p, 'https://www.linkedin.com/in/jeanne-dupont');
    expect(b.pages).toEqual([]);
  });
});

describe('envoyerInvitation', () => {
  it('poste le corps exact, sans note', async () => {
    const { p, appels } = pilote({ [URL_INVITATION]: { statut: 201 } }, FEED);
    await expect(envoyerInvitation(p, URN_DESTINATAIRE, null)).resolves.toEqual({ ok: true });
    expect(appels).toEqual([
      {
        url: URL_INVITATION,
        entetes: expect.objectContaining({ 'x-li-lang': 'fr_FR' }),
        corps: { invitee: { inviteeUnion: { memberProfile: URN_DESTINATAIRE } } },
      },
    ]);
  });

  it("refuse sans appeler LinkedIn une invitation avec note : le champ de la note n'a jamais ete releve", async () => {
    const { p, appels } = pilote({});
    await expect(envoyerInvitation(p, URN_DESTINATAIRE, 'Bonjour')).resolves.toEqual({ ok: false, code: 'bad_request' });
    expect(appels).toEqual([]);
  });

  it("refuse sans appeler LinkedIn un URN qui n'est pas un profil", async () => {
    const { p, appels } = pilote({});
    await expect(envoyerInvitation(p, 'urn:li:company:1', null)).resolves.toEqual({ ok: false, code: 'bad_request' });
    expect(appels).toEqual([]);
  });

  it('999 rend le code defi', async () => {
    const { p } = pilote({ [URL_INVITATION]: { statut: 999 } }, FEED);
    await expect(envoyerInvitation(p, URN_DESTINATAIRE, null)).resolves.toEqual({ ok: false, code: 'defi' });
  });

  it('401 rend not_logged_in', async () => {
    const { p } = pilote({ [URL_INVITATION]: { statut: 401 } }, FEED);
    await expect(envoyerInvitation(p, URN_DESTINATAIRE, null)).resolves.toEqual({ ok: false, code: 'not_logged_in' });
  });

  it('403 rend not_logged_in : la session est arretee plutot que de continuer a envoyer', async () => {
    const { p } = pilote({ [URL_INVITATION]: { statut: 403 } }, FEED);
    await expect(envoyerInvitation(p, URN_DESTINATAIRE, null)).resolves.toEqual({ ok: false, code: 'not_logged_in' });
  });

  it('429 rend restricted', async () => {
    const { p } = pilote({ [URL_INVITATION]: { statut: 429 } }, FEED);
    await expect(envoyerInvitation(p, URN_DESTINATAIRE, null)).resolves.toEqual({ ok: false, code: 'restricted' });
  });

  it('400 rend bad_request', async () => {
    const { p } = pilote({ [URL_INVITATION]: { statut: 400 } }, FEED);
    await expect(envoyerInvitation(p, URN_DESTINATAIRE, null)).resolves.toEqual({ ok: false, code: 'bad_request' });
  });

  it('422 sur une invitation rend already_invited ou cannot_invite', async () => {
    const cas: [unknown, string][] = [
      [{ message: 'You have already invited this person' }, 'already_invited'],
      [{ code: 'CANT_RESEND_YET', message: 'x' }, 'already_invited'],
      [{ message: 'Weekly invitation limit reached' }, 'restricted'],
      [{ message: 'Impossible' }, 'cannot_invite'],
      ['pas du json', 'cannot_invite'],
      [{ message: 42 }, 'cannot_invite'],
    ];
    for (const [corps, code] of cas) {
      const { p } = pilote({ [URL_INVITATION]: { statut: 422, corps } }, FEED);
      await expect(envoyerInvitation(p, URN_DESTINATAIRE, null), JSON.stringify(corps)).resolves.toEqual({
        ok: false,
        code,
      });
    }
  });

  it("un statut inattendu leve une erreur nommee : on ne sait pas si l'invitation est partie, rien ne doit la rejouer", async () => {
    const { p } = pilote({ [URL_INVITATION]: { statut: 500, corps: 'SECRET' } }, FEED);
    const erreur = await envoyerInvitation(p, URN_DESTINATAIRE, null).catch((e: unknown) => e);
    expect((erreur as Error).name).toBe('StatutInattendu');
    expect((erreur as Error).message).not.toContain('SECRET');
  });

  it("navigue vers le fil d'abord quand la page n'est pas sur LinkedIn", async () => {
    const { p, pages } = pilote({ [URL_INVITATION]: { statut: 200 } });
    await envoyerInvitation(p, URN_DESTINATAIRE, null);
    expect(pages).toEqual([FEED]);
  });
});

describe('envoyerMessage', () => {
  it("lit l'expediteur sur /me (une reference, resolue dans included) puis poste le corps exact", async () => {
    const { p, appels } = pilote({ ...moi, [URL_MESSAGE]: { statut: 200 } }, FEED);
    await expect(envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour Jeanne')).resolves.toEqual({ ok: true });
    expect(appels.map((a) => a.url)).toEqual([URL_ME, URL_MESSAGE]);
    const corps = appels[1]!.corps as Record<string, unknown>;
    expect(corps).toEqual({
      message: {
        body: { text: 'Bonjour Jeanne', attributes: [] },
        renderContentUnions: [],
        originToken: expect.any(String),
      },
      mailboxUrn: URN_EXPEDITEUR,
      trackingId: expect.any(String),
      dedupeByClientGeneratedToken: false,
      hostRecipientUrns: [URN_DESTINATAIRE],
    });
  });

  it("l'originToken vit DANS message, jamais a la racine (sinon LinkedIn repond 400)", async () => {
    const { p, appels } = pilote({ ...moi, [URL_MESSAGE]: { statut: 200 } }, FEED);
    await envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour');
    const corps = appels[1]!.corps as { originToken?: unknown; message: { originToken?: unknown } };
    expect(corps.originToken).toBeUndefined();
    expect(typeof corps.message.originToken).toBe('string');
    expect((corps.message.originToken as string).length).toBeGreaterThan(0);
  });

  it('le trackingId fait 16 octets bruts et change a chaque envoi', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const { p, appels } = pilote({ ...moi, [URL_MESSAGE]: { statut: 200 } }, FEED);
      await envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour');
      ids.push((appels[1]!.corps as { trackingId: string }).trackingId);
    }
    for (const id of ids) {
      expect(id).toHaveLength(16);
      expect([...id].every((c) => c.charCodeAt(0) <= 255)).toBe(true);
    }
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("choisit dans included le profil qui porte notre identifiant public quand /me n'a pas de reference", async () => {
    const { p, appels } = pilote(
      {
        [URL_ME]: {
          statut: 200,
          corps: {
            data: { publicIdentifier: 'moi' },
            included: [
              { entityUrn: 'urn:li:fsd_profile:ACoAAautre', publicIdentifier: 'autre' },
              { entityUrn: URN_EXPEDITEUR, publicIdentifier: 'moi' },
            ],
          },
        },
        [URL_MESSAGE]: { statut: 200 },
      },
      FEED,
    );
    await envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour');
    expect((appels[1]!.corps as { mailboxUrn: string }).mailboxUrn).toBe(URN_EXPEDITEUR);
  });

  it("n'envoie rien quand l'expediteur est introuvable, avec une erreur nommee", async () => {
    const { p, appels } = pilote({ [URL_ME]: { statut: 200, corps: { data: {} } } }, FEED);
    const erreur = await envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour').catch((e: unknown) => e);
    expect((erreur as Error).name).toBe('ExpediteurIntrouvable');
    expect(appels.map((a) => a.url)).toEqual([URL_ME]);
  });

  it('refuse sans appeler LinkedIn un texte vide ou un URN qui nest pas un profil', async () => {
    for (const [urn, texte] of [
      [URN_DESTINATAIRE, '   '],
      [URN_DESTINATAIRE, ''],
      ['urn:li:company:1', 'Bonjour'],
    ] as const) {
      const { p, appels } = pilote({});
      await expect(envoyerMessage(p, urn, texte)).resolves.toEqual({ ok: false, code: 'bad_request' });
      expect(appels).toEqual([]);
    }
  });

  it('999 rend le code defi, sur /me comme sur le message', async () => {
    const a = pilote({ [URL_ME]: { statut: 999 } }, FEED);
    await expect(envoyerMessage(a.p, URN_DESTINATAIRE, 'Bonjour')).resolves.toEqual({ ok: false, code: 'defi' });
    expect(a.appels.map((x) => x.url)).toEqual([URL_ME]);

    const b = pilote({ ...moi, [URL_MESSAGE]: { statut: 999 } }, FEED);
    await expect(envoyerMessage(b.p, URN_DESTINATAIRE, 'Bonjour')).resolves.toEqual({ ok: false, code: 'defi' });
  });

  it('401 rend not_logged_in, sur /me comme sur le message', async () => {
    const a = pilote({ [URL_ME]: { statut: 401 } }, FEED);
    await expect(envoyerMessage(a.p, URN_DESTINATAIRE, 'Bonjour')).resolves.toEqual({ ok: false, code: 'not_logged_in' });
    const b = pilote({ ...moi, [URL_MESSAGE]: { statut: 401 } }, FEED);
    await expect(envoyerMessage(b.p, URN_DESTINATAIRE, 'Bonjour')).resolves.toEqual({ ok: false, code: 'not_logged_in' });
  });

  it('429 rend restricted', async () => {
    const { p } = pilote({ ...moi, [URL_MESSAGE]: { statut: 429 } }, FEED);
    await expect(envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour')).resolves.toEqual({ ok: false, code: 'restricted' });
  });

  it('400 rend bad_request', async () => {
    const { p } = pilote({ ...moi, [URL_MESSAGE]: { statut: 400 } }, FEED);
    await expect(envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour')).resolves.toEqual({ ok: false, code: 'bad_request' });
  });

  it('un message vers une relation hors premier degre rend cannot_message', async () => {
    for (const statut of [403, 422]) {
      const { p } = pilote({ ...moi, [URL_MESSAGE]: { statut, corps: { message: 'Not allowed' } } }, FEED);
      await expect(envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour'), String(statut)).resolves.toEqual({
        ok: false,
        code: 'cannot_message',
      });
    }
  });

  it('un 403 ou 422 qui parle de plafond rend restricted', async () => {
    const { p } = pilote({ ...moi, [URL_MESSAGE]: { statut: 422, corps: { message: 'Daily quota exceeded' } } }, FEED);
    await expect(envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour')).resolves.toEqual({ ok: false, code: 'restricted' });
  });

  it("un statut inattendu sur le message leve une erreur nommee sans le corps", async () => {
    const { p } = pilote({ ...moi, [URL_MESSAGE]: { statut: 503, corps: 'SECRET' } }, FEED);
    const erreur = await envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour').catch((e: unknown) => e);
    expect((erreur as Error).name).toBe('StatutInattendu');
    expect((erreur as Error).message).not.toContain('SECRET');
  });
});
