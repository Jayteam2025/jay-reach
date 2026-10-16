/**
 * Tâche 4 (lot réponses LinkedIn) : le passage de relève.
 *
 * Ce fichier prouve L'ENCHAÎNEMENT des décisions : ce qui est traité, ce qui fige le curseur, ce
 * qui notifie. Le pool est factice (le SQL se prouve dans `test/pg-verify`), `recordInboundReply`
 * et `notifyReply` sont doublés, et le pilote répond par URL : rien ici n'ouvre un navigateur ni
 * n'appelle LinkedIn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUES, type RecordedReply } from '@jay-reach/core';
import type { Pilote } from '../linkedin/navigateur.js';
import { compteursDuReleve, urlConversations, type Releve } from '../linkedin/messagerie.js';

const mocks = vi.hoisted(() => ({ enregistrer: vi.fn(), notifier: vi.fn() }));

vi.mock('@jay-reach/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@jay-reach/core')>();
  return { ...original, recordInboundReply: mocks.enregistrer, notifyReply: mocks.notifier };
});

import {
  CORPS_REPONSE_SANS_TEXTE,
  DUREE_VERROU_RELEVE_MS,
  enqueueReleveLinkedIn,
  MARGE_CURSEUR_MS,
  traiterReleveLinkedIn,
  type DependancesReleve,
} from './releve-linkedin.js';

const ORG = 'org-1';
const JOB = { organizationId: ORG };
const URL_PROFILS = 'https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=';
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
  /** Identifiants publics demandes a la resolution de profil, dans l'ordre. */
  profilsDemandes: string[];
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
  plafondHoraire?: number;
  requetesDeLHeure?: number;
  /** L'ecriture de l'URN du contact echoue. */
  urnEchoue?: boolean;
  /** La ligne de session n'existe plus au moment d'ecrire le curseur. */
  sessionDisparue?: boolean;
  /** Contacts sans URN a qui un envoi est parti (la requete de candidats les rend dans cet ordre). */
  candidats?: { id: string; linkedin_url: string }[];
  /** Reponse du profil par identifiant public ; absent = profil_not_found (404). */
  profils?: Record<string, { statut: number; corps?: unknown } | Error>;
  /** La requete de candidats echoue. */
  candidatsEchoue?: boolean;
  /** L'ecriture de la date d'echec definitif echoue. */
  tenteeEchoue?: boolean;
  /** Reponses relevees dont la notification n'est pas partie (marque `notifiee: false`), rendues au balayage. */
  nonNotifiees?: { provider_message_id: string; body: string | null }[];
  /** La lecture du balayage echoue. */
  balayageEchoue?: boolean;
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
    profilsDemandes: [],
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
    if (tag === 'plafond_du_jour' || t.includes('organization_settings')) return rep([{ value: String(opts.plafondHoraire ?? 60) }]);
    if (tag === 'linkedin_requetes_compter') return rep([{ n: opts.requetesDeLHeure ?? 0 }]);
    if (tag === 'releve_urn_a_resoudre') {
      w.journal.push(`candidats org=${String(params[0])} limite=${String(params[1])}`);
      if (opts.candidatsEchoue) throw new Error('base indisponible');
      return rep(opts.candidats ?? []);
    }
    if (tag === 'contact_urn_tentee') {
      w.journal.push(`irresolu org=${String(params[0])} ids=${(params[1] as string[]).join(',')}`);
      if (opts.tenteeEchoue) throw new Error('base indisponible');
      return rep([]);
    }
    if (tag === 'contact_memoriser_urn') {
      w.journal.push(`urn_contact contact=${String(params[0])} org=${String(params[1])} urn=${String(params[2])}`);
      if (opts.urnEchoue) throw new Error('base indisponible');
      return rep([]);
    }
    if (tag === 'linkedin_releve_etat_lire') {
      return rep([{ releve_curseur_at: opts.curseur ?? null, releve_compte_urn: opts.compte ?? null }]);
    }
    if (tag === 'linkedin_releve_etat_ecrire') {
      const curseur = params[2] instanceof Date ? params[2].toISOString() : String(params[2]);
      w.journal.push(`etat compte=${String(params[1])} curseur=${curseur}`);
      return opts.sessionDisparue ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 };
    }
    if (tag === 'releve_reponse_notifiee') {
      w.journal.push(`marque ${String(params[1])}`);
      return { rows: [], rowCount: 1 };
    }
    if (tag === 'releve_reponses_non_notifiees') {
      w.journal.push('balayage');
      if (opts.balayageEchoue) throw new Error('base indisponible');
      return rep(opts.nonNotifiees ?? []);
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
      if (u.startsWith(URL_PROFILS)) {
        const slug = decodeURIComponent(u.slice(URL_PROFILS.length));
        w.profilsDemandes.push(slug);
        w.journal.push(`requete profil ${slug}`);
        const p = opts.profils?.[slug];
        if (p instanceof Error) throw p;
        return { statut: p?.statut ?? 404, corps: JSON.stringify(p?.corps ?? {}) };
      }
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
  mocks.enregistrer.mockResolvedValue({ threadId: 't-1', classification: 'human_reply', isNew: true, reclasse: false } satisfies RecordedReply);
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

  it('un samedi dans la plage horaire : la releve a lieu (elle ignore send_days, contrairement a l envoi)', async () => {
    vi.setSystemTime(new Date('2026-10-17T09:00:00Z'));
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 200, corps: charge() } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.ouvrir).toHaveBeenCalledTimes(1);
    expect(etatEcrit(w)).toHaveLength(1);
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

describe('le plafond de requetes de l heure', () => {
  it('budget insuffisant : ni verrou ni navigateur, curseur inchange', async () => {
    const w = monde({ plafondHoraire: 60, requetesDeLHeure: 59, compte: MOI_NU, curseur: new Date(AVANT) });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.journal.some((l) => l.startsWith('verrou'))).toBe(false);
    expect(w.ouvrir).not.toHaveBeenCalled();
    expect(etatEcrit(w)).toEqual([]);
  });

  it('juste assez de budget pour deux requetes : le passage a lieu', async () => {
    const w = monde({ plafondHoraire: 60, requetesDeLHeure: 58, compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 200, corps: charge() } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.ouvrir).toHaveBeenCalled();
  });

  it('le verrou dure autant que celui de l envoi : cinq minutes', () => {
    expect(DUREE_VERROU_RELEVE_MS).toBe(5 * 60_000);
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
    expect(etatEcrit(w)).toEqual([`etat compte=${MOI} curseur=null`]);
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
    expect(etatEcrit(w)).toEqual([`etat compte=${MOI} curseur=${MAINTENANT.toISOString()}`]);
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
    expect(etatEcrit(w)).toEqual([`etat compte=${MOI} curseur=${MAINTENANT.toISOString()}`]);
  });

  it('apres un succes, le curseur avance a maintenant moins la marge', async () => {
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 200, corps: charge() } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(etatEcrit(w)).toEqual([
      `etat compte=${MOI} curseur=${new Date(MAINTENANT.getTime() - MARGE_CURSEUR_MS).toISOString()}`,
    ]);
  });

  it('le curseur ne recule jamais : un curseur deja plus recent que maintenant moins la marge reste', async () => {
    const recent = new Date(MAINTENANT.getTime() - 60_000);
    const w = monde({ compte: MOI_NU, curseur: recent, conversations: { statut: 200, corps: charge() } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(etatEcrit(w)).toEqual([`etat compte=${MOI} curseur=${recent.toISOString()}`]);
  });

  it('la session disparue en cours de passage : l ecriture du curseur ne passe pas inapercue', async () => {
    const w = monde({ sessionDisparue: true, compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 200, corps: charge() } });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).rejects.toMatchObject({ name: 'SessionDisparue' });
    expect(w.journal.at(-1)).toBe(`verrou releve-${ORG} 0`);
  });

  it('meme garde sur le changement de compte', async () => {
    const w = monde({ sessionDisparue: true, compte: 'ACoAAancien', curseur: new Date(AVANT) });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).rejects.toMatchObject({ name: 'SessionDisparue' });
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
      raw: { source: 'releve_serveur', notifiee: false },
    });
    expect(mocks.notifier).toHaveBeenCalledTimes(1);
    expect(mocks.notifier).toHaveBeenCalledWith(expect.anything(), ORG, 'Nouvelle réponse LinkedIn', texte);
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

  it('une reponse sans texte (piece jointe seule) notifie quand meme, avec un corps lisible et non la classification technique', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', texte: '' }) },
      contactsParUrn: { ACoAAjeanne: ['contact-1'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.notifier).toHaveBeenCalledWith(expect.anything(), ORG, 'Nouvelle réponse LinkedIn', CORPS_REPONSE_SANS_TEXTE);
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
    // Le contact bascule sur le chemin principal : son URN est memorise (forme nue ou non, `memoriserUrnDuContact` normalise).
    expect(w.journal).toContain('urn_contact contact=contact-url org=org-1 urn=ACoAAjeanne');
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

  it('une URL qui ne designe pas un profil (membre hors reseau, autre hote) ne rattache rien et n interroge pas la base', async () => {
    for (const url of ['https://www.linkedin.com/in/', 'https://www.linkedin.com/in', 'https://example.com/in/jeanne', 'https://www.linkedin.com/company/acme']) {
      mocks.enregistrer.mockClear();
      const w = monde({
        compte: MOI_NU,
        curseur: new Date(AVANT),
        conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', url }) },
        contactsParUrl: { [url]: ['contact-tronque'], 'https://www.linkedin.com/in': ['contact-tronque'] },
      });
      await traiterReleveLinkedIn(deps(w), JOB);
      expect(mocks.enregistrer, url).not.toHaveBeenCalled();
      expect(w.requetesSql.some((q) => q.tag === 'releve_rattacher_url'), url).toBe(false);
    }
  });

  it('l URL est ecrite sous sa forme canonique avant la recherche', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', url: 'linkedin.com/in/jeanne-dupont/?trk=x' }) },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.requetesSql.find((q) => q.tag === 'releve_rattacher_url')!.params[1]).toBe('https://www.linkedin.com/in/jeanne-dupont');
  });

  it('une URL portee par plusieurs contacts est refusee : deux personnes possibles, on ne rattache pas', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', url: 'https://www.linkedin.com/in/jeanne-dupont' }) },
      contactsParUrl: { 'https://www.linkedin.com/in/jeanne-dupont': ['c-a', 'c-b'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer).not.toHaveBeenCalled();
    const log = sortie.log.join('\n');
    expect(log).toContain('"urlAmbigues":1');
    expect(log).toContain('"nonRattaches":1');
    expect(etatEcrit(w)).toHaveLength(1);
  });

  it('l URN n est memorise que pour un rattachement par URL, jamais par URN', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne' }) },
      contactsParUrn: { ACoAAjeanne: ['contact-1'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.journal.some((l) => l.startsWith('urn_contact'))).toBe(false);
  });

  it('une memorisation d URN qui echoue ne fait pas echouer la reponse : elle est enregistree et notifiee', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      urnEchoue: true,
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne', url: 'https://www.linkedin.com/in/jeanne-dupont' }) },
      contactsParUrl: { 'https://www.linkedin.com/in/jeanne-dupont': ['contact-url'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.enregistrer).toHaveBeenCalledTimes(1);
    expect(mocks.notifier).toHaveBeenCalledTimes(1);
    expect(etatEcrit(w)).toHaveLength(1);
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
    mocks.enregistrer.mockResolvedValue({ threadId: 't-1', classification: 'human_reply', isNew: false, reclasse: false } satisfies RecordedReply);
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

  it('message connu dont le corps tardif révèle une réponse humaine (reclasse: true) : une notification, curseur avance', async () => {
    mocks.enregistrer.mockResolvedValue({ threadId: 't-1', classification: 'human_reply', isNew: false, reclasse: true } satisfies RecordedReply);
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne' }) },
      contactsParUrn: { ACoAAjeanne: ['contact-1'] },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.notifier).toHaveBeenCalledTimes(1);
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

  it('une notification qui echoue ne fige pas le curseur et ne leve pas : le message reste a notifier, le balayage de fin de passage le reprend', async () => {
    const w = deuxMessages();
    w.requetesSql.length = 0;
    mocks.notifier.mockRejectedValueOnce(new Error('postgres://u:mdp@hote injoignable')).mockResolvedValue(undefined);
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.notifier).toHaveBeenCalledTimes(2); // le premier echoue, le second passe ; pas de rafale de reprises
    expect(etatEcrit(w)).toHaveLength(1);
    // Un balayage en debut de passage, un second APRES l'echec : il rend la main au filet.
    expect(w.journal.filter((l) => l === 'balayage')).toHaveLength(2);
    expect([...sortie.error, ...sortie.log, ...sortie.warn].join('\n')).not.toContain('mdp');
  });

  it('le balayage de fin de passage notifie ce qui est reste a notifier', async () => {
    const w = monde({
      compte: MOI_NU,
      curseur: new Date(AVANT),
      conversations: { statut: 200, corps: charge({ id: 'm1', de: 'ACoAAjeanne' }) },
      contactsParUrn: { ACoAAjeanne: ['c1'] },
      nonNotifiees: [{ provider_message_id: 'urn:li:msg_message:m1', body: 'Bonjour, oui' }],
    });
    // 1 : balayage de debut (passe) ; 2 : notification du message du passage (echoue) ; 3 : balayage de fin (passe).
    mocks.notifier.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.notifier).toHaveBeenCalledTimes(3);
    expect(mocks.notifier).toHaveBeenLastCalledWith(expect.anything(), ORG, 'Nouvelle réponse LinkedIn', 'Bonjour, oui');
    expect(w.journal.filter((l) => l === 'balayage')).toHaveLength(2);
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

describe('le filet des notifications (les entrants jamais notifies)', () => {
  const enAttente = [{ provider_message_id: 'urn:li:msg_message:m9', body: 'Reponse restee sans notification' }];

  it('une reponse non notifiee d un passage precedent est notifiee des le debut, curseur et conversations inchanges', async () => {
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 200, corps: charge() }, nonNotifiees: enAttente });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.notifier).toHaveBeenCalledTimes(1);
    expect(mocks.notifier).toHaveBeenCalledWith(expect.anything(), ORG, 'Nouvelle réponse LinkedIn', 'Reponse restee sans notification');
    expect(w.journal).toContain('marque urn:li:msg_message:m9');
  });

  it('le balayage ne depend ni de la session, ni de la plage horaire, ni du navigateur', async () => {
    vi.setSystemTime(new Date('2026-10-13T01:00:00Z'));
    const w = monde({ session: null, nonNotifiees: enAttente });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.notifier).toHaveBeenCalledTimes(1);
    expect(w.ouvrir).not.toHaveBeenCalled();
  });

  it('un corps vide se notifie avec le texte lisible, jamais un corps vide', async () => {
    const w = monde({ session: null, nonNotifiees: [{ provider_message_id: 'urn:li:msg_message:m9', body: null }] });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(mocks.notifier.mock.calls[0]![3]).toBe(CORPS_REPONSE_SANS_TEXTE);
  });

  it('une notification qui echoue au balayage n arrete pas les suivantes, et ne leve pas', async () => {
    const w = monde({
      session: null,
      nonNotifiees: [...enAttente, { provider_message_id: 'urn:li:msg_message:m10', body: 'Deuxieme' }],
    });
    mocks.notifier.mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    await expect(traiterReleveLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
    expect(mocks.notifier).toHaveBeenCalledTimes(2);
  });

  it('une lecture du balayage qui echoue n emporte pas la releve', async () => {
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 200, corps: charge() }, balayageEchoue: true });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
    expect(etatEcrit(w)).toHaveLength(1);
  });

  it('la releve enregistre le compte connecte (account_seen_at) a chaque passage', async () => {
    const w = monde({ compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 200, corps: charge() } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.requetesSql.filter((r) => r.tag === 'linkedin_session_compte')).toHaveLength(1);
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

/** Un profil rendu par LinkedIn : l'URN et l'identifiant public qu'il porte. */
const profil = (slug: string, urn: string) => ({
  statut: 200,
  corps: { elements: [{ entityUrn: `urn:li:fsd_profile:${urn}`, publicIdentifier: slug }] },
});
const cand = (id: string, slug: string) => ({ id, linkedin_url: `https://www.linkedin.com/in/${slug}` });
const memorises = (w: Monde) => w.journal.filter((l) => l.startsWith('urn_contact'));
const tracesProfil = (w: Monde) => w.traces - 2;
const base = { compte: MOI_NU, curseur: new Date(AVANT), conversations: { statut: 200, corps: charge() } } as const;

describe('la resolution des URN manquants', () => {
  it('resout au plus trois contacts par passage, les premiers rendus (les plus recents), et memorise chaque URN', async () => {
    const w = monde({
      ...base,
      candidats: [cand('c1', 'a'), cand('c2', 'b'), cand('c3', 'c'), cand('c4', 'd'), cand('c5', 'e')],
      profils: { a: profil('a', 'ACoAAa'), b: profil('b', 'ACoAAb'), c: profil('c', 'ACoAAc'), d: profil('d', 'ACoAAd') },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.profilsDemandes).toEqual(['a', 'b', 'c']);
    expect(memorises(w)).toEqual([
      `urn_contact contact=c1 org=${ORG} urn=ACoAAa`,
      `urn_contact contact=c2 org=${ORG} urn=ACoAAb`,
      `urn_contact contact=c3 org=${ORG} urn=ACoAAc`,
    ]);
  });

  it('la lecture des candidats est bornee a l organisation du passage', async () => {
    const w = monde({ ...base });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.journal.find((l) => l.startsWith('candidats'))).toMatch(`org=${ORG} `);
  });

  it('chaque resolution est tracee AVANT son appel, et compte dans le budget (deux traces de la releve en plus)', async () => {
    const w = monde({ ...base, candidats: [cand('c1', 'a'), cand('c2', 'b')], profils: { a: profil('a', 'ACoAAa'), b: profil('b', 'ACoAAb') } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(tracesProfil(w)).toBe(2);
    const ordre = w.journal.filter((l) => l === 'trace' || l.startsWith('requete'));
    expect(ordre).toEqual(['trace', 'requete me', 'trace', 'requete conversations', 'trace', 'requete profil a', 'trace', 'requete profil b']);
  });

  it('la resolution vient APRES l ecriture du curseur de la releve', async () => {
    const w = monde({ ...base, candidats: [cand('c1', 'a')], profils: { a: profil('a', 'ACoAAa') } });
    await traiterReleveLinkedIn(deps(w), JOB);
    const ordre = w.journal.filter((l) => l.startsWith('etat ') || l.startsWith('requete profil'));
    expect(ordre.map((l) => l.split(' ')[0])).toEqual(['etat', 'requete']);
  });

  it('plafond atteint apres la releve : zero resolution, aucune lecture de candidats, le passage reussit et le curseur avance', async () => {
    // Exactement les deux requetes de la releve : le passage a lieu, il ne reste rien pour la resolution.
    const w = monde({ ...base, plafondHoraire: 60, requetesDeLHeure: 58, candidats: [cand('c1', 'a')], profils: { a: profil('a', 'ACoAAa') } });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
    expect(w.profilsDemandes).toEqual([]);
    expect(tracesProfil(w)).toBe(0);
    expect(etatEcrit(w)).toHaveLength(1);
    expect(sortie.error).toEqual([]);
  });

  it('un budget de deux resolutions restantes n en laisse partir que deux', async () => {
    const w = monde({
      ...base,
      plafondHoraire: 60,
      requetesDeLHeure: 56,
      candidats: [cand('c1', 'a'), cand('c2', 'b'), cand('c3', 'c')],
      profils: { a: profil('a', 'ACoAAa'), b: profil('b', 'ACoAAb'), c: profil('c', 'ACoAAc') },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.profilsDemandes).toEqual(['a', 'b']);
  });

  it('une resolution qui echoue n emporte pas le passage : la suivante est tentee, le curseur avance, rien ne leve', async () => {
    const w = monde({ ...base, candidats: [cand('c1', 'a'), cand('c2', 'b')], profils: { a: { statut: 404 }, b: profil('b', 'ACoAAb') } });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
    expect(etatEcrit(w)).toHaveLength(1);
    expect(memorises(w)).toEqual([`urn_contact contact=c2 org=${ORG} urn=ACoAAb`]);
    expect(sortie.log.join('\n')).toContain('"resolues":1,"echecs":1');
  });

  it('une requete qui plante (reseau) n emporte pas le passage non plus', async () => {
    const w = monde({ ...base, candidats: [cand('c1', 'a')], profils: { a: new Error('net::ERR http://proxy:secret@x') } });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
    expect(etatEcrit(w)).toHaveLength(1);
    expect(sortie.error.join('\n')).not.toContain('secret');
  });

  it('une memorisation qui echoue n emporte pas le passage', async () => {
    const w = monde({ ...base, urnEchoue: true, candidats: [cand('c1', 'a')], profils: { a: profil('a', 'ACoAAa') } });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
    expect(etatEcrit(w)).toHaveLength(1);
  });

  it('une lecture de candidats qui echoue n emporte pas le passage', async () => {
    const w = monde({ ...base, candidatsEchoue: true });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
    expect(etatEcrit(w)).toHaveLength(1);
    expect(w.fermer).toHaveBeenCalledTimes(1);
  });

  it('une adresse qui n est pas une page de profil n est jamais passee a la resolution, et ne consomme ni budget ni trace', async () => {
    const w = monde({
      ...base,
      candidats: [
        { id: 'x1', linkedin_url: 'https://www.linkedin.com/in/' },
        { id: 'x2', linkedin_url: 'https://example.com/in/qqn' },
        { id: 'x3', linkedin_url: 'https://www.linkedin.com/company/acme' },
        cand('c1', 'a'),
      ],
      profils: { a: profil('a', 'ACoAAa') },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.profilsDemandes).toEqual(['a']);
    expect(tracesProfil(w)).toBe(1);
  });

  it('une session refusee (cookie) arrete la boucle et bloque la session, sans lever', async () => {
    const w = monde({ ...base, candidats: [cand('c1', 'a'), cand('c2', 'b')], profils: { a: { statut: 401 }, b: profil('b', 'ACoAAb') } });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
    expect(w.profilsDemandes).toEqual(['a']);
    expect(w.requetesSql.some((r) => r.tag === 'linkedin_session_bloquer')).toBe(true);
    expect(etatEcrit(w)).toHaveLength(1);
  });

  it('une limitation (429) arrete la boucle sans bloquer la session', async () => {
    const w = monde({ ...base, candidats: [cand('c1', 'a'), cand('c2', 'b')], profils: { a: { statut: 429 }, b: profil('b', 'ACoAAb') } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.profilsDemandes).toEqual(['a']);
    expect(w.requetesSql.some((r) => r.tag === 'linkedin_session_bloquer')).toBe(false);
  });

  it('une releve qui a des echecs individuels leve toujours, mais resout quand meme, et le verrou est rendu', async () => {
    mocks.enregistrer.mockRejectedValue(new Error('base'));
    const w = monde({ ...base, contactsParUrn: { ACoAAdupont: ['c-1'] }, conversations: { statut: 200, corps: charge({ id: 'a', de: 'ACoAAdupont' }) }, candidats: [cand('c9', 'z')], profils: { z: profil('z', 'ACoAAz') } });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).rejects.toThrow(/n’ont pas pu être traitées/);
    expect(etatEcrit(w)).toEqual([]);
    expect(w.profilsDemandes).toEqual(['z']);
    expect(w.journal.filter((l) => l.startsWith('verrou')).at(-1)).toMatch(/ 0$/);
  });

  it('un compte change ne resout rien : le passage s arrete avant', async () => {
    const w = monde({ compte: 'ACoAAancien', curseur: new Date(AVANT), candidats: [cand('c1', 'a')], profils: { a: profil('a', 'ACoAAa') } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.profilsDemandes).toEqual([]);
  });

  it('le journal du passage porte les compteurs de la resolution', async () => {
    const w = monde({ ...base, candidats: [cand('c1', 'a')], profils: { a: profil('a', 'ACoAAa') } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(sortie.log.join('\n')).toContain('resolution {"candidats":1,"tentees":1,"resolues":1,"echecs":0,"interrompu":false}');
  });
});

const irresolus = (w: Monde) => w.journal.filter((l) => l.startsWith('irresolu'));

describe('la memoire des echecs definitifs de resolution', () => {
  it('un profil introuvable (404) est date, borne a l organisation, et la boucle continue', async () => {
    const w = monde({ ...base, candidats: [cand('c1', 'a'), cand('c2', 'b')], profils: { a: { statut: 404 }, b: profil('b', 'ACoAAb') } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(irresolus(w)).toEqual([`irresolu org=${ORG} ids=c1`]);
    expect(w.profilsDemandes).toEqual(['a', 'b']);
  });

  it.each([
    ['5xx', { statut: 503 }],
    ['reseau', new Error('net::ERR_FAILED')],
    ['reponse illisible', { statut: 200, corps: 'pas du json' }],
    ['cookie refuse (401)', { statut: 401 }],
    ['defi (999)', { statut: 999 }],
    ['limitation (429)', { statut: 429 }],
    ['403', { statut: 403 }],
  ])('un echec qui peut reussir demain (%s) ne date rien', async (_nom, reponse) => {
    const w = monde({ ...base, candidats: [cand('c1', 'a')], profils: { a: reponse as { statut: number } } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.profilsDemandes).toEqual(['a']);
    expect(irresolus(w)).toEqual([]);
  });

  it('les adresses qui ne sont pas une page de profil sont datees en UNE requete, et jamais interrogees', async () => {
    const w = monde({
      ...base,
      candidats: [
        { id: 'x1', linkedin_url: 'https://www.linkedin.com/in/' },
        { id: 'x2', linkedin_url: 'https://example.com/in/qqn' },
        cand('c1', 'a'),
      ],
      profils: { a: profil('a', 'ACoAAa') },
    });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(irresolus(w)).toEqual([`irresolu org=${ORG} ids=x1,x2`]);
    expect(w.profilsDemandes).toEqual(['a']);
  });

  it('rien a dater : aucune requete d ecriture', async () => {
    const w = monde({ ...base, candidats: [cand('c1', 'a')], profils: { a: profil('a', 'ACoAAa') } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(w.requetesSql.some((r) => r.tag === 'contact_urn_tentee')).toBe(false);
  });

  it('une ecriture de date qui echoue n emporte pas le passage ni la boucle', async () => {
    const w = monde({ ...base, tenteeEchoue: true, candidats: [cand('c1', 'a'), cand('c2', 'b')], profils: { a: { statut: 404 }, b: profil('b', 'ACoAAb') } });
    await expect(traiterReleveLinkedIn(deps(w), JOB)).resolves.toBeUndefined();
    expect(w.profilsDemandes).toEqual(['a', 'b']);
    expect(etatEcrit(w)).toHaveLength(1);
    expect(memorises(w)).toHaveLength(1);
  });

  it('la date d un echec ne passe pas pour un succes : compteur d echecs inchange', async () => {
    const w = monde({ ...base, candidats: [cand('c1', 'a')], profils: { a: { statut: 404 } } });
    await traiterReleveLinkedIn(deps(w), JOB);
    expect(sortie.log.join('\n')).toContain('"resolues":0,"echecs":1');
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
