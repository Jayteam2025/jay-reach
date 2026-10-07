/**
 * Tâche 5 (lot 4b) : le handler d'envoi LinkedIn.
 *
 * Ce fichier prouve L'ENCHAÎNEMENT des décisions, surtout deux : une action n'est
 * jamais envoyée deux fois, et une session refusée arrête le canal. Le pool est
 * factice et les fonctions de file sont doublées : rien ici ne prouve le SQL, qui
 * se prouve dans `test/pg-verify`. Aucun test n'ouvre de navigateur ni n'appelle
 * LinkedIn : le pilote est un double qui répond par URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionReclamee, EntreeResultat, ResultatReclamation } from '@jay-reach/core';
import type { Pilote } from '../linkedin/navigateur.js';

const mocks = vi.hoisted(() => ({
  reclamer: vi.fn(),
  enregistrer: vi.fn(),
  pause: vi.fn(),
}));

vi.mock('@jay-reach/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@jay-reach/core')>();
  return {
    ...original,
    reclamerProchaineAction: mocks.reclamer,
    enregistrerResultat: mocks.enregistrer,
    mettreEnPauseEnvoiLinkedIn: mocks.pause,
  };
});

vi.mock('../linkedin/envoi.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../linkedin/envoi.js')>();
  return {
    ...original,
    envoyerInvitation: vi.fn(original.envoyerInvitation),
    envoyerMessage: vi.fn(original.envoyerMessage),
  };
});

import { envoyerInvitation } from '../linkedin/envoi.js';
import { traiterEnvoiLinkedIn, type DependancesEnvoi } from './envoi-linkedin.js';

// ------------------------------------------------------------------ constantes

const URL_PROFIL = (v: string) =>
  `https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${v}`;
const URL_INVITATION =
  'https://www.linkedin.com/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2';
const URL_MESSAGE = 'https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage';
const URL_ME = 'https://www.linkedin.com/voyager/api/me';
const URN = 'urn:li:fsd_profile:ACoAAdestinataire';
const PROFIL_OK = { statut: 200, corps: { elements: [{ entityUrn: URN, publicIdentifier: 'jeanne-dupont' }] } };
const ME_OK = {
  statut: 200,
  corps: {
    data: { '*miniProfile': 'urn:li:fs_miniProfile:ACoAAexpediteur' },
    included: [{ entityUrn: 'urn:li:fs_miniProfile:ACoAAexpediteur', publicIdentifier: 'moi' }],
  },
};
const ORG = 'org-1';
const JOB = { organizationId: ORG };

const ACTION_INVITATION: ActionReclamee = {
  id: 'q-1',
  kind: 'invite',
  linkedinUrl: 'https://www.linkedin.com/in/jeanne-dupont/',
  messageBody: null,
};
const ACTION_MESSAGE: ActionReclamee = { ...ACTION_INVITATION, kind: 'message', messageBody: 'Bonjour Jeanne' };

// ----------------------------------------------------------------------- doubles

type Reponse = { statut: number; corps?: unknown } | Error;

interface Monde {
  /** Tout ce qui s'est passé, dans l'ordre : trace, requête, verrou, blocage... */
  journal: string[];
  /** Statut de la ligne, tenu comme le ferait la base. */
  statut: 'absente' | 'pending' | 'processing' | 'sent' | 'failed';
  /** Statut de la ligne au moment précis de chaque requête sortante. */
  statutsAuxRequetes: string[];
  remises: { comptee: boolean }[];
  pilote: Pilote;
  fermer: ReturnType<typeof vi.fn>;
  ouvrir: ReturnType<typeof vi.fn>;
  releve: ReturnType<typeof vi.fn>;
  pool: DependancesEnvoi['pool'];
}

function monde(opts: {
  reponses?: Record<string, Reponse>;
  session?: { status: string; expected_egress_ip: string | null } | null;
  verrou?: boolean;
  fuseau?: string;
  ouvrirEchoue?: boolean;
  traceEchoue?: boolean;
}): Monde {
  const w: Monde = {
    journal: [],
    statut: 'absente',
    statutsAuxRequetes: [],
    remises: [],
    pilote: undefined as unknown as Pilote,
    fermer: vi.fn(async () => undefined),
    ouvrir: vi.fn(),
    releve: vi.fn(async () => ({ ip: '203.0.113.7' })),
    pool: undefined as unknown as DependancesEnvoi['pool'],
  };
  const rep = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const query = async (sql: string, params: unknown[] = []) => {
    const t = String(sql);
    if (t.includes('jr:linkedin_session_lire')) {
      const s = opts.session === undefined ? { status: 'active', expected_egress_ip: null } : opts.session;
      return rep(s ? [s] : []);
    }
    if (t.includes('jr:linkedin_session_verrou')) {
      w.journal.push(`verrou ${params[1]} ${params[2]}`);
      return rep(opts.verrou === false ? [] : [{}]);
    }
    if (t.includes('jr:linkedin_session_bloquer')) {
      w.journal.push(`bloquer ${params[1]}`);
      return rep([{}]);
    }
    if (t.includes('jr:linkedin_session_observer')) return rep([]);
    if (t.includes('jr:linkedin_fuseau')) return rep([{ timezone: opts.fuseau ?? 'Europe/Paris' }]);
    if (t.includes('jr:linkedin_envoi_tracer')) {
      if (opts.traceEchoue) throw new Error('base indisponible');
      w.journal.push('trace');
      return rep([{}]);
    }
    if (t.includes('jr:linkedin_action_remettre')) {
      w.journal.push('remise');
      w.remises.push({ comptee: params[2] === true });
      w.statut = 'pending';
      return rep([{}]);
    }
    if (t.includes('begin') || t.includes('commit') || t.includes('rollback')) return rep([]);
    w.journal.push(`autre ${t.trim().slice(0, 40)}`);
    return rep([]);
  };
  w.pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as DependancesEnvoi['pool'];

  w.pilote = {
    aller: async (u) => {
      w.journal.push(`aller ${u}`);
    },
    url: async () => 'https://www.linkedin.com/feed/',
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '',
    attendre: async () => true,
    requete: async (u, _e, corps) => {
      w.journal.push(`requete ${u}`);
      if (corps !== undefined) w.statutsAuxRequetes.push(w.statut);
      const r = opts.reponses?.[u];
      if (!r) throw new Error(`requete non prevue : ${u}`);
      if (r instanceof Error) throw r;
      return { statut: r.statut, corps: typeof r.corps === 'string' ? r.corps : JSON.stringify(r.corps ?? {}) };
    },
    fermer: w.fermer as unknown as Pilote['fermer'],
  };
  w.ouvrir = vi.fn(async () => {
    if (opts.ouvrirEchoue) throw new Error('http://user:motdepasse@proxy.example:8080 injoignable');
    return w.pilote;
  });
  mocks.reclamer.mockImplementation(async (): Promise<ResultatReclamation> => {
    w.journal.push('reclamer');
    w.statut = 'processing';
    return { action: ACTION_INVITATION, motif: null };
  });
  mocks.enregistrer.mockImplementation(async (_ex: unknown, e: EntreeResultat) => {
    w.journal.push(`enregistrer ${e.status}`);
    w.statut = e.status;
    return true;
  });
  mocks.pause.mockImplementation(async (_ex: unknown, _org: string, jusqua: Date) => {
    w.journal.push(`pause ${jusqua.toISOString()}`);
    return true;
  });
  return w;
}

function deps(w: Monde, extra: Partial<DependancesEnvoi> = {}): DependancesEnvoi {
  return {
    pool: w.pool,
    env: { JAY_REACH_LINKEDIN: '1' },
    ouvrirNavigateur: w.ouvrir as unknown as DependancesEnvoi['ouvrirNavigateur'],
    releverSortie: w.releve as unknown as DependancesEnvoi['releverSortie'],
    pause: async () => undefined,
    ...extra,
  };
}

const avec = (w: Monde, a: ActionReclamee) =>
  mocks.reclamer.mockImplementation(async (): Promise<ResultatReclamation> => {
    w.journal.push('reclamer');
    w.statut = 'processing';
    return { action: a, motif: null };
  });
const POST = [URL_INVITATION, URL_MESSAGE];
const envoyees = (w: Monde) => w.journal.filter((j) => POST.some((u) => j === `requete ${u}`));
const enregistrements = () => mocks.enregistrer.mock.calls.map((c) => c[1] as EntreeResultat);

beforeEach(() => {
  mocks.reclamer.mockReset();
  mocks.enregistrer.mockReset();
  mocks.pause.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ------------------------------------------------------------------------ tests

describe('les gardes avant tout appel LinkedIn', () => {
  it('sans session active, rien n est tente et le navigateur n est pas ouvert', async () => {
    const w = monde({ session: { status: 'bloquee', expected_egress_ip: null } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.ouvrir).not.toHaveBeenCalled();
    expect(mocks.reclamer).not.toHaveBeenCalled();
    expect(w.journal.filter((j) => j.startsWith('requete'))).toEqual([]);
  });

  it('sans ligne de session, rien n est tente', async () => {
    const w = monde({ session: null });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.ouvrir).not.toHaveBeenCalled();
    expect(mocks.reclamer).not.toHaveBeenCalled();
  });

  it('sans JAY_REACH_LINKEDIN, rien n est tente', async () => {
    const w = monde({});
    await traiterEnvoiLinkedIn(deps(w, { env: {} }), JOB);
    expect(w.ouvrir).not.toHaveBeenCalled();
    expect(mocks.reclamer).not.toHaveBeenCalled();
  });

  it('le verrou pris par une collecte fait renoncer l envoi', async () => {
    const w = monde({ verrou: false });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.ouvrir).not.toHaveBeenCalled();
    expect(mocks.reclamer).not.toHaveBeenCalled();
    // Le verrou n'est pas le nôtre : on ne le libère pas.
    expect(w.journal.filter((j) => j.startsWith('verrou'))).toEqual([expect.stringMatching(/^verrou envoi-org-1 [1-9]/)]);
  });

  it('une sortie non conforme arrete avant tout appel LinkedIn', async () => {
    const w = monde({ session: { status: 'active', expected_egress_ip: '198.51.100.1' } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(mocks.reclamer).not.toHaveBeenCalled();
    expect(w.journal.filter((j) => j.startsWith('requete') || j.startsWith('aller'))).toEqual([]);
    expect(w.journal).toContain('bloquer sortie_inattendue');
    expect(w.fermer).toHaveBeenCalledTimes(1);
  });

  it('une relève de sortie qui échoue arrête avant la réclamation', async () => {
    const w = monde({});
    w.releve.mockRejectedValue(new Error('http://u:p@proxy injoignable'));
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(mocks.reclamer).not.toHaveBeenCalled();
    expect(w.fermer).toHaveBeenCalledTimes(1);
  });

  it('un navigateur injoignable arrête avant la réclamation et ne journalise que le nom', async () => {
    const w = monde({ ouvrirEchoue: true });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(mocks.reclamer).not.toHaveBeenCalled();
    const tout = JSON.stringify([...vi.mocked(console.error).mock.calls, ...vi.mocked(console.warn).mock.calls]);
    expect(tout).not.toContain('motdepasse');
    expect(tout).not.toContain('proxy.example');
  });

  it('une réclamation refusée (canal en pause, file vide, session_inactive) arrête le tour proprement', async () => {
    for (const motif of ['canal_en_pause', 'queue_empty', 'session_inactive', 'daily_cap_reached'] as const) {
      const w = monde({});
      mocks.reclamer.mockImplementation(async () => ({ action: null, motif }));
      await expect(traiterEnvoiLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
      expect(w.journal.filter((j) => j.startsWith('requete'))).toEqual([]);
      expect(enregistrements()).toEqual([]);
      expect(w.fermer).toHaveBeenCalledTimes(1);
      expect(w.journal.some((j) => j.startsWith('bloquer'))).toBe(false);
      mocks.enregistrer.mockClear();
    }
  });
});

describe('un envoi qui réussit', () => {
  it('une invitation part SANS note (null), la ligne est déjà processing, puis sent', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: { statut: 201 } } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.statutsAuxRequetes).toEqual(['processing']);
    expect(enregistrements()).toEqual([expect.objectContaining({ organizationId: ORG, queueId: 'q-1', status: 'sent' })]);
    expect(w.statut).toBe('sent');
  });

  it('un message est précédé de la lecture du profil et de l expéditeur', async () => {
    const w = monde({
      reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_ME]: ME_OK, [URL_MESSAGE]: { statut: 201 } },
    });
    avec(w, ACTION_MESSAGE);
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(envoyees(w)).toEqual([`requete ${URL_MESSAGE}`]);
    expect(w.statutsAuxRequetes).toEqual(['processing']);
    expect(enregistrements().map((e) => e.status)).toEqual(['sent']);
  });

  it('un message sans texte n est jamais envoyé', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK } });
    avec(w, { ...ACTION_MESSAGE, messageBody: '   ' });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(envoyees(w)).toEqual([]);
    expect(enregistrements()).toEqual([expect.objectContaining({ status: 'failed', errorCode: 'bad_request' })]);
  });

  it('un job ne traite qu une seule action', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: { statut: 201 } } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(mocks.reclamer).toHaveBeenCalledTimes(1);
  });

  it('chaque appel LinkedIn, navigation comprise, est précédé de sa trace', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: { statut: 201 } } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    const sortants = w.journal.filter((j) => j === 'trace' || j.startsWith('requete') || j.startsWith('aller '));
    expect(sortants.length).toBeGreaterThan(2);
    sortants.forEach((j, i) => {
      if (j !== 'trace') expect(sortants[i - 1], `avant « ${j} »`).toBe('trace');
    });
  });

  it('le verrou est pris au nom de l organisation puis libéré, le navigateur fermé', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: { statut: 201 } } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    const verrous = w.journal.filter((j) => j.startsWith('verrou'));
    expect(verrous).toHaveLength(2);
    expect(verrous[0]).toMatch(/^verrou envoi-org-1 [1-9]/);
    expect(verrous[1]).toBe('verrou envoi-org-1 0');
    expect(w.fermer).toHaveBeenCalledTimes(1);
  });
});

describe('le non-double-envoi', () => {
  it('une action marquee partie n est jamais rejouee : un statut inattendu sur le POST l enregistre comme indéterminée', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: { statut: 502 } } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(envoyees(w)).toHaveLength(1);
    expect(w.statutsAuxRequetes).toEqual(['processing']);
    expect(enregistrements()).toEqual([expect.objectContaining({ status: 'failed', errorCode: 'resultat_indetermine' })]);
    expect(w.remises).toEqual([]);
    expect(w.statut).toBe('failed');
  });

  it('une coupure pendant le POST (erreur réseau) est indéterminée, jamais remise en attente', async () => {
    const w = monde({
      reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: new Error('socket hang up') },
    });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.remises).toEqual([]);
    expect(enregistrements()).toEqual([expect.objectContaining({ status: 'failed', errorCode: 'resultat_indetermine' })]);
  });

  it('un message dont le POST répond mal est indéterminé, jamais rejoué', async () => {
    const w = monde({
      reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_ME]: ME_OK, [URL_MESSAGE]: { statut: 500 } },
    });
    avec(w, ACTION_MESSAGE);
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.remises).toEqual([]);
    expect(enregistrements()).toEqual([expect.objectContaining({ status: 'failed', errorCode: 'resultat_indetermine' })]);
  });

  it('un envoi parti dont l enregistrement échoue n est pas renvoyé : le résultat est retenté, pas l appel', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: { statut: 201 } } });
    mocks.enregistrer.mockRejectedValueOnce(new Error('connexion perdue')).mockResolvedValueOnce(true);
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(envoyees(w)).toHaveLength(1);
    expect(mocks.enregistrer).toHaveBeenCalledTimes(2);
    expect(w.remises).toEqual([]);
  });

  it('un enregistrement qui échoue toujours ne remet JAMAIS la ligne en attente et fait échouer le job sans fuite', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: { statut: 201 } } });
    mocks.enregistrer.mockRejectedValue(new Error('postgres://u:secret@hote/base'));
    const echec = await traiterEnvoiLinkedIn(deps(w), JOB).then(
      () => null,
      (e: unknown) => e,
    );
    expect(echec).toBeInstanceOf(Error);
    expect(String((echec as Error).message)).not.toContain('secret');
    expect(envoyees(w)).toHaveLength(1);
    expect(w.remises).toEqual([]);
    expect(w.fermer).toHaveBeenCalledTimes(1);
  });
});

describe('une lecture qui échoue : rien n est parti', () => {
  it('un statut inattendu sur la lecture du profil remet l action en attente, tentative comptée', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: { statut: 500 } } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(envoyees(w)).toEqual([]);
    expect(w.remises).toEqual([{ comptee: true }]);
    expect(mocks.enregistrer).not.toHaveBeenCalled();
  });

  it('une erreur réseau pendant la lecture du profil remet l action en attente', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: new Error('socket hang up') } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.remises).toEqual([{ comptee: true }]);
    expect(mocks.enregistrer).not.toHaveBeenCalled();
  });

  it('une trace impossible avant le POST : rien n est parti, l action retourne en attente', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK }, traceEchoue: true });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.journal.filter((j) => j.startsWith('requete'))).toEqual([]);
    expect(w.remises).toEqual([{ comptee: true }]);
  });

  it('la lecture de l expéditeur qui répond mal (GET) ne perd pas le message : il retourne en attente', async () => {
    const w = monde({
      reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_ME]: { statut: 500 }, [URL_MESSAGE]: { statut: 201 } },
    });
    avec(w, ACTION_MESSAGE);
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(envoyees(w)).toEqual([]);
    expect(w.remises).toEqual([{ comptee: true }]);
  });
});

describe('les refus de LinkedIn', () => {
  it('un 401 bloque la session et aucune autre action n est tentee', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: { statut: 401 } } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.journal).toContain('bloquer cookie_refuse');
    expect(mocks.reclamer).toHaveBeenCalledTimes(1);
    expect(enregistrements()).toEqual([]);
    // Rien n'est parti : l'action attend la reconnexion, sans vieillir.
    expect(w.remises).toEqual([{ comptee: false }]);
    expect(w.journal.some((j) => j.startsWith('pause'))).toBe(false);
  });

  it('un 401 sur le POST bloque aussi la session', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: { statut: 401 } } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.journal).toContain('bloquer cookie_refuse');
    expect(mocks.reclamer).toHaveBeenCalledTimes(1);
    expect(w.remises).toEqual([{ comptee: false }]);
  });

  it('un défi (999) bloque la session sous le motif defi, sans reprise automatique', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: { statut: 999 } } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.journal).toContain('bloquer defi');
    expect(w.journal.some((j) => j.startsWith('pause'))).toBe(false);
  });

  it('un refus technique laisse l action en echec, et le canal continue', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: { statut: 404 } } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(enregistrements()).toEqual([
      expect.objectContaining({ status: 'failed', errorCode: 'profile_not_found', queueId: 'q-1' }),
    ]);
    expect(w.journal.some((j) => j.startsWith('bloquer') || j.startsWith('pause'))).toBe(false);
    expect(w.remises).toEqual([]);
  });

  it('un message vers une relation hors premier degré échoue seul, avec un motif lisible', async () => {
    const w = monde({
      reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_ME]: ME_OK, [URL_MESSAGE]: { statut: 403, corps: {} } },
    });
    avec(w, ACTION_MESSAGE);
    await traiterEnvoiLinkedIn(deps(w), JOB);
    const [e] = enregistrements();
    // 403 sur un POST de message : relation non établie, pas une session refusée.
    expect(e).toMatchObject({ status: 'failed', errorCode: 'cannot_message' });
    expect(e?.errorMessage).toMatch(/relation de premier degré/);
    expect(w.journal.some((j) => j.startsWith('bloquer'))).toBe(false);
  });

  it('une note d invitation est un refus définitif, jamais rejoué', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK } });
    avec(w, { ...ACTION_INVITATION, messageBody: 'Bonjour, ravie de vous connaitre' });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(envoyees(w)).toEqual([]);
    expect(enregistrements()).toEqual([expect.objectContaining({ status: 'failed', errorCode: 'note_non_supportee' })]);
    expect(w.remises).toEqual([]);
  });

  it('une invitation sans note ne passe jamais une chaine vide', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: { statut: 201 } } });
    avec(w, { ...ACTION_INVITATION, messageBody: '' });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    // Le contrat de `envoyerInvitation` est `null`, pas une note vide qu'il tolère aujourd'hui.
    expect(vi.mocked(envoyerInvitation).mock.calls.at(-1)?.[2]).toBeNull();
    expect(enregistrements().map((e) => e.status)).toEqual(['sent']);
  });
});

describe('le 429', () => {
  const reponses = { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: { statut: 429 } };

  it('met le canal en pause jusqu au lendemain 0 h dans le fuseau et rend l action reclamable ensuite', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z')); // 12 h à Paris (UTC+2)
    const w = monde({ reponses });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.journal).toContain('pause 2026-10-07T22:00:00.000Z'); // 8 octobre 0 h, Paris
    expect(w.remises).toEqual([{ comptee: false }]);
    expect(mocks.enregistrer).not.toHaveBeenCalled();
    expect(w.journal.some((j) => j.startsWith('bloquer'))).toBe(false);
  });

  it('respecte le fuseau des réglages, passage à l heure d hiver compris', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T20:00:00Z')); // 22 h à Paris, la veille du passage à l'heure d'hiver
    const w = monde({ reponses });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    // 25 octobre 0 h Paris est encore en heure d'été (UTC+2) : le 24 à 22 h UTC.
    expect(w.journal).toContain('pause 2026-10-24T22:00:00.000Z');
  });

  it('un autre fuseau donne un autre minuit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
    const w = monde({ reponses, fuseau: 'America/New_York' });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.journal).toContain('pause 2026-01-16T05:00:00.000Z');
  });

  it('une pause qui n a pas pu être posée n est pas tenue pour posée : la session est bloquée et le tour s arrête', async () => {
    const w = monde({ reponses });
    mocks.pause.mockResolvedValue(false);
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.journal).toContain('bloquer disjoncteur');
    expect(mocks.reclamer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error).mock.calls.length + vi.mocked(console.warn).mock.calls.length).toBeGreaterThan(0);
  });

  it('un 429 arrivé à la lecture du profil met aussi le canal en pause', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: { statut: 429 } } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.journal.some((j) => j.startsWith('pause '))).toBe(true);
    expect(w.remises).toEqual([{ comptee: false }]);
  });
});

describe('aucune fuite', () => {
  it('ni message, ni journal ne portent le message d une erreur du pilote', async () => {
    const secret = 'http://user:motdepasse@proxy.example:8080';
    const w = monde({
      reponses: { [URL_PROFIL('jeanne-dupont')]: PROFIL_OK, [URL_INVITATION]: new Error(`connexion à ${secret} refusée`) },
    });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    const tout = JSON.stringify([
      ...vi.mocked(console.error).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(console.log).mock.calls,
      mocks.enregistrer.mock.calls,
      w.journal,
    ]);
    expect(tout).not.toContain('motdepasse');
    expect(tout).not.toContain('proxy.example');
  });

  it('le navigateur est fermé et le verrou libéré même quand tout échoue', async () => {
    const w = monde({ reponses: { [URL_PROFIL('jeanne-dupont')]: new Error('x') } });
    await traiterEnvoiLinkedIn(deps(w), JOB);
    expect(w.fermer).toHaveBeenCalledTimes(1);
    expect(w.journal.filter((j) => j === 'verrou envoi-org-1 0')).toHaveLength(1);
  });
});
