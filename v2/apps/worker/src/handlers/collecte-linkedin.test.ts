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
import { QUEUES } from '@jay-reach/core';
import type { Pilote } from '../linkedin/navigateur.js';
import { lireEngageurs, type Budget } from '../linkedin/engageurs.js';
import { traiterCollecteLinkedIn, type DependancesCollecte } from './collecte-linkedin.js';

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
}) {
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
    if (t.includes('jr:linkedin_requetes_compter')) return rep([{ n: opts.requetesDeLHeure ?? 0 }]);
    if (t.includes('jr:linkedin_requete_tracer')) {
      ecritures.push({ sql: 'tracer', params });
      return rep([{}]);
    }
    if (t.includes('jr:linkedin_fuseau')) return rep([]);
    // Un engageur inconnu : l'insertion du signal rend son identifiant, donc l'issue est `nouveau`.
    if (t.includes('insert into signals')) return rep([{ id: `signal-${params[2]}` }]);
    if (t.includes('begin') || t.includes('commit') || t.includes('rollback')) return rep([]);
    // Notifications, journal d'activité, enregistrement d'un engageur : sans effet ici.
    ecritures.push({ sql: t.trim().slice(0, 40), params });
    return rep([]);
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  return { pool, ecritures };
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
