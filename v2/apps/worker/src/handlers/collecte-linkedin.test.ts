/**
 * Tâche 7 — le collecteur d'engageurs.
 *
 * Ce fichier prouve L'ENCHAÎNEMENT des décisions : quelles requêtes partent (et
 * surtout lesquelles ne partent pas), quelle friction est reconnue, et ce que le
 * handler refuse de faire. Le pool est factice : il ne prouve RIEN du SQL ni de
 * l'état en base. Ces preuves-là vivent dans `test/pg-verify/linkedin-collecte.sh`,
 * qui exécute le même code de production sur un vrai Postgres.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUEUES, lienProfilDeduit } from '@jay-reach/core';
import type { Pilote } from '../linkedin/navigateur.js';
import { lireEngageurs, type Budget } from '../linkedin/engageurs.js';
import { MSG, traiterCollecteLinkedIn, type DependancesCollecte } from './collecte-linkedin.js';
import { urlRecherche } from '../linkedin/recherche.js';

// --------------------------------------------------------------- pilote factice

interface PiloteFactice {
  pilote: Pilote;
  requetes: string[];
  navigations: string[];
}

function pilote(opts: {
  url?: string;
  reponse?: (url: string) => { statut: number; corps: string };
}): PiloteFactice {
  const requetes: string[] = [];
  const navigations: string[] = [];
  return {
    requetes,
    navigations,
    pilote: {
      aller: async (u) => {
        navigations.push(u);
      },
      url: async () => opts.url ?? POST,
      saisir: async () => undefined,
      presserEntree: async () => undefined,
      texte: async () => '',
      attendre: async () => false,
      requete: async (u) => {
        requetes.push(u);
        const r = opts.reponse?.(u);
        if (!r) throw new Error(`requête non prévue : ${u}`);
        return r;
      },
      fermer: async () => undefined,
    },
  };
}

const POST = 'https://www.linkedin.com/feed/update/urn:li:activity:7271000000000000001/';
const SANS_PAUSE = async (): Promise<void> => undefined;
const TRACE_MUETTE = async (): Promise<void> => undefined;
const BUDGET: Budget = { requetesRestantes: 10, postsRestants: 3 };

/** Réponse Voyager normalisée : les profils vivent dans `included`, le total dans `data.paging`. */
function voyager(profils: { id: string; prenom: string; nom: string; titre: string; public?: string }[], total = profils.length) {
  return JSON.stringify({
    data: {
      paging: { start: 0, count: 50, total },
      elements: profils.map((p) => ({ reactionType: 'LIKE', actorUrn: `urn:li:fsd_profile:${p.id}` })),
    },
    included: profils.map((p) => ({
      $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
      entityUrn: `urn:li:fsd_profile:${p.id}`,
      firstName: p.prenom,
      lastName: p.nom,
      headline: p.titre,
      ...(p.public ? { publicIdentifier: p.public } : {}),
    })),
  });
}

// ----------------------------------------------------------------- base factice

interface Ecriture {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * Pool factice : il répond aux lectures dont le handler a besoin pour avancer, et
 * enregistre les écritures. Les réponses sont reconnues par un fragment stable de
 * chaque requête — ce qui prouve l'enchaînement, pas le SQL (voir l'en-tête).
 */
function base(opts: {
  session?: { status: string; expected_egress_ip: string | null } | null;
  source?: Record<string, unknown> | null;
  derniersPassages?: string[];
  verrou?: boolean;
  plafonds?: { posts?: number; requetes?: number; personnes?: number };
  postsDuJour?: number;
  requetesDeLHeure?: number;
  /** Les posts que cette source a deja traites, pour la boucle multi-posts du lot 4b etape 2. */
  postsTraites?: string[];
  /** Les `external_id` des personnes que la recherche par mots-clés a déjà enregistrées pour cette source. */
  personnesEnregistrees?: string[];
  /** Les contacts de l'organisation, pour la source « changement de poste ». L'état se met à jour comme la base. */
  contacts?: ContactFactice[];
}) {
  const contacts = (opts.contacts ?? []).map((c) => ({ ...c }));
  let horloge = 0;
  const ecritures: Ecriture[] = [];
  const rep = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const query = async (sql: string, params: unknown[] = []) => {
    const t = String(sql);
    if (t.includes('jr:linkedin_session_lire')) {
      return rep(opts.session === undefined ? [{ status: 'active', expected_egress_ip: null }] : opts.session ? [opts.session] : []);
    }
    if (t.includes('jr:linkedin_session_verrou')) {
      ecritures.push({ sql: 'verrou', params });
      return rep(opts.verrou === false ? [] : [{}]);
    }
    if (t.includes('jr:linkedin_session_bloquer')) {
      ecritures.push({ sql: 'bloquer', params });
      return rep([{}]);
    }
    if (t.includes('jr:linkedin_session_observer') || t.includes('jr:linkedin_collecte_marquer')) {
      ecritures.push({ sql: 'session', params });
      return rep([]);
    }
    if (t.includes('jr:linkedin_collecte_source')) {
      const config = opts.source === undefined ? { sourceType: 'linkedin_post_engagers', urlPost: POST, garder: ['reagi'] } : opts.source;
      return rep(config ? [{ config, campagne_id: 'camp-1', personas: ['persona-1'] }] : []);
    }
    if (t.includes('jr:linkedin_collecte_derniers')) {
      return rep((opts.derniersPassages ?? []).map((status) => ({ status })));
    }
    if (t.includes('jr:linkedin_collecte_clore')) {
      ecritures.push({ sql: 'clore', params });
      return rep([{}]);
    }
    if (t.includes('jr:plafond_du_jour') || t.includes('organization_settings')) {
      // La clé voyage en PARAMÈTRE (`key = $2`), jamais dans le texte du SQL.
      const valeur =
        params[1] === 'linkedin_posts_par_jour'
          ? (opts.plafonds?.posts ?? 3)
          : params[1] === 'linkedin_personnes_par_passage'
            ? (opts.plafonds?.personnes ?? 100)
            : (opts.plafonds?.requetes ?? 60);
      return rep([{ value: String(valeur) }]);
    }
    if (t.includes('jr:linkedin_posts_du_jour')) return rep([{ n: opts.postsDuJour ?? 1 }]);
    if (t.includes('linkedin_posts_traites')) {
      if (t.includes('insert')) {
        ecritures.push({ sql: 'post_traite', params });
        return rep([]);
      }
      return rep((opts.postsTraites ?? []).map((post_urn) => ({ post_urn })));
    }
    // Reconnue par son marqueur, jamais par son texte : voir l'en-tête.
    if (t.includes('jr:linkedin_collecte_recherche_vus')) {
      return rep((opts.personnesEnregistrees ?? []).map((external_id) => ({ external_id })));
    }
    // La sélection de la rotation. Le pool factice rejoue le CONTRAT (jamais-relus d'abord, puis le
    // moins récemment relu, au plus `limite`, adresses déduites écartées SI le préfixe est fourni) :
    // il ne prouve pas le SQL, c'est le rôle du harnais Postgres.
    if (t.includes('jr:linkedin_collecte_a_relire')) {
      const limite = Number(params[1]);
      const prefixeDeduit = params[2];
      const lisibles = contacts.filter((c) => !(c.deduite === true && prefixeDeduit === lienProfilDeduit('')));
      lisibles.sort((a, b) => (a.verifieLe ?? -1) - (b.verifieLe ?? -1) || a.id.localeCompare(b.id));
      return rep(lisibles.slice(0, limite).map((c) => ({ id: c.id, linkedin_url: c.url, job_title: c.titre })));
    }
    if (t.includes('jr:linkedin_collecte_verifie')) {
      ecritures.push({ sql: 'verifie', params });
      const contact = contacts.find((c) => c.id === params[1]);
      if (contact) {
        contact.verifieLe = ++horloge;
        if (!contact.titre?.trim() && typeof params[2] === 'string') contact.titre = params[2];
      }
      return rep([]);
    }
    // `enregistrerChangementDePoste` verrouille la fiche : reconnue par sa table et son verrou.
    if (t.includes('from contacts') && t.includes('for update')) {
      return rep(contacts.some((c) => c.id === params[1]) ? [{ id: params[1] }] : []);
    }
    if (t.includes('jr:linkedin_requetes_compter')) return rep([{ n: opts.requetesDeLHeure ?? 0 }]);
    if (t.includes('jr:linkedin_requete_tracer')) {
      ecritures.push({ sql: 'tracer', params });
      return rep([{}]);
    }
    if (t.includes('jr:linkedin_fuseau')) return rep([]);
    // Un engageur inconnu : l'insertion du signal rend son identifiant, donc l'issue est `nouveau`.
    if (t.includes('insert into signals')) {
      ecritures.push({ sql: 'signal', params });
      return rep([{ id: `signal-${params[2]}` }]);
    }
    if (t.includes('begin') || t.includes('commit') || t.includes('rollback')) return rep([]);
    // Notifications, journal d'activité, enregistrement d'un engageur : sans effet ici.
    ecritures.push({ sql: t.trim().slice(0, 40), params });
    return rep([]);
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  return { pool, ecritures, contacts };
}

/** Un contact de la base factice : de quoi l'ordonner, le relire et le comparer. */
interface ContactFactice {
  readonly id: string;
  readonly url: string;
  titre: string | null;
  verifieLe: number | null;
  /** Adresse fabriquée depuis un URN : ne mène à aucune page lisible. */
  readonly deduite?: boolean;
}

function deps(
  p: PiloteFactice,
  b: ReturnType<typeof base>,
  extra: Partial<DependancesCollecte> = {},
): DependancesCollecte {
  return {
    pool: b.pool as unknown as DependancesCollecte['pool'],
    env: { JAY_REACH_LINKEDIN: '1' },
    ouvrirNavigateur: async () => p.pilote,
    releverSortie: async () => ({ ip: '203.0.113.7' }),
    pause: SANS_PAUSE,
    ...extra,
  };
}

const JOB = { organizationId: 'org-1', sourceId: 'src-1', sourceRunId: 'run-1' };
const bloque = (b: ReturnType<typeof base>) => b.ecritures.filter((e) => e.sql === 'bloquer').map((e) => e.params[1]);
const clos = (b: ReturnType<typeof base>) => b.ecritures.find((e) => e.sql === 'clore');

afterEach(() => vi.restoreAllMocks());

// ------------------------------------------------------------------------ tests

describe('lireEngageurs', () => {
  it('un post introuvable arrete le passage sans bloquer la session', async () => {
    const p = pilote({ reponse: () => ({ statut: 404, corps: '' }) });
    const r = await lireEngageurs(p.pilote, POST, ['reagi'], BUDGET, TRACE_MUETTE, SANS_PAUSE);
    expect(r.arret).toEqual({ type: 'post_introuvable' });
    expect(r.personnes).toEqual([]);
  });

  it('le plafond atteint en cours de pagination termine le passage proprement et n’est pas rejoue', async () => {
    // Cent vingt engageurs annoncés, donc trois pages. Budget de deux requêtes :
    // le chargement de la page du post en prend une, il reste un appel Voyager.
    const p = pilote({
      reponse: () => ({ statut: 200, corps: voyager([{ id: 'ACoAAa', prenom: 'Ada', nom: 'Lovelace', titre: 'Directrice commerciale chez Acme' }], 120) }),
    });
    const r = await lireEngageurs(p.pilote, POST, ['reagi'], { requetesRestantes: 2, postsRestants: 3 }, TRACE_MUETTE, SANS_PAUSE);
    expect(p.requetes).toHaveLength(1);
    expect(r.arret).toBe('plafond');
    expect(r.personnes).toHaveLength(1); // ce qui a été vu est gardé
  });

  it('le chargement de la page du post est compte comme une requete', async () => {
    const p = pilote({ reponse: () => ({ statut: 200, corps: voyager([]) }) });
    const traces: number[] = [];
    await lireEngageurs(p.pilote, POST, ['reagi'], { requetesRestantes: 1, postsRestants: 3 }, async () => {
      traces.push(1);
    }, SANS_PAUSE);
    // Le budget d'une requête est entièrement consommé par la navigation : aucun
    // appel Voyager ne part, et la trace a bien été posée.
    expect(traces).toHaveLength(1);
    expect(p.navigations).toEqual([POST]);
    expect(p.requetes).toEqual([]);
  });

  it('un statut 999 bloque la session', async () => {
    const b = base({});
    const p = pilote({ reponse: () => ({ statut: 999, corps: '' }) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(bloque(b)).toEqual(['defi']);
    expect(clos(b)?.params[2]).toBe('error');
  });

  it('un defi bloque la session et aucune requete ne suit', async () => {
    const b = base({});
    const p = pilote({ url: 'https://www.linkedin.com/checkpoint/challenge/', reponse: () => ({ statut: 200, corps: voyager([]) }) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(p.requetes).toEqual([]);
    expect(bloque(b)).toEqual(['defi']);
    // Un rejeu rouvrirait le navigateur sur une session que LinkedIn conteste
    // déjà : la file n'a pas le droit de reprendre.
    expect(QUEUES.find((q) => q.name === 'linkedin.collecte')?.retry.retryLimit).toBe(0);
  });

  it('une liste vide sur un post qui affiche des reactions arrete le passage sans bloquer la session', async () => {
    const b = base({});
    const p = pilote({ reponse: () => ({ statut: 200, corps: voyager([], 42) }) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(bloque(b)).toEqual([]);
    expect(clos(b)?.params[2]).toBe('error');
  });
});

describe('le handler de collecte', () => {
  it('le handler sort immediatement si la session est bloquee', async () => {
    const b = base({ session: { status: 'bloquee', expected_egress_ip: null } });
    const p = pilote({});
    const ouvrir = vi.fn(async () => p.pilote);
    await traiterCollecteLinkedIn(deps(p, b, { ouvrirNavigateur: ouvrir }), JOB);
    expect(ouvrir).not.toHaveBeenCalled();
    expect(p.requetes).toEqual([]);
    expect(clos(b)?.params[2]).toBe('error');
  });

  it('le handler sort si JAY_REACH_LINKEDIN n’est pas pose', async () => {
    const b = base({});
    const p = pilote({});
    const ouvrir = vi.fn(async () => p.pilote);
    await traiterCollecteLinkedIn(deps(p, b, { env: {}, ouvrirNavigateur: ouvrir }), JOB);
    expect(ouvrir).not.toHaveBeenCalled();
    expect(bloque(b)).toEqual([]);
  });

  it('trois erreurs consecutives bloquent la session avec le motif disjoncteur', async () => {
    const b = base({ derniersPassages: ['error', 'error', 'error'] });
    const p = pilote({
      reponse: () => {
        throw new Error('réseau');
      },
    });
    await expect(traiterCollecteLinkedIn(deps(p, b), JOB)).rejects.toThrow();
    expect(bloque(b)).toEqual(['disjoncteur']);
  });

  it('deux echecs seulement ne bloquent rien', async () => {
    const b = base({ derniersPassages: ['error', 'error', 'success'] });
    const p = pilote({
      reponse: () => {
        throw new Error('réseau');
      },
    });
    await expect(traiterCollecteLinkedIn(deps(p, b), JOB)).rejects.toThrow();
    expect(bloque(b)).toEqual([]);
  });
});

// --------------------------------------------------- refus muets : le journal du worker
describe('les refus avant toute requête LinkedIn laissent une ligne au journal', () => {
  /** Ce que le worker écrit sur la sortie d'avertissement pendant un passage. */
  async function avertissements(b: ReturnType<typeof base>, extra: Partial<DependancesCollecte> = {}) {
    const lignes: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      lignes.push(a.join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const p = pilote({ reponse: () => ({ statut: 200, corps: voyager([]) }) });
    await traiterCollecteLinkedIn(deps(p, b, extra), JOB);
    return lignes;
  }

  it('canal désactivé', async () => {
    expect(await avertissements(base({}), { env: {} })).toEqual([expect.stringContaining('JAY_REACH_LINKEDIN')]);
  });

  it('session non active', async () => {
    const lignes = await avertissements(base({ session: { status: 'bloquee', expected_egress_ip: null } }));
    expect(lignes).toEqual([expect.stringContaining('session LinkedIn')]);
  });

  it('source sans campagne active', async () => {
    expect(await avertissements(base({ source: null }))).toEqual([expect.stringContaining('aucune campagne active')]);
  });

  it('verrou tenu', async () => {
    expect(await avertissements(base({ verrou: false }))).toEqual([expect.stringContaining('déjà le navigateur')]);
  });

  it('plafond de requêtes atteint, plafond de personnes à zéro', async () => {
    expect(await avertissements(base({ postsDuJour: 0, requetesDeLHeure: 60 }))).toEqual([expect.stringContaining('requêtes')]);
    expect(await avertissements(base({ plafonds: { personnes: 0 } }))).toEqual([expect.stringContaining('personnes par passage')]);
  });

  it('la ligne porte le passage et le message, jamais une clé ni une adresse de proxy', async () => {
    const [ligne] = await avertissements(base({}), { env: {} });
    expect(ligne).toContain('run-1');
    expect(ligne).not.toMatch(/https?:\/\//);
  });
});

// ------------------------------------------- bilan écrit : de quoi l'écran Sources lit
describe('le bilan du passage', () => {
  const P = (n: number, o: { public?: boolean } = {}) =>
    Array.from({ length: n }, (_, i) => ({
      id: `ACoAA${String(i).padStart(4, '0')}`,
      prenom: 'Léa',
      nom: `N${i}`,
      titre: 'Directrice commerciale chez Acme',
      ...(o.public ? { public: `lea-n${i}` } : {}),
    }));

  async function passer(profils: ReturnType<typeof P>, plafondPersonnes: number) {
    const b = base({ plafonds: { personnes: plafondPersonnes } });
    const p = pilote({ reponse: () => ({ statut: 200, corps: voyager(profils) }) });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    return { b, c: clos(b)! };
  }
  // Positions des paramètres de `jr:linkedin_collecte_clore` : $5 vus, $6 nouveaux, $13 ignores,
  // $15 adresses déduites, $16 plafond de personnes atteint.
  const colonnes = (c: Ecriture) => ({
    vus: c.params[4],
    nouveaux: c.params[5],
    ignores: c.params[12],
    opposes: c.params[13],
    deduites: c.params[14],
    plafond: c.params[15],
    erreur: c.params[3],
  });

  it('un passage qui atteint le plafond de personnes s’arrête proprement, et le dit', async () => {
    const { c } = await passer(P(5), 3);
    expect(colonnes(c)).toMatchObject({ vus: 5, nouveaux: 3, plafond: true, erreur: expect.stringContaining('Plafond de personnes') });
    expect(c.params[2]).toBe('success');
  });

  it('un post qui tient exactement dans le plafond ne le déclenche pas', async () => {
    const { c } = await passer(P(3), 3);
    expect(colonnes(c)).toMatchObject({ nouveaux: 3, plafond: false, erreur: null });
  });

  it('compte les personnes enregistrées sous une adresse déduite de l’URN', async () => {
    const { c } = await passer([...P(2), ...P(2, { public: true }).map((x, i) => ({ ...x, id: `ACoAB${i}` }))], 100);
    expect(colonnes(c)).toMatchObject({ nouveaux: 4, deduites: 2 });
  });
});

/**
 * Lot 4b, etape 2 : la boucle multi-posts d'une source « posts d'un concurrent ».
 *
 * Le harnais pg-verify l'eprouve sur un vrai Postgres, mais il ne tourne pas en CI : ces
 * controles-ci gardent la LOGIQUE du handler (branchements, compteurs, ce qui est ecrit) a chaque
 * build.
 */
describe('la source « posts d’un concurrent »', () => {
  const PAGE = 'https://www.linkedin.com/company/acme/';
  const A = 'urn:li:activity:7271000000000000011';
  const B = 'urn:li:activity:7271000000000000012';
  const htmlPage = (nom: string, id: string) =>
    `<html><code>{&quot;entityUrn&quot;:&quot;urn:li:fsd_company:${id}&quot;,&quot;universalName&quot;:&quot;${nom}&quot;}</code></html>`;
  const lotDePosts = (urns: string[]) =>
    JSON.stringify({
      data: { data: { flux: { paging: { count: 10, start: 0, total: urns.length }, '*elements': urns.map((u) => `urn:li:fsd_update:(${u},COMPANY_FEED_RELEVANCE)`) } } },
    });
  const sourceConcurrent = (pages: string[]) => ({ sourceType: 'linkedin_competitor_posts', pagesConcurrentes: pages, garder: ['reagi'] });
  // Deux personnes inventees : le depot interdit les fixtures portant de vraies personnes.
  const UNE = { id: 'ACoAAaaa', prenom: 'Ada', nom: 'Lovelace', titre: 'Directrice commerciale' };
  const AUTRE = { id: 'ACoAAbbb', prenom: 'Bob', nom: 'Durand', titre: 'Directeur commercial' };

  /** Repond selon ce qui est demande : le HTML de la page, la liste de ses posts, puis les engageurs. */
  const repondre = (urns: string[], profils: Record<string, Parameters<typeof voyager>[0]>) => (u: string) => {
    if (u.includes('/company/')) return { statut: 200, corps: htmlPage('acme', '777') };
    if (u.includes('organizationalPageUrn')) return { statut: 200, corps: lotDePosts(urns) };
    const post = urns.find((x) => u.includes(x.split(':').pop() ?? ''));
    return { statut: 200, corps: voyager(profils[post ?? ''] ?? []) };
  };

  it('lit les engageurs de chaque post trouve, et compte les posts ouverts', async () => {
    const b = base({ source: sourceConcurrent([PAGE]) });
    const p = pilote({ reponse: repondre([A, B], { [A]: [UNE], [B]: [AUTRE] }) });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    // `posts` est le DERNIER parametre de la cloture : c'est lui que le plafond du jour additionne.
    expect(c.params[c.params.length - 1]).toBe(2);
    expect(b.ecritures.filter((e) => e.sql === 'post_traite')).toHaveLength(2);
  });

  it('ne relit pas un post que la memoire dit deja traite', async () => {
    const b = base({ source: sourceConcurrent([PAGE]), postsTraites: [A] });
    const p = pilote({ reponse: repondre([A, B], { [A]: [UNE], [B]: [AUTRE] }) });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(c.params[c.params.length - 1]).toBe(1);
  });

  // Avant ce correctif, une seule adresse mal collee faisait perdre les posts deja trouves sur
  // les autres pages — et comme rien n'etait marque traite, tous les jours a l'identique.
  it('une page illisible n’emporte pas les posts des autres pages', async () => {
    const b = base({ source: sourceConcurrent([PAGE, 'Upsell']) });
    const p = pilote({ reponse: repondre([A], { [A]: [UNE] }) });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(c.params[2]).toBe('success');
    expect(c.params[c.params.length - 1]).toBe(1);
    // L'ecran dit quand meme qu'une page n'a pas pu etre lue : la recolte est partielle.
    expect(String(c.params[3])).toContain('Upsell');
  });

  // Un 999 rencontre en CHERCHANT les posts est un verdict sur le compte, pas sur la page :
  // sans ca la session restait active et le tour automatique repartait le lendemain.
  it('un defi pendant la recherche suspend la session', async () => {
    const b = base({ source: sourceConcurrent([PAGE]) });
    const p = pilote({ reponse: () => ({ statut: 999, corps: '' }) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await traiterCollecteLinkedIn(deps(p, b), JOB).catch(() => undefined);
    expect(bloque(b)).toContain('defi');
    expect(String(clos(b)!.params[3])).toContain('vérification');
  });
});

/**
 * La source « posts d'un créateur » : même boucle que le concurrent, la recherche de posts passe
 * par `trouverPostsDeProfil` (résolution du nom public, puis page d'activité).
 */
describe('la source « posts d’un créateur »', () => {
  const PROFIL = 'https://www.linkedin.com/in/ada-exemple/';
  const ARRIVEE = 'https://www.linkedin.com/in/ada-exemple/';
  const A = 'urn:li:activity:7271000000000000021';
  const B = 'urn:li:activity:7271000000000000022';
  const htmlActivite = (urns: string[]) =>
    `<html>${urns.map((u) => `<a href="https://www.linkedin.com/feed/update/${u}/">post</a>`).join('')}</html>`;
  const sourceCreateur = (profils: string[]) => ({ sourceType: 'linkedin_creator_posts', profilsCreateurs: profils, garder: ['reagi'] });
  const UNE = { id: 'ACoAAccc', prenom: 'Cleo', nom: 'Martin', titre: 'Directrice commerciale' };
  const AUTRE = { id: 'ACoAAddd', prenom: 'Dan', nom: 'Leroy', titre: 'Directeur commercial' };

  const repondre = (urns: string[], profils: Record<string, Parameters<typeof voyager>[0]>) => (u: string) => {
    if (u.includes('recent-activity')) return { statut: 200, corps: htmlActivite(urns) };
    const post = urns.find((x) => u.includes(x.split(':').pop() ?? ''));
    return { statut: 200, corps: voyager(profils[post ?? ''] ?? []) };
  };

  it('trouve les posts du profil, lit leurs engageurs et compte les posts ouverts', async () => {
    const b = base({ source: sourceCreateur([PROFIL]) });
    const p = pilote({ url: ARRIVEE, reponse: repondre([A, B], { [A]: [UNE], [B]: [AUTRE] }) });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(c.params[2]).toBe('success');
    expect(c.params[c.params.length - 1]).toBe(2);
    expect(b.ecritures.filter((e) => e.sql === 'post_traite')).toHaveLength(2);
  });

  it('ne relit pas un post que la mémoire dit déjà traité', async () => {
    const b = base({ source: sourceCreateur([PROFIL]), postsTraites: [A] });
    const p = pilote({ url: ARRIVEE, reponse: repondre([A, B], { [A]: [UNE], [B]: [AUTRE] }) });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(clos(b)!.params[clos(b)!.params.length - 1]).toBe(1);
  });

  it('un profil illisible n’emporte pas les posts des autres profils', async () => {
    const b = base({ source: sourceCreateur([PROFIL, 'Upsell']) });
    const p = pilote({ url: ARRIVEE, reponse: repondre([A], { [A]: [UNE] }) });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(c.params[2]).toBe('success');
    expect(c.params[c.params.length - 1]).toBe(1);
    expect(String(c.params[3])).toContain('Upsell');
  });

  it('tous les profils illisibles : le passage échoue et dit pourquoi', async () => {
    const b = base({ source: sourceCreateur(['Upsell']) });
    const p = pilote({ url: ARRIVEE, reponse: repondre([], {}) });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(c.params[2]).toBe('error');
    expect(String(c.params[3])).toContain('Upsell');
  });

  it('lit la liste `profilsCreateurs`, jamais `pagesConcurrentes`', async () => {
    const b = base({ source: { sourceType: 'linkedin_creator_posts', pagesConcurrentes: [PROFIL], garder: ['reagi'] } });
    const p = pilote({ url: ARRIVEE, reponse: repondre([A], { [A]: [UNE] }) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    // Sans `profilsCreateurs`, la source est refusée avant toute requête vers LinkedIn.
    expect(String(clos(b)?.params[3] ?? '')).toContain('Aucun profil de créateur');
    expect(p.requetes).toEqual([]);
  });
});

/**
 * La source « recherche par mot-clé » : aucun post, des personnes trouvées par recherche et
 * enregistrées directement. Le bilan et les plafonds sont ceux des autres sources.
 */
describe('la source « recherche par mot-clé »', () => {
  const MOTS = 'CRM  commercial';
  const sourceMots = (sujets: string[]) => ({ sourceType: 'linkedin_keywords', sujets });
  const resultat = (slug: string, nom: string, intitule: string): string =>
    `role="listitem"><a href="https://www.linkedin.com/in/${slug}/" aria-label="${nom}">` +
    `<span>${nom}</span><span>• 2e</span><span>${intitule}</span></a>`;
  const ADA = resultat('ada-exemple', 'Ada Exemple', 'Directrice commerciale chez Acme');
  const LEO = resultat('leo-exemple', 'Leo Exemple', 'Directeur commercial chez Beta');
  /** Une page de résultats par numéro ; au-delà, une page vide (fin des résultats). */
  const pages = (...html: string[]) => (u: string) => {
    const n = Number(/[?&]page=(\d+)/.exec(u)?.[1] ?? '1');
    return { statut: 200, corps: `<html>${html[n - 1] ?? ''}</html>` };
  };
  const signaux = (b: ReturnType<typeof base>) => b.ecritures.filter((e) => e.sql === 'signal').map((e) => e.params[2]);
  const sansBruit = () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  };

  it('enregistre les personnes trouvées sous leurs mots-clés normalisés, sans lire aucun post', async () => {
    sansBruit();
    const b = base({ source: sourceMots([MOTS]) });
    const p = pilote({ reponse: pages(ADA + LEO) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(c.params[2]).toBe('success');
    expect(signaux(b)).toEqual(['crm commercial:ada-exemple', 'crm commercial:leo-exemple']);
    // vus, nouveaux : les deux personnes. posts : aucun, la source n'ouvre aucun post.
    expect(c.params[4]).toBe(2);
    expect(c.params[5]).toBe(2);
    expect(c.params[c.params.length - 1]).toBe(0);
    // Arrivée sur la recherche, puis la page 1, puis la page 2 (vide : fin des résultats).
    expect(p.navigations).toEqual([urlRecherche(MOTS, 1)]);
    expect(p.requetes).toEqual([urlRecherche(MOTS, 1), urlRecherche(MOTS, 2)]);
  });

  it('chaque requête, arrivée comprise, est tracée et comptée dans le bilan', async () => {
    sansBruit();
    const b = base({ source: sourceMots([MOTS]) });
    const p = pilote({ reponse: pages(ADA) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(b.ecritures.filter((e) => e.sql === 'tracer')).toHaveLength(3);
    expect(clos(b)!.params[6]).toBe(3);
  });

  it('ne rejoue pas les personnes déjà enregistrées pour ces mots-clés', async () => {
    sansBruit();
    const b = base({ source: sourceMots([MOTS]), personnesEnregistrees: ['crm commercial:ada-exemple'] });
    const p = pilote({ reponse: pages(ADA + LEO) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(signaux(b)).toEqual(['crm commercial:leo-exemple']);
    expect(clos(b)!.params[4]).toBe(1);
  });

  it('un sujet par recherche : chacun cherche sous ses propres mots-clés', async () => {
    sansBruit();
    const b = base({ source: sourceMots(['crm', 'erp']) });
    const p = pilote({ reponse: (u) => ({ statut: 200, corps: u.includes('keywords=crm') ? (u.includes('page=2') ? '' : ADA) : u.includes('page=2') ? '' : LEO }) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(signaux(b)).toEqual(['crm:ada-exemple', 'erp:leo-exemple']);
    expect(p.navigations).toEqual([urlRecherche('crm', 1), urlRecherche('erp', 1)]);
  });

  it('le plafond de posts du jour, épuisé, ne l’arrête pas : elle ne lit aucun post', async () => {
    sansBruit();
    const b = base({ source: sourceMots([MOTS]), plafonds: { posts: 3 }, postsDuJour: 3 });
    const p = pilote({ reponse: pages(ADA) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(clos(b)!.params[3]).not.toBe(MSG.plafond_posts);
    expect(signaux(b)).toHaveLength(1);
  });

  it('le plafond de requêtes de l’heure la borne, arrivée comprise, et le dit', async () => {
    sansBruit();
    // Deux requêtes restantes : l'arrivée en prend une, la page 1 l'autre, la page 2 ne part pas.
    const b = base({ source: sourceMots([MOTS]), requetesDeLHeure: 58 });
    const p = pilote({ reponse: pages(ADA, LEO) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(p.requetes).toEqual([urlRecherche(MOTS, 1)]);
    expect(signaux(b)).toHaveLength(1); // ce qui a été lu avant l'arrêt est gardé
    expect(c.params[2]).toBe('success');
    expect(c.params[3]).toBe(MSG.plafond_requetes);
  });

  it('le plafond de personnes par passage arrête l’enregistrement et le dit', async () => {
    sansBruit();
    const b = base({ source: sourceMots([MOTS]), plafonds: { personnes: 1 } });
    const p = pilote({ reponse: pages(ADA + LEO) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(signaux(b)).toEqual(['crm commercial:ada-exemple']);
    expect(c.params[3]).toBe(MSG.plafond_personnes);
    expect(c.params[c.params.length - 2]).toBe(true);
  });

  it('une recherche qui ne livre rien de neuf est un passage à vide, pas un échec', async () => {
    sansBruit();
    const b = base({ source: sourceMots([MOTS]) });
    const p = pilote({ reponse: pages('') });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(c.params[2]).toBe('success');
    expect(c.params[3]).toBe(MSG.recherche_vide);
  });

  it('sans mot-clé, la source est refusée avant toute requête vers LinkedIn', async () => {
    const b = base({ source: sourceMots(['  ']) });
    const p = pilote({});
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(clos(b)!.params[3]).toBe(MSG.mots_cles_absents);
    expect(p.requetes).toEqual([]);
    expect(p.navigations).toEqual([]);
  });

  it('un défi pendant la recherche suspend la session', async () => {
    sansBruit();
    const b = base({ source: sourceMots([MOTS]) });
    const p = pilote({ reponse: () => ({ statut: 999, corps: '' }) });
    await traiterCollecteLinkedIn(deps(p, b), JOB).catch(() => undefined);
    expect(bloque(b)).toContain('defi');
  });

  it('un défi sur la page d’arrivée suspend la session avant toute requête de résultats', async () => {
    sansBruit();
    const b = base({ source: sourceMots([MOTS]) });
    const p = pilote({ url: 'https://www.linkedin.com/checkpoint/challenge/', reponse: pages(ADA) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(p.requetes).toEqual([]);
    expect(bloque(b)).toContain('defi');
  });

  it('un sujet qui ne répond pas n’emporte pas les autres', async () => {
    sansBruit();
    const b = base({ source: sourceMots(['crm', 'erp']) });
    const p = pilote({ reponse: (u) => (u.includes('keywords=crm') ? { statut: 500, corps: '' } : u.includes('page=2') ? { statut: 200, corps: '' } : { statut: 200, corps: LEO }) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(c.params[2]).toBe('success');
    expect(signaux(b)).toEqual(['erp:leo-exemple']);
    expect(String(c.params[3])).toContain('500');
  });
});

/**
 * La source « changement de poste » : elle ne découvre personne. Elle relit, par roulement, des
 * contacts DÉJÀ connus et compare l'intitulé. Le pool factice rejoue le contrat de la sélection
 * (voir `base`) : l'ordre et l'exclusion réels vivent dans le harnais Postgres.
 */
describe('la source « changement de poste »', () => {
  const sourceChangement = { sourceType: 'linkedin_job_change' };
  /**
   * Une page de profil dans sa forme réelle : le nom en `<h2>` et l'intitulé DANS la carte
   * d'en-tête, après le degré de relation et avant la ligne entreprise. La forme compte : lire
   * un `<p>` « quelque part dans la page » attrapait la ligne d'à côté, ou celle d'un profil
   * suggéré (recette du 09/10).
   */
  const profil = (nom: string, intitule: string): { statut: number; corps: string } => {
    const carte = 'com.linkedin.sdui.profile.card.refURN';
    return {
      statut: 200,
      corps:
        `<html><head><title>${nom} | LinkedIn</title></head><body>` +
        `<div id="${carte}Topcard" componentkey="${carte}Topcard">` +
        `<h2>${nom}</h2><p>· 3e</p>${intitule === '' ? '' : `<p>${intitule}</p>`}<p>Acme</p></div>` +
        `<div id="${carte}Activity"></div></body></html>`,
    };
  };
  const url = (slug: string): string => `https://www.linkedin.com/in/${slug}/`;
  const contact = (slug: string, titre: string | null, extra: Partial<ContactFactice> = {}): ContactFactice => ({
    id: `c-${slug}`,
    url: url(slug),
    titre,
    verifieLe: null,
    ...extra,
  });
  const signaux = (b: ReturnType<typeof base>) => b.ecritures.filter((e) => e.sql === 'signal').map((e) => e.params[2]);
  const verifies = (b: ReturnType<typeof base>) => b.ecritures.filter((e) => e.sql === 'verifie').map((e) => e.params[1]);
  const sansBruit = () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  };
  const pagesDeProfils = (parSlug: Record<string, { statut: number; corps: string }>) => (u: string) =>
    parSlug[/\/in\/([^/]+)\//.exec(u)?.[1] ?? ''] ?? { statut: 404, corps: '' };

  it('relit les contacts connus et n’enregistre un changement que pour l’intitulé qui a bougé', async () => {
    sansBruit();
    const b = base({
      source: sourceChangement,
      contacts: [contact('ada-exemple', 'Directrice commerciale'), contact('leo-exemple', 'Directeur commercial')],
    });
    const p = pilote({
      reponse: pagesDeProfils({
        'ada-exemple': profil('Ada Exemple', 'Directrice générale'),
        'leo-exemple': profil('Leo Exemple', 'directeur  commercial'),
      }),
    });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(c.params[2]).toBe('success');
    expect(signaux(b)).toEqual([`changement:${url('ada-exemple')}:directrice générale`]);
    // vus : les deux profils relus. nouveaux : le seul changement. doublons : l'intitulé inchangé
    // (la casse et les espaces ne font pas un changement). posts : aucun, la source n'en ouvre pas.
    expect(c.params[4]).toBe(2);
    expect(c.params[5]).toBe(1);
    expect(c.params[7]).toBe(1);
    expect(c.params[c.params.length - 1]).toBe(0);
  });

  /**
   * Le contrôle de vraisemblance, posé après la recette du 09/10 : cinq profils relus avaient
   * donné cinq « changements », dont deux venaient d'une ligne qui n'était pas l'intitulé.
   */
  const cinqContacts = (titre: string): ContactFactice[] =>
    ['a', 'b', 'c', 'd', 'e'].map((x) => contact(`${x}-exemple`, titre));
  const cinqPages = (intitules: readonly string[]) =>
    pagesDeProfils(
      Object.fromEntries(
        ['a', 'b', 'c', 'd', 'e'].map((x, i) => [`${x}-exemple`, profil(`${x} Exemple`, intitules[i] ?? 'Directrice commerciale')]),
      ),
    );

  it('refuse le passage quand TOUS les profils relus semblent avoir changé, sans rien écrire', async () => {
    sansBruit();
    const b = base({ source: sourceChangement, contacts: cinqContacts('Directrice commerciale') });
    const p = pilote({ reponse: cinqPages(['Un', 'Deux', 'Trois', 'Quatre', 'Cinq']) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(c.params[2]).toBe('error');
    expect(c.params[3]).toContain('chang');
    // Rien d'écrit : ni signal, ni intitulé écrasé. Les contacts ne sont pas marqués non plus,
    // donc ils repassent en tête de la rotation demain.
    expect(signaux(b)).toEqual([]);
    expect(verifies(b)).toEqual([]);
  });

  it('refuse aussi à la limite du seuil : quatre changements sur cinq profils lus', async () => {
    sansBruit();
    const b = base({ source: sourceChangement, contacts: cinqContacts('Directrice commerciale') });
    const p = pilote({ reponse: cinqPages(['Un', 'Deux', 'Trois', 'Quatre', 'Directrice commerciale']) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(clos(b)!.params[2]).toBe('error');
    expect(signaux(b)).toEqual([]);
  });

  it('laisse passer trois changements sur cinq : c’est sous le seuil, donc plausible', async () => {
    sansBruit();
    const b = base({ source: sourceChangement, contacts: cinqContacts('Directrice commerciale') });
    const p = pilote({ reponse: cinqPages(['Un', 'Deux', 'Trois', 'Directrice commerciale', 'Directrice commerciale']) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(clos(b)!.params[2]).toBe('success');
    expect(signaux(b)).toHaveLength(3);
  });

  it('ne jugé pas un passage trop court : deux profils lus, deux changements, acceptés', async () => {
    // En deçà de cinq profils, la proportion ne veut rien dire — deux changements sur deux
    // arrivent pour de vrai. Refuser ici bloquerait une petite organisation en permanence.
    sansBruit();
    const b = base({
      source: sourceChangement,
      contacts: [contact('ada-exemple', 'Directrice commerciale'), contact('leo-exemple', 'Directeur commercial')],
    });
    const p = pilote({
      reponse: pagesDeProfils({
        'ada-exemple': profil('Ada Exemple', 'Directrice générale'),
        'leo-exemple': profil('Leo Exemple', 'Directeur général'),
      }),
    });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(clos(b)!.params[2]).toBe('success');
    expect(signaux(b)).toHaveLength(2);
  });

  it('un profil sans intitulé ne compte NI comme changement NI dans les écritures', async () => {
    // Mesuré sur un profil réel : l'intitulé valait « . ». Ce n'est pas un changement de poste,
    // et l'ancien intitulé de la fiche ne doit pas être écrasé par du vide.
    sansBruit();
    const b = base({ source: sourceChangement, contacts: [contact('ada-exemple', 'Directrice commerciale')] });
    const p = pilote({ reponse: pagesDeProfils({ 'ada-exemple': profil('Ada Exemple', '.') }) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(clos(b)!.params[2]).toBe('success');
    expect(signaux(b)).toEqual([]);
    // Marqué vérifié, mais avec un intitulé vide : la requête ne remplace alors rien.
    expect(verifies(b)).toEqual(['c-ada-exemple']);
  });

  it('arrive sur le fil avant de relire (le fetch part de la page courante), et trace chaque requête', async () => {
    sansBruit();
    const b = base({ source: sourceChangement, contacts: [contact('ada-exemple', 'Directrice commerciale')] });
    const p = pilote({ reponse: pagesDeProfils({ 'ada-exemple': profil('Ada Exemple', 'Directrice commerciale') }) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(p.navigations).toEqual(['https://www.linkedin.com/feed/']);
    expect(p.requetes).toEqual([url('ada-exemple')]);
    // L'arrivée et la lecture : deux requêtes tracées et comptées.
    expect(b.ecritures.filter((e) => e.sql === 'tracer')).toHaveLength(2);
    expect(clos(b)!.params[6]).toBe(2);
  });

  it('pose linkedin_verifie_le même quand rien n’a changé, quand la lecture échoue et quand le profil est illisible', async () => {
    sansBruit();
    const b = base({
      source: sourceChangement,
      contacts: [
        contact('inchange', 'Directrice commerciale'),
        contact('change', 'Directeur commercial'),
        contact('ferme', 'Responsable ventes'),
        contact('sans-forme', 'Responsable ventes', { url: 'https://example.com/pas-un-profil' }),
      ],
    });
    const p = pilote({
      reponse: pagesDeProfils({
        inchange: profil('Ada Exemple', 'Directrice commerciale'),
        change: profil('Leo Exemple', 'Directeur général'),
        // `ferme` : 404, profil supprimé ou fermé.
      }),
    });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(verifies(b).sort()).toEqual(['c-change', 'c-ferme', 'c-inchange', 'c-sans-forme']);
    expect(b.contacts.every((c) => c.verifieLe !== null)).toBe(true);
    // Les deux illisibles sont comptés à part, jamais pris pour un changement.
    const c = clos(b)!;
    expect(c.params[12]).toBe(2); // ignores
    expect(signaux(b)).toHaveLength(1);
    // Aucune requête pour une adresse qui n'est pas celle d'un profil.
    expect(p.requetes.sort()).toEqual([url('change'), url('ferme'), url('inchange')]);
  });

  it('la rotation : deux passages successifs ne relisent pas les mêmes contacts', async () => {
    sansBruit();
    const lots = ['a', 'b', 'c', 'd'].map((s) => contact(s, 'Directrice commerciale'));
    const b = base({ source: sourceChangement, contacts: lots, plafonds: { personnes: 2 } });
    const reponse = pagesDeProfils(Object.fromEntries(['a', 'b', 'c', 'd'].map((s) => [s, profil('Ada Exemple', 'Directrice commerciale')])));
    const p1 = pilote({ reponse });
    await traiterCollecteLinkedIn(deps(p1, b), JOB);
    const p2 = pilote({ reponse });
    await traiterCollecteLinkedIn(deps(p2, b), JOB);
    const p3 = pilote({ reponse });
    await traiterCollecteLinkedIn(deps(p3, b), JOB);
    expect(p1.requetes).toEqual([url('a'), url('b')]);
    expect(p2.requetes).toEqual([url('c'), url('d')]);
    // Le troisième repart du moins récemment relu : la rotation boucle, elle ne s'arrête pas.
    expect(p3.requetes).toEqual([url('a'), url('b')]);
  });

  it('la rotation avance même quand les premiers profils sont illisibles', async () => {
    sansBruit();
    const b = base({
      source: sourceChangement,
      contacts: [contact('ferme-1', 'X'), contact('ferme-2', 'X'), contact('ok', 'Directrice commerciale')],
      plafonds: { personnes: 2 },
    });
    const reponse = pagesDeProfils({ ok: profil('Ada Exemple', 'Directrice commerciale') });
    const p1 = pilote({ reponse });
    await traiterCollecteLinkedIn(deps(p1, b), JOB);
    const p2 = pilote({ reponse });
    await traiterCollecteLinkedIn(deps(p2, b), JOB);
    expect(p1.requetes).toEqual([url('ferme-1'), url('ferme-2')]);
    // Sans le marquage des illisibles, le second passage relirait les deux mêmes et n'atteindrait jamais `ok`.
    expect(p2.requetes).toEqual([url('ok'), url('ferme-1')]);
  });

  it('un contact à adresse déduite d’un URN n’est jamais relu', async () => {
    sansBruit();
    const b = base({
      source: sourceChangement,
      contacts: [
        contact('ACoAAexemple', 'Directrice commerciale', { deduite: true }),
        contact('ada-exemple', 'Directrice commerciale'),
      ],
    });
    const p = pilote({ reponse: pagesDeProfils({ 'ada-exemple': profil('Ada Exemple', 'Directrice commerciale') }) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(p.requetes).toEqual([url('ada-exemple')]);
    expect(b.contacts.find((c) => c.deduite)!.verifieLe).toBeNull();
  });

  it('un contact sans intitulé connu prend l’intitulé lu pour référence, sans rien déclarer', async () => {
    sansBruit();
    const b = base({ source: sourceChangement, contacts: [contact('ada-exemple', null), contact('leo-exemple', '  ')] });
    const p = pilote({
      reponse: pagesDeProfils({
        'ada-exemple': profil('Ada Exemple', 'Directrice commerciale'),
        'leo-exemple': profil('Leo Exemple', 'Directeur commercial'),
      }),
    });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(signaux(b)).toEqual([]);
    expect(b.contacts.map((c) => c.titre)).toEqual(['Directrice commerciale', 'Directeur commercial']);
    expect(clos(b)!.params[5]).toBe(0);
  });

  it('le plafond de posts du jour, épuisé, ne l’arrête pas : elle ne lit aucun post', async () => {
    sansBruit();
    const b = base({ source: sourceChangement, contacts: [contact('ada-exemple', 'Directrice commerciale')], plafonds: { posts: 3 }, postsDuJour: 3 });
    const p = pilote({ reponse: pagesDeProfils({ 'ada-exemple': profil('Ada Exemple', 'Directrice commerciale') }) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(clos(b)!.params[3]).not.toBe(MSG.plafond_posts);
    expect(p.requetes).toEqual([url('ada-exemple')]);
  });

  it('le plafond de requêtes de l’heure borne la sélection, arrivée comprise', async () => {
    sansBruit();
    const sl = ['a', 'b', 'c', 'd', 'e'];
    const b = base({ source: sourceChangement, contacts: sl.map((s) => contact(s, 'X')), requetesDeLHeure: 56 });
    const p = pilote({ reponse: pagesDeProfils(Object.fromEntries(sl.map((s) => [s, profil('Ada Exemple', 'X')]))) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    // Quatre requêtes restantes : l'arrivée en prend une, trois profils sont relus, pas cinq.
    expect(p.requetes).toEqual([url('a'), url('b'), url('c')]);
    expect(clos(b)!.params[6]).toBe(4);
  });

  it('le plafond de personnes par passage borne le nombre de profils relus', async () => {
    sansBruit();
    const sl = ['a', 'b', 'c'];
    const b = base({ source: sourceChangement, contacts: sl.map((s) => contact(s, 'X')), plafonds: { personnes: 1 } });
    const p = pilote({ reponse: pagesDeProfils(Object.fromEntries(sl.map((s) => [s, profil('Ada Exemple', 'X')]))) });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(p.requetes).toEqual([url('a')]);
  });

  it('sans contact à relire, le passage est à vide et le dit, sans ouvrir LinkedIn', async () => {
    sansBruit();
    const b = base({ source: sourceChangement, contacts: [] });
    const p = pilote({});
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    const c = clos(b)!;
    expect(c.params[2]).toBe('success');
    expect(c.params[3]).toBe(MSG.aucun_a_relire);
    expect(p.navigations).toEqual([]);
    expect(p.requetes).toEqual([]);
  });

  it('un défi sur la page d’arrivée suspend la session avant toute lecture, et ne marque personne', async () => {
    sansBruit();
    const b = base({ source: sourceChangement, contacts: [contact('ada-exemple', 'Directrice commerciale')] });
    const p = pilote({ url: 'https://www.linkedin.com/checkpoint/challenge/', reponse: () => profil('Ada Exemple', 'X') });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(p.requetes).toEqual([]);
    expect(bloque(b)).toContain('defi');
    expect(b.contacts[0]!.verifieLe).toBeNull();
  });

  it('un défi en cours de route arrête tout : le contact en cause garde sa place en tête de la rotation', async () => {
    sansBruit();
    const b = base({
      source: sourceChangement,
      contacts: [contact('ada-exemple', 'Directrice commerciale'), contact('leo-exemple', 'Directeur commercial')],
    });
    const p = pilote({
      reponse: (u) => (u.includes('leo-exemple') ? { statut: 999, corps: '' } : profil('Ada Exemple', 'Directrice commerciale')),
    });
    await traiterCollecteLinkedIn(deps(p, b), JOB);
    expect(bloque(b)).toContain('defi');
    expect(clos(b)!.params[2]).toBe('error');
    expect(b.contacts.find((c) => c.id === 'c-ada-exemple')!.verifieLe).not.toBeNull();
    expect(b.contacts.find((c) => c.id === 'c-leo-exemple')!.verifieLe).toBeNull();
  });

  it('une erreur de base pendant l’écriture ne suspend pas la session', async () => {
    sansBruit();
    const b = base({ source: sourceChangement, contacts: [contact('ada-exemple', 'Directrice commerciale')] });
    const p = pilote({ reponse: pagesDeProfils({ 'ada-exemple': profil('Ada Exemple', 'Directrice commerciale') }) });
    const sain = b.pool.query;
    b.pool.query = async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes('jr:linkedin_collecte_verifie')) throw new Error('statement timeout');
      return sain(sql, params);
    };
    await expect(traiterCollecteLinkedIn(deps(p, b), JOB)).rejects.toThrow('statement timeout');
    expect(bloque(b)).toEqual([]);
    // Le trafic LinkedIn est derrière nous : l'incident n'est pas un verdict sur le compte, donc il
    // ne compte pas pour le disjoncteur (`verdict_linkedin` faux).
    expect(clos(b)!.params[2]).toBe('error');
    expect(clos(b)!.params[11]).toBe(false);
  });
});
