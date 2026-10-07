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
): { p: Pilote; appels: Appel[]; pages: string[]; journal: string[] } {
  const appels: Appel[] = [];
  const pages: string[] = [];
  /** Navigations et requetes dans l'ordre exact ou elles ont eu lieu. */
  const journal: string[] = [];
  let courante = urlCourante;
  const p: Pilote = {
    aller: async (url) => {
      journal.push(`aller ${url}`);
      pages.push(url);
      courante = url;
    },
    url: async () => courante,
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '',
    attendre: async () => true,
    requete: async (url, entetes, corps) => {
      journal.push(`requete ${url}`);
      appels.push({ url, entetes, corps });
      const r = reponses[url];
      if (!r) throw new Error(`requete non prevue : ${url}`);
      return { statut: r.statut, corps: typeof r.corps === 'string' ? r.corps : JSON.stringify(r.corps ?? {}) };
    },
    fermer: async () => undefined,
  };
  return { p, appels, pages, journal };
}

const profilResolu = (vanity = 'jeanne-dupont'): Record<string, Reponse> => ({
  [URL_PROFIL(vanity)]: {
    statut: 200,
    corps: { elements: [{ entityUrn: URN_DESTINATAIRE, publicIdentifier: vanity }] },
  },
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
      [URL_PROFIL('jeanne-dupont')]: {
        statut: 200,
        corps: { elements: [{ entityUrn: 'urn:li:company:1', publicIdentifier: 'jeanne-dupont' }] },
      },
    });
    await expect(resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont')).rejects.toMatchObject({
      code: 'profile_not_found',
    });
  });

  it("un profil renvoye pour un autre identifiant rend profile_not_found, sur les deux chemins", async () => {
    const voisin = pilote({
      [URL_PROFIL('jeanne-dupont')]: {
        statut: 200,
        corps: { elements: [{ entityUrn: URN_DESTINATAIRE, publicIdentifier: 'jean-voisin' }] },
      },
    });
    await expect(resoudreProfil(voisin.p, 'https://www.linkedin.com/in/jeanne-dupont')).rejects.toMatchObject({
      code: 'profile_not_found',
    });
    const sansIdentifiant = pilote({
      [URL_PROFIL('jeanne-dupont')]: { statut: 200, corps: { elements: [{ entityUrn: URN_DESTINATAIRE }] } },
    });
    await expect(resoudreProfil(sansIdentifiant.p, 'https://www.linkedin.com/in/jeanne-dupont')).rejects.toMatchObject({
      code: 'profile_not_found',
    });
    const inclusVoisin = pilote({
      [URL_PROFIL('jeanne-dupont')]: {
        statut: 200,
        corps: { included: [{ entityUrn: URN_DESTINATAIRE, publicIdentifier: 'jean-voisin' }] },
      },
    });
    await expect(resoudreProfil(inclusVoisin.p, 'https://www.linkedin.com/in/jeanne-dupont')).rejects.toMatchObject({
      code: 'profile_not_found',
    });
  });

  it("lit l'identifiant de l'element dans included quand l'element n'est qu'une reference", async () => {
    const { p } = pilote({
      [URL_PROFIL('jeanne-dupont')]: {
        statut: 200,
        corps: {
          elements: [{ '*entityUrn': URN_DESTINATAIRE }],
          included: [{ entityUrn: URN_DESTINATAIRE, publicIdentifier: 'jeanne-dupont' }],
        },
      },
    });
    await expect(resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont')).resolves.toBe(URN_DESTINATAIRE);
  });

  it("compare l'identifiant sans tenir compte de la casse", async () => {
    const { p, appels } = pilote({
      [URL_PROFIL('Jeanne-Dupont')]: {
        statut: 200,
        corps: { elements: [{ entityUrn: URN_DESTINATAIRE, publicIdentifier: 'jeanne-dupont' }] },
      },
    });
    await expect(resoudreProfil(p, 'https://www.linkedin.com/in/Jeanne-Dupont')).resolves.toBe(URN_DESTINATAIRE);
    expect(appels).toHaveLength(1);
  });

  it('accepte les formes legitimes qu on trouve dans un fichier importe', async () => {
    for (const url of [
      'https://www.linkedin.com/mwlite/in/jeanne-dupont',
      'https://www.linkedin.com/pub/jeanne-dupont/1/2/3',
      'https://www.linkedin.com/IN/jeanne-dupont',
      'https://www.linkedin.com./in/jeanne-dupont',
      'https://fr.linkedin.com/in/jeanne-dupont/?trk=x',
    ]) {
      const { p } = pilote(profilResolu());
      await expect(resoudreProfil(p, url), url).resolves.toBe(URN_DESTINATAIRE);
    }
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
      [URL_PROFIL(encodeURIComponent('jeanne dupont-é'))]: {
        statut: 200,
        corps: { elements: [{ entityUrn: URN_DESTINATAIRE, publicIdentifier: 'jeanne dupont-é' }] },
      },
    });
    await resoudreProfil(p, 'https://www.linkedin.com/in/jeanne%20dupont-%C3%A9');
    expect(appels[0]!.url).toBe(URL_PROFIL(encodeURIComponent('jeanne dupont-é')));
  });

  it("n'accepte pas un statut inattendu en silence, et son erreur ne porte pas le corps de la reponse", async () => {
    const { p } = pilote({ [URL_PROFIL('jeanne-dupont')]: { statut: 502, corps: 'proxy://user:SECRET@hote' } });
    const erreur = await resoudreProfil(p, 'https://www.linkedin.com/in/jeanne-dupont').catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(Error);
    expect((erreur as Error).name).toBe('StatutInattenduResolution');
    expect((erreur as Error).message).toBe('LinkedIn a répondu 502');
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

  it("navigue vers le fil AVANT l'appel quand la page n'est pas sur LinkedIn, pas quand elle y est deja", async () => {
    const a = pilote(profilResolu(), 'about:blank');
    await resoudreProfil(a.p, 'https://www.linkedin.com/in/jeanne-dupont');
    expect(a.journal).toEqual([`aller ${FEED}`, `requete ${URL_PROFIL('jeanne-dupont')}`]);

    const b = pilote(profilResolu(), 'https://www.linkedin.com/feed/');
    await resoudreProfil(b.p, 'https://www.linkedin.com/in/jeanne-dupont');
    expect(b.journal).toEqual([`requete ${URL_PROFIL('jeanne-dupont')}`]);
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

  it("refuse sans appeler LinkedIn une note reelle : le champ de la note n'a jamais ete releve", async () => {
    const { p, appels } = pilote({});
    await expect(envoyerInvitation(p, URN_DESTINATAIRE, 'Bonjour')).resolves.toEqual({
      ok: false,
      code: 'note_non_supportee',
    });
    expect(appels).toEqual([]);
  });

  it('une note vide ou blanche vaut absence : l invitation part', async () => {
    for (const note of ['', '   ', '\n\t']) {
      const { p, appels } = pilote({ [URL_INVITATION]: { statut: 200 } }, FEED);
      await expect(envoyerInvitation(p, URN_DESTINATAIRE, note), JSON.stringify(note)).resolves.toEqual({ ok: true });
      expect(appels).toHaveLength(1);
      expect(appels[0]!.corps).toEqual({ invitee: { inviteeUnion: { memberProfile: URN_DESTINATAIRE } } });
    }
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
    expect((erreur as Error).name).toBe('StatutInattenduInvitation');
    expect((erreur as Error).message).toBe('LinkedIn a répondu 500');
    expect((erreur as Error).message).not.toContain('SECRET');
  });

  it('un 202 n est PAS un succes : seuls 200 et 201 le sont, le reste est une action au sort inconnu', async () => {
    for (const statut of [202, 204, 299]) {
      const { p } = pilote({ [URL_INVITATION]: { statut } }, FEED);
      const erreur = await envoyerInvitation(p, URN_DESTINATAIRE, null).catch((e: unknown) => e);
      expect((erreur as Error).name, String(statut)).toBe('StatutInattenduInvitation');
    }
  });

  it("navigue vers le fil d'abord quand la page n'est pas sur LinkedIn", async () => {
    const { p, pages } = pilote({ [URL_INVITATION]: { statut: 200 } });
    await envoyerInvitation(p, URN_DESTINATAIRE, null);
    expect(pages).toEqual([FEED]);
  });
});

describe('envoyerMessage', () => {
  it("lit l'expediteur sur /me (la reference *miniProfile, normalisee en fsd_profile) puis poste le corps exact", async () => {
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

  it('le trackingId est une chaine de 16 octets bruts (pas de base64 ni d hexadecimal) et change a chaque envoi', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const { p, appels } = pilote({ ...moi, [URL_MESSAGE]: { statut: 200 } }, FEED);
      await envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour');
      ids.push((appels[1]!.corps as { trackingId: string }).trackingId);
    }
    for (const id of ids) {
      expect(id).toHaveLength(16);
      expect([...id].every((c) => c.charCodeAt(0) <= 255)).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
    // Des octets bruts depassent 127 : 20 tirages de 16 sans un seul tel octet n'arrivent pas
    // (2^-320). Un passage a du base64 ou a de l'hexadecimal le ferait echouer, en plus de la longueur.
    expect(ids.some((id) => [...id].some((c) => c.charCodeAt(0) > 127))).toBe(true);
  });

  it("sans reference, retient dans included (en fs_miniProfile, forme reelle) le profil qui porte NOTRE identifiant", async () => {
    const { p, appels } = pilote(
      {
        [URL_ME]: {
          statut: 200,
          corps: {
            data: { publicIdentifier: 'Moi' },
            included: [
              { entityUrn: 'urn:li:fs_miniProfile:ACoAAautre', publicIdentifier: 'autre' },
              { entityUrn: 'urn:li:fs_miniProfile:ACoAAexpediteur', publicIdentifier: 'moi' },
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

  it("n'ecrit JAMAIS depuis un profil sans correspondance d'identifiant : ExpediteurIntrouvable, rien n'est envoye", async () => {
    const corpsMe: unknown[] = [
      // aucun profil ne correspond
      { data: { publicIdentifier: 'moi' }, included: [{ entityUrn: 'urn:li:fs_miniProfile:ACoAAautre', publicIdentifier: 'autre' }] },
      // un seul profil, mais on ne connait pas notre identifiant
      { data: {}, included: [{ entityUrn: 'urn:li:fs_miniProfile:ACoAAautre', publicIdentifier: 'autre' }] },
      // plusieurs profils, identifiant inconnu : pas de « premier venu »
      {
        data: {},
        included: [
          { entityUrn: 'urn:li:fs_miniProfile:ACoAAun', publicIdentifier: 'un' },
          { entityUrn: 'urn:li:fs_miniProfile:ACoAAdeux', publicIdentifier: 'deux' },
        ],
      },
    ];
    for (const corps of corpsMe) {
      const { p, appels } = pilote({ [URL_ME]: { statut: 200, corps } }, FEED);
      const erreur = await envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour').catch((e: unknown) => e);
      expect((erreur as Error).name, JSON.stringify(corps)).toBe('ExpediteurIntrouvable');
      expect(appels.map((a) => a.url)).toEqual([URL_ME]);
    }
  });

  it("ne memorise ni ExpediteurIntrouvable ni StatutInattenduExpediteur : le second appel rappelle /me", async () => {
    const cas: [string, Reponse][] = [
      ['ExpediteurIntrouvable', { statut: 200, corps: { data: {} } }],
      ['StatutInattenduExpediteur', { statut: 500 }],
    ];
    for (const [nom, echec] of cas) {
      const reponses: Record<string, Reponse> = { [URL_ME]: echec };
      const { p, appels } = pilote(reponses, FEED);
      const erreur = await envoyerMessage(p, URN_DESTINATAIRE, 'Un').catch((e: unknown) => e);
      expect((erreur as Error).name).toBe(nom);
      // Le second appel doit REINTERROGER /me, puis partir avec le bon mailboxUrn.
      Object.assign(reponses, moi, { [URL_MESSAGE]: { statut: 200 } });
      await expect(envoyerMessage(p, URN_DESTINATAIRE, 'Deux'), nom).resolves.toEqual({ ok: true });
      expect(appels.map((a) => a.url), nom).toEqual([URL_ME, URL_ME, URL_MESSAGE]);
      expect((appels[2]!.corps as { mailboxUrn: string }).mailboxUrn, nom).toBe(URN_EXPEDITEUR);
    }
  });

  it("ne rappelle /me qu'une fois par session, et ne memorise pas un echec", async () => {
    const { p, appels } = pilote({ ...moi, [URL_MESSAGE]: { statut: 200 } }, FEED);
    await envoyerMessage(p, URN_DESTINATAIRE, 'Un');
    await envoyerMessage(p, URN_DESTINATAIRE, 'Deux');
    expect(appels.map((a) => a.url)).toEqual([URL_ME, URL_MESSAGE, URL_MESSAGE]);

    const reponses: Record<string, Reponse> = { [URL_ME]: { statut: 401 } };
    const b = pilote(reponses, FEED);
    await expect(envoyerMessage(b.p, URN_DESTINATAIRE, 'Un')).resolves.toEqual({ ok: false, code: 'not_logged_in' });
    Object.assign(reponses, moi, { [URL_MESSAGE]: { statut: 200 } });
    await expect(envoyerMessage(b.p, URN_DESTINATAIRE, 'Deux')).resolves.toEqual({ ok: true });
  });

  it("n'envoie rien quand l'expediteur est introuvable, avec une erreur nommee", async () => {
    const { p, appels } = pilote({ [URL_ME]: { statut: 200, corps: { data: {} } } }, FEED);
    const erreur = await envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour').catch((e: unknown) => e);
    expect((erreur as Error).name).toBe('ExpediteurIntrouvable');
    expect(appels.map((a) => a.url)).toEqual([URL_ME]);
  });

  it("un statut inattendu sur /me leve StatutInattenduExpediteur (un GET : rien n'est parti)", async () => {
    const { p, appels } = pilote({ [URL_ME]: { statut: 500, corps: 'SECRET' } }, FEED);
    const erreur = await envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour').catch((e: unknown) => e);
    expect((erreur as Error).name).toBe('StatutInattenduExpediteur');
    expect((erreur as Error).message).toBe('LinkedIn a répondu 500');
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
    expect((erreur as Error).name).toBe('StatutInattenduMessage');
    expect((erreur as Error).message).toBe('LinkedIn a répondu 503');
    expect((erreur as Error).message).not.toContain('SECRET');
  });

  it('un 202 sur le message leve StatutInattenduMessage', async () => {
    const { p } = pilote({ ...moi, [URL_MESSAGE]: { statut: 202 } }, FEED);
    const erreur = await envoyerMessage(p, URN_DESTINATAIRE, 'Bonjour').catch((e: unknown) => e);
    expect((erreur as Error).name).toBe('StatutInattenduMessage');
  });
});
