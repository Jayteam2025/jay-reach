/**
 * Tâche 4 (lot réponses LinkedIn) : le passage de relève.
 *
 * Ce fichier prouve L'ENCHAÎNEMENT des décisions : ce qui est traité, ce qui fige le curseur, ce
 * qui notifie. Le pool est factice (le SQL se prouve dans `test/pg-verify`), `recordInboundReply`
 * et `notifyReply` sont doublés, et le pilote répond par URL : rien ici n'ouvre un navigateur ni
 * n'appelle LinkedIn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUES } from '@jay-reach/core';
import type { Pilote } from '../linkedin/navigateur.js';
import { compteursDuReleve, urlConversations, type Releve } from '../linkedin/messagerie.js';

const mocks = vi.hoisted(() => ({ enregistrer: vi.fn(), notifier: vi.fn() }));

vi.mock('@jay-reach/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@jay-reach/core')>();
  return { ...original, recordInboundReply: mocks.enregistrer, notifyReply: mocks.notifier };
});

import {
  DUREE_VERROU_RELEVE_MS,
  enqueueReleveLinkedIn,
  MARGE_CURSEUR_MS,
  traiterReleveLinkedIn,
  type DependancesReleve,
} from './releve-linkedin.js';

const ORG = 'org-1';
const JOB = { organizationId: ORG };
const URL_ME = 'https://www.linkedin.com/voyager/api/me';
const MOI = 'urn:li:fsd_profile:ACoAAexpediteur';
const MOI_NU = 'ACoAAexpediteur';
const URL_CONVERSATIONS = urlConversations(MOI, 20);
const ME_OK = {
  statut: 200,
  corps: {
    data: { '*miniProfile': 'urn:li:fs_miniProfile:ACoAAexpediteur' },
    included: [{ entityUrn: 'urn:li:fs_miniProfile:ACoAAexpediteur', publicIdentifier: 'moi' }],
  },
};
/** Un mardi, 11 h à Paris : dans la plage par défaut (9 h à 18 h, du lundi au vendredi). */
const MAINTENANT = new Date('2026-10-13T09:00:00Z');
const AVANT = MAINTENANT.getTime() - 3_600_000;
const APRES = MAINTENANT.getTime() - 60_000;

type Msg = { id: string; de: string; texte?: string; url?: string; quand?: number };

function conversation(m: Msg): unknown {
  return {
    entityUrn: `urn:li:msg_conversation:c-${m.id}`,
    lastActivityAt: m.quand ?? APRES,
    groupChat: false,
    conversationParticipants: [
      { hostIdentityUrn: MOI, participantType: { member: { profileUrl: 'https://www.linkedin.com/in/moi' } } },
      {
        hostIdentityUrn: `urn:li:fsd_profile:${m.de}`,
        participantType: { member: { profileUrl: m.url ?? `https://www.linkedin.com/in/${m.de}` } },
      },
    ],
    messages: {
      elements: [
        {
          entityUrn: `urn:li:msg_message:${m.id}`,
          deliveredAt: m.quand ?? APRES,
          sender: { hostIdentityUrn: `urn:li:fsd_profile:${m.de}` },
          body: { text: m.texte ?? 'Bonjour, oui je suis intéressé' },
        },
      ],
    },
  };
}

const charge = (...msgs: Msg[]) => ({ data: { messengerConversationsBySyncToken: { elements: msgs.map(conversation) } } });

interface Monde {
  journal: string[];
  traces: number;
  pilote: Pilote;
  fermer: ReturnType<typeof vi.fn>;
  ouvrir: ReturnType<typeof vi.fn>;
  pool: DependancesReleve['pool'];
  requetes: string[];
  /** Contacts par identifiant normalisé (rattachement par URN). */
  parUrn: Map<string, string[]>;
  /** Contacts par URL normalisée (rattachement de repli). */
  parUrl: Map<string, string[]>;
  requetesSql: { tag: string; params: unknown[] }[];
}

function monde(opts: {
  conversations?: { statut: number; corps?: unknown } | Error;
  me?: { statut: number; corps?: unknown };
  curseur?: Date | null;
  compte?: string | null;
  session?: { status: string; expected_egress_ip: string | null } | null;
  verrou?: boolean;
  jour?: Date;
  contactsParUrn?: Record<string, string[]>;
  contactsParUrl?: Record<string, string[]>;
}): Monde {
  const w: Monde = {
    journal: [],
    traces: 0,
    pilote: undefined as unknown as Pilote,
    fermer: vi.fn(async () => undefined),
    ouvrir: vi.fn(),
    pool: undefined as unknown as DependancesReleve['pool'],
    requetes: [],
    parUrn: new Map(Object.entries(opts.contactsParUrn ?? {})),
    parUrl: new Map(Object.entries(opts.contactsParUrl ?? {})),
    requetesSql: [],
  };
  const rep = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const query = async (sql: string, params: unknown[] = []) => {
    const t = String(sql);
    const tag = /jr:([a-z_]+)/.exec(t)?.[1] ?? '';
    w.requetesSql.push({ tag, params });
    if (tag === 'linkedin_session_lire') {
      const s = opts.session === undefined ? { status: 'active', expected_egress_ip: null } : opts.session;
      return rep(s ? [s] : []);
    }
    if (tag === 'linkedin_session_verrou') {
      w.journal.push(`verrou ${params[1]} ${params[2]}`);
      return rep(opts.verrou === false ? [] : [{}]);
    }
    if (tag === 'linkedin_session_bloquer') return rep([{}]);
    if (tag === 'linkedin_session_observer') return rep([]);
    if (tag === 'linkedin_messagerie_tracer') {
      w.traces += 1;
      w.journal.push('trace');
      return rep([{}]);
    }
    if (tag === 'linkedin_releve_etat_lire') {
      return rep([{ releve_curseur_at: opts.curseur ?? null, releve_compte_urn: opts.compte ?? null }]);
    }
    if (tag === 'linkedin_releve_etat_ecrire') {
      const curseur = params[2] instanceof Date ? params[2].toISOString() : String(params[2]);
      w.journal.push(`etat compte=${String(params[1])} curseur=${curseur}`);
      return rep([]);
    }
    if (tag === 'releve_rattacher_urn') {
      const variantes = params[1] as string[];
      return rep((w.parUrn.get(variantes[0]!) ?? []).map((id) => ({ id })));
    }
    if (tag === 'releve_rattacher_url') {
      return rep((w.parUrl.get(String(params[1])) ?? []).map((id) => ({ id })));
    }
    if (t.includes('from linkedin_settings')) return rep([]);
    return rep([]);
  };
  w.pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as DependancesReleve['pool'];

  w.pilote = {
    aller: async () => undefined,
    url: async () => 'https://www.linkedin.com/feed/',
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '',
    attendre: async () => true,
    requete: async (u) => {
      w.requetes.push(u);
      w.journal.push(`requete ${u === URL_ME ? 'me' : 'conversations'}`);
      const r = u === URL_ME ? (opts.me ?? ME_OK) : u === URL_CONVERSATIONS ? opts.conversations : undefined;
      if (!r) throw new Error(`requete non prevue : ${u}`);
      if (r instanceof Error) throw r;
      return { statut: r.statut, corps: typeof r.corps === 'string' ? r.corps : JSON.stringify(r.corps ?? {}) };
    },
    effacerCookies: async () => undefined,
    fermer: w.fermer as unknown as Pilote['fermer'],
  };
  w.ouvrir = vi.fn(async () => w.pilote);
  return w;
}

function deps(w: Monde, extra: Partial<DependancesReleve> = {}): DependancesReleve {
  return {
    pool: w.pool,
    env: { JAY_REACH_LINKEDIN: '1' },
    ouvrirNavigateur: w.ouvrir as unknown as DependancesReleve['ouvrirNavigateur'],
    releverSortie: vi.fn(async () => ({ ip: '203.0.113.7' })) as unknown as DependancesReleve['releverSortie'],
    ...extra,
  };
}

const etatEcrit = (w: Monde) => w.journal.filter((l) => l.startsWith('etat '));

let sortie: { log: string[]; warn: string[]; error: string[] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MAINTENANT);
  mocks.enregistrer.mockReset();
  mocks.notifier.mockReset();
  mocks.enregistrer.mockResolvedValue({ threadId: 't-1', classification: 'reponse_humaine', isNew: true });
  mocks.notifier.mockResolvedValue(undefined);
  sortie = { log: [], warn: [], error: [] };
  vi.spyOn(console, 'log').mockImplementation((...a) => void sortie.log.push(a.join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...a) => void sortie.warn.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void sortie.error.push(a.join(' ')));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('garde, plage horaire et verrou', () => {
  it('sans JAY_REACH_LINKEDIN, rien n est touche : ni base, ni verrou, ni navigateur', async () => {
    const w = monde({});
    await traiterReleveLinkedIn(deps(w, { env: {} }), JOB);
    expect(w.requetesSql).toEqual([]);
    expect(w.ouvrir).not.toHaveBeenCalled();
  });

  it('sans session active, le navigateur ne s ouvre pas', async () => {
    const w = monde({ session: { status: 'bloquee', expected_egress_ip: null } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.ouvrir).not.toHaveBeenCalled();
  });

  it('hors de la plage horaire (samedi), ni verrou ni navigateur, curseur inchange', async () => {
    vi.setSystemTime(new Date('2026-10-17T09:00:00Z'));
    const w = monde({});
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.journal.some((l) => l.startsWith('verrou'))).toBe(false);
    expect(w.ouvrir).not.toHaveBeenCalled();
    expect(etatEcrit(w)).toEqual([]);
  });

  it('hors de la plage horaire (3 h du matin un mardi), rien non plus', async () => {
    vi.setSystemTime(new Date('2026-10-13T01:00:00Z'));
    const w = monde({});
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.ouvrir).not.toHaveBeenCalled();
  });

  it('verrou deja pris : sortie sans erreur, curseur fige, renoncement journalise, aucun navigateur', async () => {
    const w = monde({ verrou: false, curseur: new Date(AVANT), compte: MOI_NU });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
    expect(w.ouvrir).not.toHaveBeenCalled();
    expect(w.requetes).toEqual([]);
    expect(etatEcrit(w)).toEqual([]);
    expect(sortie.warn.some((l) => l.includes('renoncement') && l.includes('verrou'))).toBe(true);
    // Verrou pas pris : il n'est pas non plus « rendu » (ce serait le verrou d'un autre).
    expect(w.journal.filter((l) => l.startsWith('verrou'))).toHaveLength(1);
  });

  it('le verrou est pris pour un proprietaire propre a la releve, puis rendu avec une duree nulle', async () => {
    const w = monde({ conversations: { statut: 200, corps: charge() }, compte: MOI_NU, curseur: new Date(AVANT) });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.journal.filter((l) => l.startsWith('verrou'))).toEqual([
      `verrou releve-${ORG} ${DUREE_VERROU_RELEVE_MS}`,
      `verrou releve-${ORG} 0`,
    ]);
    expect(w.fermer).toHaveBeenCalledTimes(1);
  });
});

describe('la sortie reseau et le navigateur', () => {
  it('une sortie non conforme abandonne le passage : aucune requete vers LinkedIn, aucune ecriture', async () => {
    const w = monde({ session: { status: 'active', expected_egress_ip: '198.51.100.1' }, compte: MOI_NU, curseur: new Date(AVANT) });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.requetes).toEqual([]);
    expect(w.traces).toBe(0);
    expect(etatEcrit(w)).toEqual([]);
    expect(w.journal.at(-1)).toBe(`verrou releve-${ORG} 0`);
    expect(w.fermer).toHaveBeenCalledTimes(1);
  });

  it('un navigateur qui ne s ouvre pas : sortie sans erreur, verrou rendu, rien d ecrit, aucune URL de proxy en journal', async () => {
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT) });
    w.ouvrir.mockRejectedValue(new Error('http://u:motdepasse@proxy.example:8080 injoignable'));
    await expect(traiterReleveLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
    expect(w.journal.at(-1)).toBe(`verrou releve-${ORG} 0`);
    expect([...sortie.log, ...sortie.warn, ...sortie.error].join('\n')).not.toContain('motdepasse');
  });

  it('une sortie qui ne se releve pas : sortie sans erreur, aucune requete vers LinkedIn', async () => {
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT) });
    const releverSortie = vi.fn(async () => {
      throw new Error('proxy muet');
    }) as unknown as DependancesReleve['releverSortie'];
    await expect(traiterReleveLinkedIn(deps(w, { releverSortie }), JOB)).resolves.toBeUndefined();
    expect(w.requetes).toEqual([]);
    expect(w.fermer).toHaveBeenCalledTimes(1);
  });
});

describe('le compte connecté', () => {
  it('compte change : rien traite, curseur fige, nouveau compte pose, aucune lecture des conversations', async () => {
    const w = monde({ compte: 'ACoAAancien', curseur: new Date(AVANT), conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne' }) } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer).not.toHaveBeenCalled();
    expect(mocks.notifier).not.toHaveBeenCalled();
    expect(w.requetes).toEqual([URL_ME]);
    // Le nouveau compte est posé, SANS curseur (`null` : la requête garde l'existant).
    expect(etatEcrit(w)).toEqual([`etat compte=${MOI_NU} curseur=null`]);
  });

  it('la meme personne sous une autre forme (prefixee en base) n est PAS un changement de compte', async () => {
    const w = monde({
      compte: MOI,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne' }) },
      contactsParUrn: { ACoAAjeanne: ['contact-1'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer).toHaveBeenCalledTimes(1);
  });

  it('premier passage (aucun compte connu) : le compte est pose et le passage a lieu', async () => {
    const w = monde({ compte: null, curseur: null, conversations: { statut: 200, corps: charge() } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.requetes).toEqual([URL_ME, URL_CONVERSATIONS]);
    expect(etatEcrit(w)).toEqual([`etat compte=${MOI_NU} curseur=${MAINTENANT.toISOString()}`]);
  });

  it('une lecture de /me illisible leve et fige le curseur : sans identite, nos sortants passeraient pour des reponses', async () => {
    const w = monde({ me: { statut: 500 }, compte: MOI_NU, curseur: new Date(AVANT) });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).rejects.toMatchObject({ name: 'IllisibleMessagerie' });
    expect(w.requetes).not.toContain(URL_CONVERSATIONS);
    expect(etatEcrit(w)).toEqual([]);
  });
});

describe('le curseur', () => {
  it('curseur nul = maintenant : une conversation anterieure est ecartee, et le curseur vaut maintenant', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: null,
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', quand: AVANT }) },
      contactsParUrn: { ACoAAjeanne: ['contact-1'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer).not.toHaveBeenCalled();
    expect(etatEcrit(w)).toEqual([`etat compte=${MOI_NU} curseur=${MAINTENANT.toISOString()}`]);
  });

  it('apres un succes, le curseur avance a maintenant moins la marge', async () => {
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 200, corps: charge() } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(etatEcrit(w)).toEqual([
      `etat compte=${MOI_NU} curseur=${new Date(MAINTENANT.getTime() - MARGE_CURSEUR_MS).toISOString()}`,
    ]);
  });

  it('le curseur ne recule jamais : un curseur deja plus recent que maintenant moins la marge reste', async () => {
    const recent = new Date(MAINTENANT.getTime() - 60_000);
    const w = monde({ compte: MOI_NU, curseur: recent, conversations: { statut: 200, corps: charge() } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(etatEcrit(w)).toEqual([`etat compte=${MOI_NU} curseur=${recent.toISOString()}`]);
  });

  it('ErreurMessagerie (forme illisible) : erreur propagee, curseur fige, verrou rendu, navigateur ferme', async () => {
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 200, corps: { data: {} } } });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).rejects.toMatchObject({ name: 'IllisibleMessagerie' });
    expect(etatEcrit(w)).toEqual([]);
    expect(w.journal.at(-1)).toBe(`verrou releve-${ORG} 0`);
    expect(w.fermer).toHaveBeenCalledTimes(1);
  });

  it('un statut HTTP inattendu leve et fige le curseur', async () => {
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 429 } });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).rejects.toMatchObject({ name: 'StatutInattendu' });
    expect(etatEcrit(w)).toEqual([]);
  });

  it('une requete qui echoue (reseau) fige le curseur et rend le verrou', async () => {
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT), conversations: new Error('reseau') });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).rejects.toThrow('reseau');
    expect(etatEcrit(w)).toEqual([]);
    expect(w.journal.at(-1)).toBe(`verrou releve-${ORG} 0`);
  });
});

describe('les entrants', () => {
  it('un entrant rattache par URN : recordInboundReply une fois, avec les valeurs exactes, notifyReply une fois', async () => {
    const texte = 'Bonjour, oui je suis intéressé';
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', texte }) },
      contactsParUrn: { ACoAAjeanne: ['contact-1'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer).toHaveBeenCalledTimes(1);
    expect(mocks.enregistrer).toHaveBeenCalledWith(w.pool, ORG, {
      contactId: 'contact-1',
      channel: 'linkedin_message',
      body: texte,
      providerMessageId: 'urn:li:msg_message:m1',
      receivedAt: new Date(APRES),
      raw: { source: 'releve_serveur' },
    });
    expect(mocks.notifier).toHaveBeenCalledTimes(1);
    expect(mocks.notifier).toHaveBeenCalledWith(w.pool, ORG, 'Nouvelle réponse LinkedIn', texte);
  });

  it('le corps de la notification est tronque a 140 caracteres', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', texte: 'é'.repeat(300) }) },
      contactsParUrn: { ACoAAjeanne: ['contact-1'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.notifier.mock.calls[0]![3]).toBe('é'.repeat(140));
  });

  it('une reponse sans texte (piece jointe seule) notifie quand meme, sur la classification', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', texte: '' }) },
      contactsParUrn: { ACoAAjeanne: ['contact-1'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.notifier).toHaveBeenCalledWith(w.pool, ORG, 'Nouvelle réponse LinkedIn', 'reponse_humaine');
  });

  it('rattachement de repli par l URL de profil : 353 contacts n ont que leur URL', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', url: 'https://www.linkedin.com/in/jeanne-dupont' }) },
      contactsParUrl: { 'https://www.linkedin.com/in/jeanne-dupont': ['contact-url'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer.mock.calls[0]![2]).toMatchObject({ contactId: 'contact-url' });
    // Le repli est borne a l'organisation, comme le premier temps.
    const sqlUrl = w.requetesSql.filter((q) => q.tag === 'releve_rattacher_url');
    expect(sqlUrl).toHaveLength(1);
    expect(sqlUrl[0]!.params[0]).toBe(ORG);
    const sqlUrn = w.requetesSql.filter((q) => q.tag === 'releve_rattacher_urn');
    expect(sqlUrn[0]!.params[0]).toBe(ORG);
    expect(sortie.log.join('\n')).toContain('"rattachesParUrl":1');
  });

  it('la recherche par URN lit la forme nue ET les deux formes prefixees : une valeur ancienne en base ne se perd pas', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne' }) },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    const q = w.requetesSql.find((r) => r.tag === 'releve_rattacher_urn')!;
    expect(q.params[1]).toEqual(['ACoAAjeanne', 'urn:li:fsd_profile:ACoAAjeanne', 'urn:li:fs_miniProfile:ACoAAjeanne']);
  });

  it('l URN prime sur l URL : un contact trouve par URN n declenche pas la recherche par URL', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne' }) },
      contactsParUrn: { ACoAAjeanne: ['contact-urn'] },
      contactsParUrl: { 'https://www.linkedin.com/in/ACoAAjeanne': ['contact-url'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer.mock.calls[0]![2]).toMatchObject({ contactId: 'contact-urn' });
    expect(w.requetesSql.some((q) => q.tag === 'releve_rattacher_url')).toBe(false);
  });

  it('plusieurs contacts pour une meme personne : le premier (le plus ancien), et le cas est compte', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne' }) },
      contactsParUrn: { ACoAAjeanne: ['contact-ancien', 'contact-recent'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer.mock.calls[0]![2]).toMatchObject({ contactId: 'contact-ancien' });
    expect(sortie.log.join('\n')).toContain('"ambigus":1');
  });

  it('un entrant non rattache : rien d ecrit, rien de notifie, compteur a 1, curseur avance', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAinconnu' }) },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer).not.toHaveBeenCalled();
    expect(mocks.notifier).not.toHaveBeenCalled();
    expect(sortie.log.join('\n')).toContain('"nonRattaches":1');
    expect(etatEcrit(w)).toHaveLength(1);
  });

  it('un entrant sans URL de profil ni contact par URN n interroge pas la base par URL', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: { data: { messengerConversationsX: { elements: [{ ...(conversation({ id: 'm1', de: 'ACoAAinconnu' }) as object), conversationParticipants: [] }] } } } },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.requetesSql.some((q) => q.tag === 'releve_rattacher_url')).toBe(false);
  });

  it('second passage (isNew: false) : aucune notification, curseur avance', async () => {
    mocks.enregistrer.mockResolvedValue({ threadId: 't-1', classification: 'reponse_humaine', isNew: false });
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne' }) },
      contactsParUrn: { ACoAAjeanne: ['contact-1'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer).toHaveBeenCalledTimes(1);
    expect(mocks.notifier).not.toHaveBeenCalled();
    expect(sortie.log.join('\n')).toContain('"dejaEnregistres":1');
    expect(etatEcrit(w)).toHaveLength(1);
  });

  it('les plus anciens d abord', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: {
        statut: 200,
        corps: charge({ id: 'recent', de: 'ACoAAjeanne', quand: APRES }, { id: 'ancien', de: 'ACoAApaul', quand: AVANT + 1000 }),
      },
      contactsParUrn: { ACoAAjeanne: ['c1'], ACoAApaul: ['c2'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer.mock.calls.map((c) => c[2].providerMessageId)).toEqual([
      'urn:li:msg_message:ancien',
      'urn:li:msg_message:recent',
    ]);
  });
});

describe('un cas individuel ne bloque jamais les autres', () => {
  const deuxMessages = () =>
    monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', quand: AVANT + 1000 }, { id: 'm2', de: 'ACoAApaul', quand: APRES }) },
      contactsParUrn: { ACoAAjeanne: ['c1'], ACoAApaul: ['c2'] },
    });

  it('une ecriture qui echoue : le suivant est traite et notifie, le curseur reste fige, l erreur est levee', async () => {
    const w = deuxMessages();
    mocks.enregistrer.mockRejectedValueOnce(new Error('postgres://u:mdp@hote injoignable'));
    await expect(traiterReleveLinkedIn(deps(w), JOB)).rejects.toMatchObject({ name: 'ReleveIncomplete' });
    expect(mocks.enregistrer).toHaveBeenCalledTimes(2);
    expect(mocks.notifier).toHaveBeenCalledTimes(1);
    expect(etatEcrit(w)).toEqual([]);
    // Le message de l'erreur de base ne sort jamais (il peut porter une chaine de connexion).
    expect([...sortie.error, ...sortie.log, ...sortie.warn].join('\n')).not.toContain('mdp');
    expect(w.journal.at(-1)).toBe(`verrou releve-${ORG} 0`);
  });

  it('une recherche de contact qui echoue : meme traitement', async () => {
    const w = deuxMessages();
    const origine = w.pool.query.bind(w.pool);
    let premiere = true;
    (w.pool as unknown as { query: unknown }).query = async (sql: string, params: unknown[]) => {
      if (String(sql).includes('jr:releve_rattacher_urn') && premiere) {
        premiere = false;
        throw new Error('base indisponible');
      }
      return origine(sql, params);
    };
    await expect(traiterReleveLinkedIn(deps(w), JOB)).rejects.toMatchObject({ name: 'ReleveIncomplete' });
    expect(mocks.enregistrer).toHaveBeenCalledTimes(1);
    expect(etatEcrit(w)).toEqual([]);
  });

  it('une notification qui echoue deux fois est retentee : la reponse enregistree ne se rejoue pas, elle ne doit pas se perdre', async () => {
    const w = deuxMessages();
    mocks.notifier.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.notifier).toHaveBeenCalledTimes(4); // 3 essais pour le premier message, 1 pour le second
    expect(etatEcrit(w)).toHaveLength(1);
  });

  it('une notification qui echoue trois fois fige le curseur et leve, mais le message suivant est traite', async () => {
    const w = deuxMessages();
    mocks.notifier.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    await expect(traiterReleveLinkedIn(deps(w), JOB)).rejects.toMatchObject({ name: 'ReleveIncomplete' });
    expect(mocks.enregistrer).toHaveBeenCalledTimes(2);
    expect(mocks.notifier).toHaveBeenCalledTimes(4);
    expect(etatEcrit(w)).toEqual([]);
  });

  it('un entrant illisible dans la charge utile ne fige pas le curseur : il est compte, les autres passent', async () => {
    const mauvaise = conversation({ id: 'm0', de: 'ACoAAjeanne' }) as { messages: { elements: { entityUrn?: string }[] } };
    delete mauvaise.messages.elements[0]!.entityUrn;
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: {
        statut: 200,
        corps: { data: { messengerConversationsBySyncToken: { elements: [mauvaise, conversation({ id: 'm2', de: 'ACoAApaul' })] } } },
      },
      contactsParUrn: { ACoAApaul: ['c2'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer).toHaveBeenCalledTimes(1);
    expect(sortie.log.join('\n')).toContain('"entrantsIllisibles":1');
    expect(etatEcrit(w)).toHaveLength(1);
  });
});

describe('le journal du passage et la trace', () => {
  it('porte TOUS les compteurs de la relève, sous leur nom, et aucun contenu de message', async () => {
    const texteSecret = 'mon numero personnel est le 0612345678';
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', texte: texteSecret }) },
      contactsParUrn: { ACoAAjeanne: ['contact-1'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    const ligne = sortie.log.find((l) => l.includes('passage '));
    expect(ligne).toBeDefined();
    const journal = JSON.parse(ligne!.slice(ligne!.indexOf('{'))) as Record<string, number>;
    const vide: Releve = {
      entrants: [],
      ecartesNonUnAUn: 0,
      ecartesAnterieuresAuCurseur: 0,
      unAUnSansIndice: 0,
      sansHorodatage: 0,
      sansMessage: 0,
      expediteursIllisibles: 0,
      conversationsIllisibles: 0,
      entrantsIllisibles: 0,
    };
    for (const cle of Object.keys(compteursDuReleve(vide))) expect(journal, cle).toHaveProperty(cle);
    for (const cle of ['entrants', 'nouveaux', 'dejaEnregistres', 'nonRattaches', 'rattachesParUrl', 'ambigus', 'echecs']) {
      expect(journal, cle).toHaveProperty(cle);
    }
    expect(journal.nouveaux).toBe(1);
    expect([...sortie.log, ...sortie.warn, ...sortie.error].join('\n')).not.toContain(texteSecret);
  });

  it('les valeurs des compteurs de la charge utile sont reprises, pas des zeros', async () => {
    const groupe = conversation({ id: 'g1', de: 'ACoAAjeanne' }) as { groupChat: boolean };
    groupe.groupChat = true;
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: { data: { messengerConversationsX: { elements: [groupe, conversation({ id: 'a', de: 'ACoAAvieux', quand: AVANT - 5000 })] } } } },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    const log = sortie.log.join('\n');
    expect(log).toContain('"ecartesNonUnAUn":1');
    expect(log).toContain('"ecartesAnterieuresAuCurseur":1');
  });

  it('deux requetes tracees, chacune AVANT son appel, sous le meme budget que le reste du canal', async () => {
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 200, corps: charge() } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.traces).toBe(2);
    const ordre = w.journal.filter((l) => l === 'trace' || l.startsWith('requete'));
    expect(ordre).toEqual(['trace', 'requete me', 'trace', 'requete conversations']);
  });

  it('un compte change ne coute qu une requete tracee', async () => {
    const w = monde({ compte: 'ACoAAancien', curseur: new Date(AVANT) });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.traces).toBe(1);
  });
});

describe('le producteur', () => {
  const poolDe = (orgs: string[], intervalle?: string) =>
    ({
      query: async (sql: string) => {
        if (String(sql).includes('jr:linkedin_releve_organisations')) return { rows: orgs.map((o) => ({ organization_id: o })), rowCount: orgs.length };
        if (intervalle !== undefined) return { rows: [{ value: intervalle }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    }) as unknown as DependancesReleve['pool'];

  it('un job par organisation, cadence par singletonSeconds a partir de l intervalle regle', async () => {
    const send = vi.fn(async () => 'job-1');
    const n = await enqueueReleveLinkedIn({ send }, poolDe(['o1', 'o2'], '10'));
    expect(n).toBe(2);
    expect(send).toHaveBeenNthCalledWith(1, 'linkedin.releve', { organizationId: 'o1' }, { singletonKey: 'o1', singletonSeconds: 600 });
    expect(send).toHaveBeenNthCalledWith(2, 'linkedin.releve', { organizationId: 'o2' }, { singletonKey: 'o2', singletonSeconds: 600 });
  });

  it('un envoi refuse par la file (deja un job) n est pas compte, et n est pas une erreur', async () => {
    const send = vi.fn(async () => null);
    expect(await enqueueReleveLinkedIn({ send }, poolDe(['o1'], '30'))).toBe(0);
  });

  it('une organisation qui echoue n emporte pas les autres', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('job-2');
    expect(await enqueueReleveLinkedIn({ send }, poolDe(['o1', 'o2'], '30'))).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('la file est declaree en politique stately, sans reprise', () => {
    const file = QUEUES.find((q) => q.name === 'linkedin.releve');
    expect(file).toBeDefined();
    expect(file).toMatchObject({ policy: 'stately', retry: { retryLimit: 0 } });
  });
});
