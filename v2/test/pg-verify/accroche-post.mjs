// Lot « accroche du post » : exécution RÉELLE, sur Postgres, des fiches de post et du
// rattachement des signaux. Aucune requête de production n'est recopiée ici : seules les
// fixtures sont en SQL. Les tâches 4, 5 et 8 du lot ajoutent leurs sections à ce fichier.
//
// Mutations qui font rougir :
//   1. posts-fiches.ts : remplacer `coalesce(excluded.author_name, linkedin_posts.author_name)`
//      par `excluded.author_name` — le contrôle 3 rougit (une capture vide efface l'auteur).
//   2. posts-fiches.ts : poser `expires_at = excluded.expires_at` dans le `do update` — 1b rougit.
//   3. posts-fiches.ts : ajouter `subject = null` au `do update` — 3 et 6 rougissent.
//   4. post-engagement.ts : retirer l'appel à `rattacherSignalAuPost` — 5b et 5d rougissent.
//   5. collecte-linkedin.ts : ne pas passer `linkedinPostId` à `enregistrerEngageur` — 7c rougit.
//   6. collecte-linkedin.ts : ne plus demander la capture (dernier argument de `lireEngageurs`) — 7b et 7c rougissent.
//   8. collecte-linkedin.ts : ne pas passer `auteurAvecRepli` (fiche brute) — 8d rougit.
//   9. collecte-linkedin.ts : ne pas passer `linkedinPostId` — 7c et 8c rougissent.
//  10. collecte-linkedin.ts : retirer le try/catch autour de `enregistrerFichePost` — 9 à 9c rougissent.
//  11. fiche-post.ts : ne plus tracer la lecture (`tracerLectureFichePost`) — 11a, 11c, 11d rougissent.
//  12. fiche-post.ts : prendre le verrou APRÈS `ouvrirNavigateur` — 12a rougit.
//  13. fiche-post.ts : retirer le `limite` de `fichesARattraper` — 11 rougit.
//  14. queues.ts : retirer `policy: 'stately'` de la file — 10b rougit.
//  15. posts-fiches.ts : changer `SQL_FICHE_INCOMPLETE` (ex. ajouter `or subject is null`) — 10e rougit.
//   7. engageurs.ts : faire naviguer `lireFicheDuPostOuvert` (`pilote.aller`) — 7d rougit.
import pg from 'pg';
import PgBoss from 'pg-boss';
import {
  clePost,
  enregistrerEngageur,
  enregistrerFichePost,
  marquerPostTraite,
  rattacherSignalAuPost,
  creerSource,
  startSourceRun,
  traiterCollecteLinkedIn,
  activerSessionLinkedIn,
  enqueueFichesPostALire,
  traiterFichePost,
  fichesARattraper,
  ficheIncomplete,
  prendreVerrouLinkedIn,
  registerQueues,
} from './_accroche-post-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

// Chaque section tourne dans son propre `try` : une exception dans l'une ne doit pas emporter
// les suivantes. Un harnais qui saute une preuve en silence est pire qu'un harnais rouge.
async function jouer(...sections) {
  for (const section of sections) {
    try {
      await section();
    } catch (e) {
      check(`section ${section.name} : exception, ses contrôles n'ont PAS été joués`, false, String(e?.message ?? e));
    }
  }
}

// --------------------------------------------------------------------- fixtures

let seq = 0;
const ID_POST = '7271000000000000001';
const URL_POST = `https://www.linkedin.com/feed/update/urn:li:activity:${ID_POST}/`;
const URN_POST = `urn:li:activity:${ID_POST}`;
const FENETRE = 28;

/** Une fiche du type réel `FichePost` ; `surcharge` en change des champs. */
function fiche(surcharge = {}) {
  return {
    urn: URN_POST,
    url: URL_POST,
    auteur: { kind: 'person', nom: 'Ana Test', nomAffiche: 'Ana', nomPublic: null, url: null },
    texte: 'Un texte de post inventé pour la preuve.',
    date: new Date('2026-10-12T08:30:00.000Z'),
    ...surcharge,
  };
}
const FICHE_VIDE = { urn: URN_POST, url: URL_POST, auteur: null, texte: null, date: null };

/** Une organisation, un persona, une campagne : le minimum que `creerSource` exige. */
async function monde() {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const org = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
  const admin = (
    await q(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [`u${n}@test.local`])
  ).rows[0].id;
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [org, admin]);
  const persona = (
    await q(`insert into personas (organization_id, name, scoring_prompt) values ($1, 'Directeur commercial', 'x') returning id`, [org])
  ).rows[0].id;
  const campagne = (
    await q(`insert into campaigns (organization_id, name, status, entry_rules) values ($1, 'C', 'active', $2::jsonb) returning id`, [
      org,
      JSON.stringify({ personas: [persona] }),
    ])
  ).rows[0].id;
  const ctx = { ex: pool, organisationId: org, utilisateurId: admin, role: 'admin' };
  return { org, persona, campagne, ctx };
}

/** Une source d'engageurs de plus sur la campagne, par la fonction de production. */
async function sourceDePost(m, urlPost, nom) {
  const { id } = await creerSource(m.ctx, {
    campagneId: m.campagne,
    providerId: 'linkedin_post_engagers',
    nom,
    config: { urlPost, garder: ['reagi'], personaId: m.persona },
  });
  return id;
}

const lignesPost = async (org) => (await q(`select * from linkedin_posts where organization_id = $1`, [org])).rows;

// --------------------------------------------------------------------- sections

async function ficheCreeeDeuxFois() {
  console.log('\n# une fiche créée deux fois ne produit qu\'une ligne');
  const m = await monde();
  const a = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  const avant = (await lignesPost(m.org))[0];
  const b = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: 999 });
  const lignes = await lignesPost(m.org);

  check('1. deux enregistrements, une seule ligne', lignes.length === 1, `${lignes.length} lignes`);
  check('1a. même id, clé `linkedin:<chiffres>`, `nouvelle` vrai puis faux',
    a.id === b.id && a.postKey === `linkedin:${ID_POST}` && a.nouvelle === true && b.nouvelle === false, JSON.stringify({ a, b }));
  check('1b. `expires_at` posé à la création seulement (la seconde fenêtre est ignorée)',
    lignes[0].expires_at.getTime() === avant.expires_at.getTime());
  const jours = (lignes[0].expires_at.getTime() - lignes[0].created_at.getTime()) / 86_400_000;
  check('1c. `expires_at` = création + fenêtre', Math.abs(jours - FENETRE) < 0.01, `${jours} jours`);
  check('1d. `capture_attempts` compte chaque appel', lignes[0].capture_attempts === 2, String(lignes[0].capture_attempts));
  check('1e. les champs de la fiche sont rangés',
    lignes[0].author_name === 'Ana Test' && lignes[0].author_display_name === 'Ana' && lignes[0].author_kind === 'person'
      && lignes[0].text_excerpt?.startsWith('Un texte') && lignes[0].posted_at?.toISOString() === '2026-10-12T08:30:00.000Z'
      && lignes[0].post_urn === URN_POST && lignes[0].review_status === 'pending');

  // L'URN seul et l'URL du même post désignent la même ligne.
  const c = await enregistrerFichePost(pool, m.org, { ...FICHE_VIDE, url: URN_POST }, { fenetreJours: FENETRE });
  check('2. la même clé depuis l\'URN seul : toujours une ligne', c.id === a.id && (await lignesPost(m.org)).length === 1);
  check('2b. clePost rend la même clé pour l\'URL et l\'URN', clePost(URL_POST) === clePost(URN_POST));

  // Une capture vide n'efface rien.
  const d = (await lignesPost(m.org))[0];
  check('3. une capture vide ne remplace pas un champ renseigné par un nul',
    d.author_name === 'Ana Test' && d.text_excerpt !== null && d.posted_at !== null && d.capture_attempts === 3);

  // Une autre organisation a sa propre fiche pour le même post.
  const autre = await monde();
  const e = await enregistrerFichePost(pool, autre.org, fiche(), { fenetreJours: FENETRE });
  check('3b. une autre organisation, une autre fiche', e.id !== a.id && e.nouvelle === true);
}

async function deuxSourcesMemePost() {
  console.log('\n# deux sources, un même post');
  const m = await monde();
  const s1 = await sourceDePost(m, URL_POST, 'Engageurs A');
  // Un post nommé ne sert qu'une source d'engageurs ; la seconde source est une recherche par sujet,
  // qui retombe sur le même post (c'est le cas réel : une page concurrente et un mot-clé).
  const s2 = (
    await creerSource(m.ctx, {
      campagneId: m.campagne,
      providerId: 'linkedin_keywords',
      nom: 'Sujet',
      config: { sujets: ['prospection'], personaId: m.persona },
    })
  ).id;
  const f1 = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  const f2 = await enregistrerFichePost(pool, m.org, fiche({ url: `https://fr.linkedin.com/posts/ana-test_sujet-activity-${ID_POST}-AbCd` }), { fenetreJours: FENETRE });
  await marquerPostTraite(pool, m.org, s1, URN_POST);
  await marquerPostTraite(pool, m.org, s2, URN_POST);

  const posts = await lignesPost(m.org);
  const traites = (await q(`select source_id from linkedin_posts_traites where organization_id = $1`, [m.org])).rows;
  check('4. une seule ligne `linkedin_posts` pour le même post', posts.length === 1 && f1.id === f2.id, `${posts.length} lignes`);
  check('4b. deux lignes `linkedin_posts_traites`, une par source',
    traites.length === 2 && new Set(traites.map((t) => t.source_id)).size === 2, `${traites.length} lignes`);
}

async function rattachementDuSignal() {
  console.log('\n# le signal d\'un engageur est rattaché à la fiche');
  const m = await monde();
  const source = await sourceDePost(m, URL_POST, 'Engageurs');
  const runId = await startSourceRun(pool, source);
  const f = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  const ctx = { pool, organizationId: m.org, sourceId: source, sourceRunId: runId, exclusions: {} };
  const campagne = { id: m.campagne, personaId: m.persona };

  const issue = await enregistrerEngageur(ctx, { urn: 'urn:li:fsd_profile:ACoAArattache', nom: 'Bob Test', intitule: 'Directeur commercial' }, campagne, URL_POST, f.id);
  const signal = (await q(`select id, linkedin_post_id from signals where organization_id = $1`, [m.org])).rows;
  check('5a. l\'engageur est enregistré', issue === 'nouveau' && signal.length === 1, issue);
  check('5b. son signal porte `linkedin_post_id`', signal[0]?.linkedin_post_id === f.id, JSON.stringify(signal));

  // Sans fiche, le signal naît sans rattachement : rien ne casse.
  const sans = await enregistrerEngageur(ctx, { urn: 'urn:li:fsd_profile:ACoAAsans', nom: 'Cleo Test', intitule: 'Directrice commerciale' }, campagne, URL_POST);
  const sansFiche = (await q(`select linkedin_post_id from signals where organization_id = $1 and external_id like '%ACoAAsans'`, [m.org])).rows;
  check('5c. sans fiche, le signal naît sans rattachement', sans === 'nouveau' && sansFiche[0]?.linkedin_post_id === null);

  // `rattacherSignalAuPost` ne touche que l'organisation nommée.
  const autre = await monde();
  const g = await enregistrerFichePost(pool, autre.org, fiche(), { fenetreJours: FENETRE });
  await rattacherSignalAuPost(pool, autre.org, signal[0].id, g.id);
  const intact = (await q(`select linkedin_post_id from signals where id = $1`, [signal[0].id])).rows[0];
  check('5d. un signal d\'une autre organisation n\'est pas rattaché', intact.linkedin_post_id === f.id);
}

async function sujetOperateurSurvit() {
  console.log('\n# un sujet posé par l\'opérateur survit à une nouvelle capture');
  const m = await monde();
  const f = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set subject = 'la prospection par la preuve', subject_origin = 'operator', review_status = 'approved' where id = $1`, [f.id]);
  await enregistrerFichePost(pool, m.org, fiche({ texte: 'Un texte tout autre, capturé plus tard.' }), { fenetreJours: FENETRE });
  const l = (await lignesPost(m.org))[0];
  check('6. `subject`, son origine et la relecture sont intacts',
    l.subject === 'la prospection par la preuve' && l.subject_origin === 'operator' && l.review_status === 'approved', JSON.stringify({ s: l.subject, o: l.subject_origin, r: l.review_status }));
  check('6b. le texte, lui, a été mis à jour', l.text_excerpt === 'Un texte tout autre, capturé plus tard.');
}

/** Réponse Voyager normalisée : profils dans `included`, total dans `data.paging`. */
function voyager(profils) {
  return JSON.stringify({
    data: {
      paging: { start: 0, count: 50, total: profils.length },
      elements: profils.map((p) => ({ reactionType: 'LIKE', actorUrn: `urn:li:fsd_profile:${p.id}` })),
    },
    included: profils.map((p) => ({
      $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
      entityUrn: `urn:li:fsd_profile:${p.id}`,
      firstName: p.prenom,
      lastName: p.nom,
      headline: p.titre,
    })),
  });
}

async function collecteEnModePost() {
  console.log('\n# la collecte réelle en mode `post` capture la fiche et rattache chaque engageur');
  const IP = '203.0.113.7';
  const m = await monde();
  const source = await sourceDePost(m, URL_POST, 'Engageurs collectés');
  await activerSessionLinkedIn(m.ctx, IP);
  const runId = await startSourceRun(pool, source);

  const navigations = [];
  const requetes = [];
  const TEXTE = 'Recruter un commercial coûte cher, voici ce que nous avons mesuré.';
  const pilote = {
    aller: async (u) => void navigations.push(u),
    url: async () => URL_POST,
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => TEXTE,
    attendre: async () => true,
    requete: async (u) => {
      requetes.push(u);
      return {
        statut: 200,
        corps: voyager([
          { id: 'ACoAAada', prenom: 'Ada', nom: 'Lovelace', titre: 'Directrice commerciale chez Acme' },
          { id: 'ACoAAbob', prenom: 'Bob', nom: 'Durand', titre: 'Directeur commercial' },
        ]),
      };
    },
    effacerCookies: async () => undefined,
    fermer: async () => undefined,
  };
  const log = console.log;
  console.log = () => undefined; // le handler journalise chaque passage
  try {
    await traiterCollecteLinkedIn(
      {
        pool,
        env: { JAY_REACH_LINKEDIN: '1' },
        ouvrirNavigateur: async () => pilote,
        releverSortie: async () => ({ ip: IP, operateur: 'AS64496 Exemple Telecom', pays: 'FR' }),
        pause: async () => undefined,
      },
      { organizationId: m.org, sourceId: source, sourceRunId: runId },
    );
  } finally {
    console.log = log;
  }

  const passage = (await q(`select status, error, nouveaux from source_runs where id = $1`, [runId])).rows[0];
  check('7. le passage est un succès, deux personnes nouvelles', passage.status === 'success' && passage.nouveaux === 2, JSON.stringify(passage));
  const posts = await lignesPost(m.org);
  check('7b. une fiche est créée, avec le texte lu sur la page', posts.length === 1 && posts[0].text_excerpt === TEXTE && posts[0].post_key === `linkedin:${ID_POST}`, JSON.stringify(posts.map((p) => p.text_excerpt)));
  const signaux = (await q(`select linkedin_post_id from signals where organization_id = $1`, [m.org])).rows;
  // Le piège : un signal sans post ne lève aucune erreur, et tout le lot ne sert alors à rien.
  check('7c. CHAQUE engageur collecté est rattaché à sa fiche', signaux.length === 2 && posts.length === 1 && signaux.every((s) => s.linkedin_post_id === posts[0].id), JSON.stringify(signaux));
  check('7d. la capture est gratuite : une navigation (la page du post), une requête Voyager',
    navigations.length === 1 && navigations[0] === URL_POST && requetes.length === 1, `${navigations.length} navigation(s), ${requetes.length} requête(s)`);
}

const htmlPage = (nom, id) =>
  `<html><code>{&quot;entityUrn&quot;:&quot;urn:li:fsd_company:${id}&quot;,&quot;universalName&quot;:&quot;${nom}&quot;}</code></html>`;
const lotDePosts = (urns) =>
  JSON.stringify({
    data: {
      data: {
        feedDashOrganizationalPageUpdatesByOrganizationalPageRelevanceFeed: {
          paging: { count: 10, start: 0, total: urns.length },
          '*elements': urns.map((u) => `urn:li:fsd_update:(${u},COMPANY_FEED_RELEVANCE)`),
        },
      },
    },
  });

async function collecteEnModePages() {
  console.log('\n# la collecte réelle en mode `pages` capture une fiche par post, rattachée, sans navigation de plus');
  const IP = '203.0.113.7';
  const m = await monde();
  const { id: source } = await creerSource(m.ctx, {
    campagneId: m.campagne,
    providerId: 'linkedin_competitor_posts',
    nom: 'Concurrent',
    config: { pagesConcurrentes: ['https://www.linkedin.com/company/acme/'], garder: ['reagi'], personaId: m.persona },
  });
  await activerSessionLinkedIn(m.ctx, IP);
  const runId = await startSourceRun(pool, source);
  const P1 = 'urn:li:activity:7271000000000000011';
  const P2 = 'urn:li:activity:7271000000000000012';
  const parPost = {
    '7271000000000000011': [{ id: 'ACoAAada', prenom: 'Ada', nom: 'Lovelace', titre: 'Directrice commerciale' }],
    '7271000000000000012': [{ id: 'ACoAAbob', prenom: 'Bob', nom: 'Durand', titre: 'Directeur commercial' }],
  };

  const navigations = [];
  const pilote = {
    aller: async (u) => void navigations.push(u),
    url: async () => URL_POST,
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '', // la page ne rend aucun auteur : le repli sur la source est exercé
    attendre: async () => false,
    requete: async (u) => {
      if (u.includes('/company/')) return { statut: 200, corps: htmlPage('acme', '777') };
      if (u.includes('organizationalPageUrn')) return { statut: 200, corps: lotDePosts([P1, P2]) };
      const id = Object.keys(parPost).find((x) => u.includes(x));
      return { statut: 200, corps: voyager(parPost[id] ?? []) };
    },
    effacerCookies: async () => undefined,
    fermer: async () => undefined,
  };
  const log = console.log;
  console.log = () => undefined;
  try {
    await traiterCollecteLinkedIn(
      {
        pool,
        env: { JAY_REACH_LINKEDIN: '1' },
        ouvrirNavigateur: async () => pilote,
        releverSortie: async () => ({ ip: IP, operateur: 'AS64496 Exemple Telecom', pays: 'FR' }),
        pause: async () => undefined,
      },
      { organizationId: m.org, sourceId: source, sourceRunId: runId },
    );
  } finally {
    console.log = log;
  }

  const passage = (await q(`select status, error, nouveaux from source_runs where id = $1`, [runId])).rows[0];
  check('8. le passage est un succès, deux personnes nouvelles', passage.status === 'success' && passage.nouveaux === 2, JSON.stringify(passage));
  const posts = await lignesPost(m.org);
  check('8b. une fiche par post', posts.length === 2, `${posts.length} fiche(s)`);
  const signaux = (await q(`select linkedin_post_id from signals where organization_id = $1`, [m.org])).rows;
  const ids = new Set(posts.map((p) => p.id));
  check('8c. CHAQUE engageur est rattaché à la fiche de SON post',
    signaux.length === 2 && signaux.every((s) => ids.has(s.linkedin_post_id)) && new Set(signaux.map((s) => s.linkedin_post_id)).size === 2, JSON.stringify(signaux));
  check('8d. auteur de repli : la page, sans nom affiché (un slug ne s\'affiche pas)',
    posts.every((p) => p.author_kind === 'page' && p.author_name === 'acme' && p.author_display_name === null && p.author_public_name === 'acme'),
    JSON.stringify(posts.map((p) => [p.author_kind, p.author_name, p.author_display_name])));
  check('8e. la capture est gratuite : la page entreprise, puis UNE navigation par post',
    navigations.length === 3, `${navigations.length} navigation(s)`);
}

async function captureEnPanne() {
  console.log('\n# une capture de fiche en panne ne perd pas les engageurs');
  const IP = '203.0.113.7';
  const m = await monde();
  const { id: source } = await creerSource(m.ctx, {
    campagneId: m.campagne,
    providerId: 'linkedin_competitor_posts',
    nom: 'Concurrent en panne',
    config: { pagesConcurrentes: ['https://www.linkedin.com/company/acme/'], garder: ['reagi'], personaId: m.persona },
  });
  await activerSessionLinkedIn(m.ctx, IP);
  const runId = await startSourceRun(pool, source);
  const P1 = 'urn:li:activity:7271000000000000011';
  const pilote = {
    aller: async () => undefined,
    url: async () => URL_POST,
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '',
    attendre: async () => false,
    requete: async (u) => {
      if (u.includes('/company/')) return { statut: 200, corps: htmlPage('acme', '777') };
      if (u.includes('organizationalPageUrn')) return { statut: 200, corps: lotDePosts([P1]) };
      return { statut: 200, corps: voyager([{ id: 'ACoAAada', prenom: 'Ada', nom: 'Lovelace', titre: 'Directrice commerciale' }]) };
    },
    effacerCookies: async () => undefined,
    fermer: async () => undefined,
  };
  // Le vrai pool, qui lève sur la SEULE insertion d'une fiche : tout le reste est exécuté.
  const poolEnPanne = {
    query: async (sql, params) => {
      if (/insert into linkedin_posts\s*\(/.test(String(sql))) throw new Error('panne de base');
      return pool.query(sql, params);
    },
    connect: () => pool.connect(),
  };
  const log = console.log;
  const warn = console.warn;
  console.log = () => undefined;
  console.warn = () => undefined;
  try {
    await traiterCollecteLinkedIn(
      {
        pool: poolEnPanne,
        env: { JAY_REACH_LINKEDIN: '1' },
        ouvrirNavigateur: async () => pilote,
        releverSortie: async () => ({ ip: IP, operateur: 'AS64496 Exemple Telecom', pays: 'FR' }),
        pause: async () => undefined,
      },
      { organizationId: m.org, sourceId: source, sourceRunId: runId },
    );
  } finally {
    console.log = log;
    console.warn = warn;
  }
  const passage = (await q(`select status, nouveaux from source_runs where id = $1`, [runId])).rows[0];
  const signaux = (await q(`select linkedin_post_id from signals where organization_id = $1`, [m.org])).rows;
  const traites = (await q(`select 1 from linkedin_posts_traites where organization_id = $1`, [m.org])).rowCount;
  check('9. le passage réussit malgré la panne de capture', passage.status === 'success' && passage.nouveaux === 1, JSON.stringify(passage));
  check('9b. l\'engageur est enregistré, sans post (rattrapé plus tard)', signaux.length === 1 && signaux[0].linkedin_post_id === null, JSON.stringify(signaux));
  check('9c. le post est marqué traité : sans cette tolérance ses engageurs seraient perdus pour de bon', traites === 1, String(traites));
}


// --------------------------------------------------------------------- rattrapage (tâche 5)

// Le VRAI pg-boss : il installe lui-même son schéma sur le Postgres jetable, et la file est
// créée par `registerQueues` à partir de `QUEUES` (donc avec sa politique `stately`). Aucune table
// de substitution : la singularité par organisation est celle de pg-boss, pas une copie.
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: 'pgboss' });
let bossPret = false;
async function demarrerBoss() {
  if (bossPret) return;
  boss.on('error', () => undefined);
  await boss.start();
  await registerQueues(boss);
  bossPret = true;
}
const urlN = (n) => `https://www.linkedin.com/feed/update/urn:li:activity:72710000000000${String(n).padStart(5, '0')}/`;
const ficheN = (n, surcharge = {}) => ({ ...fiche({ urn: `urn:li:activity:72710000000000${String(n).padStart(5, '0')}`, url: urlN(n) }), ...surcharge });
const VIDE = { auteur: null, texte: null, date: null };
const jobsDe = async (org) => (await q(`select id, data from pgboss.job where name = 'linkedin.fiche-post' and data->>'organizationId' = $1`, [org])).rows;
const traces = async (org) => (await q(`select kind, post_id, source_run_id from linkedin_requetes where organization_id = $1 and kind = 'fiche'`, [org])).rows;
const IP_FICHE = '203.0.113.7';

/** Un pilote qui consigne ses navigations ; `texte` est ce que rend n'importe quel sélecteur. */
function piloteFiche(texte, navigations) {
  return {
    aller: async (u) => void navigations.push(u),
    url: async () => URL_POST,
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => texte,
    attendre: async () => texte !== '',
    requete: async () => { throw new Error('aucune requête attendue'); },
    effacerCookies: async () => undefined,
    fermer: async () => undefined,
  };
}
/** Les dépendances du lot, et ce qu'elles ont vu. */
function depsLot(texte = 'Recruter un commercial coûte cher, voici ce que nous avons mesuré.', redacteur = async () => null) {
  const vu = { navigations: [], ouvertures: 0, pauses: [] };
  return {
    vu,
    deps: {
      pool,
      env: { JAY_REACH_LINKEDIN: '1' },
      ouvrirNavigateur: async () => { vu.ouvertures += 1; return piloteFiche(texte, vu.navigations); },
      releverSortie: async () => ({ ip: IP_FICHE, operateur: 'AS64496 Exemple Telecom', pays: 'FR' }),
      pause: async (ms) => void vu.pauses.push(ms),
      redacteur,
    },
  };
}
/** Une organisation à session active, avec `n` fiches vides (une tentative chacune). */
async function monde5(n, plafondJour = null, plafondHeure = null) {
  const m = await monde();
  await activerSessionLinkedIn(m.ctx, IP_FICHE);
  const reg = (cle, v) => q(`insert into organization_settings (organization_id, key, value) values ($1, $2, $3::jsonb)`, [m.org, cle, String(v)]);
  if (plafondJour !== null) await reg('linkedin_fiches_post_par_jour', plafondJour);
  if (plafondHeure !== null) await reg('linkedin_requetes_par_heure', plafondHeure);
  for (let i = 1; i <= n; i += 1) await enregistrerFichePost(pool, m.org, ficheN(i, VIDE), { fenetreJours: FENETRE });
  return m;
}

async function rattrapageSelection() {
  console.log('\n# le rattrapage retient les fiches incomplètes, pas les complètes, pas les épuisées, un job par organisation');
  await demarrerBoss();
  const m = await monde();
  await activerSessionLinkedIn(m.ctx, IP_FICHE);
  await enregistrerFichePost(pool, m.org, ficheN(1, VIDE), { fenetreJours: FENETRE }); // vide
  await enregistrerFichePost(pool, m.org, ficheN(2), { fenetreJours: FENETRE }); // complète
  for (let i = 0; i < 3; i += 1) await enregistrerFichePost(pool, m.org, ficheN(3, VIDE), { fenetreJours: FENETRE }); // épuisée

  const retenues = (await fichesARattraper(pool, m.org, 50)).map((r) => r.url);
  check('10. la sélection retient l\'incomplète seule (ni la complète, ni l\'épuisée à 3 tentatives)', retenues.length === 1 && retenues[0] === urlN(1), JSON.stringify(retenues));

  await enqueueFichesPostALire(boss, pool);
  const j1 = await jobsDe(m.org);
  check('10a. un job de lot pour l\'organisation, chargé de l\'organisation seule', j1.length === 1 && JSON.stringify(j1[0].data) === JSON.stringify({ organizationId: m.org }), JSON.stringify(j1.map((j) => j.data)));
  await enqueueFichesPostALire(boss, pool);
  check('10b. un second passage ne dépose rien de plus (file `stately`, singleton par organisation)', (await jobsDe(m.org)).length === 1);

  const autre = await monde();
  await enregistrerFichePost(pool, autre.org, ficheN(1, VIDE), { fenetreJours: FENETRE });
  await enqueueFichesPostALire(boss, pool);
  check('10c. une organisation sans session LinkedIn active n\'est pas servie', (await jobsDe(autre.org)).length === 0);

  const vide = await monde();
  await activerSessionLinkedIn(vide.ctx, IP_FICHE);
  await enregistrerFichePost(pool, vide.org, ficheN(1), { fenetreJours: FENETRE });
  await enqueueFichesPostALire(boss, pool);
  check('10d. rien à rattraper : aucun job', (await jobsDe(vide.org)).length === 0);
}

async function rattrapageCritere() {
  console.log('\n# « incomplète » n\'a qu\'une définition : la sélection SQL et `ficheIncomplete` s\'accordent');
  const m = await monde();
  const lignes = [];
  let i = 0;
  for (const auteur of [null, 'Ana']) for (const texte of [null, 't']) for (const date of [null, new Date('2026-10-12T08:30:00Z')]) {
    i += 1;
    const f = ficheN(i, {
      auteur: auteur ? { kind: 'person', nom: auteur, nomAffiche: auteur, nomPublic: null, url: null } : null,
      texte,
      date,
    });
    await enregistrerFichePost(pool, m.org, f, { fenetreJours: FENETRE });
    lignes.push(urlN(i));
  }
  const toutes = (await q(`select url, author_name, text_excerpt, posted_at from linkedin_posts where organization_id = $1`, [m.org])).rows;
  const attendu = toutes.filter(ficheIncomplete).map((r) => r.url).sort();
  const lues = (await fichesARattraper(pool, m.org, 100)).map((r) => r.url).sort();
  check('10e. huit combinaisons auteur / texte / date : mêmes fiches retenues par le SQL et par `ficheIncomplete`', JSON.stringify(lues) === JSON.stringify(attendu) && lues.length === 7, `${lues.length} / ${attendu.length}`);
}

async function rattrapageLot() {
  console.log('\n# le lot : une trace par lecture, un rythme, les plafonds, le verrou');
  // Plafond du jour : 2 sur 5.
  const m = await monde5(5, 2);
  const { deps, vu } = depsLot();
  await traiterFichePost(deps, { organizationId: m.org });
  const t = await traces(m.org);
  check('11. plafond du jour 2 : deux fiches lues sur cinq, UN navigateur', vu.navigations.length === 2 && vu.ouvertures === 1, `${vu.navigations.length} navigation(s), ${vu.ouvertures} ouverture(s)`);
  check('11a. chaque lecture est TRACÉE dans `linkedin_requetes` (kind `fiche`, rattachée à la fiche)', t.length === 2 && t.every((r) => r.post_id !== null && r.source_run_id === null), JSON.stringify(t));
  check('11b. une pause avant CHAQUE ouverture de page', vu.pauses.length === 2 && vu.pauses.every((ms) => ms > 0), JSON.stringify(vu.pauses));
  const heure = await q(`select count(*)::int as n from linkedin_requetes where organization_id = $1 and requested_at > now() - interval '1 hour'`, [m.org]);
  check('11c. ces lectures comptent dans le même budget horaire que la collecte', heure.rows[0].n === 2, String(heure.rows[0].n));

  const b = depsLot();
  await traiterFichePost(b.deps, { organizationId: m.org });
  check('11d. plafond du jour atteint : le lot suivant n\'ouvre RIEN', b.vu.ouvertures === 0 && b.vu.navigations.length === 0, JSON.stringify(b.vu.navigations));
  await q(`delete from pgboss.job where data->>'organizationId' = $1`, [m.org]);
  await enqueueFichesPostALire(boss, pool);
  check('11e. et le producteur ne dépose plus de job', (await jobsDe(m.org)).length === 0);

  // Plafond relevé : le crédit neuf va à des fiches NEUVES.
  await q(`update organization_settings set value = '3'::jsonb where organization_id = $1 and key = 'linkedin_fiches_post_par_jour'`, [m.org]);
  const c = depsLot();
  await traiterFichePost(c.deps, { organizationId: m.org });
  const tout = (await q(`select distinct post_id from linkedin_requetes where organization_id = $1 and kind = 'fiche'`, [m.org])).rows.length;
  check('11f. plafond relevé de 2 à 3 : une fiche de plus, et trois fiches distinctes en tout', c.vu.navigations.length === 1 && tout === 3, `${c.vu.navigations.length} / ${tout}`);

  // Plafond horaire de la collecte : 1 requête par heure.
  const h = await monde5(5, 20, 1);
  const d = depsLot();
  await traiterFichePost(d.deps, { organizationId: h.org });
  check('11g. plafond horaire de requêtes à 1 : une seule lecture', d.vu.navigations.length === 1, String(d.vu.navigations.length));

  // Verrou tenu par une collecte : ni navigateur, ni trace, ni crédit consommé.
  const v = await monde5(3, 20);
  check('12. le verrou est pris par une collecte', await prendreVerrouLinkedIn(v.ctx, 'collecte-en-cours', 600_000));
  const e = depsLot();
  await traiterFichePost(e.deps, { organizationId: v.org });
  check('12a. verrou tenu : AUCUN navigateur ouvert, aucune navigation', e.vu.ouvertures === 0 && e.vu.navigations.length === 0, JSON.stringify(e.vu));
  check('12b. et aucune trace, aucun crédit du jour consommé', (await traces(v.org)).length === 0);
  const verrou = (await q(`select lock_owner from linkedin_server_sessions where organization_id = $1`, [v.org])).rows[0].lock_owner;
  check('12c. le verrou de la collecte reste à la collecte', verrou === 'collecte-en-cours', String(verrou));
  await prendreVerrouLinkedIn(v.ctx, 'collecte-en-cours', 0);
  const f = depsLot();
  await traiterFichePost(f.deps, { organizationId: v.org });
  check('12d. verrou libre : le lot s\'exécute, puis rend le verrou', f.vu.navigations.length === 3
    && (await q(`select lock_until is null or lock_until <= now() as libre from linkedin_server_sessions where organization_id = $1`, [v.org])).rows[0].libre === true);
}

async function rattrapageTraitement() {
  console.log('\n# le traitement : page illisible, page lisible, sujet de l\'opérateur');
  const m = await monde5(2, 20);
  const ligne = async (n) => (await q(`select * from linkedin_posts where organization_id = $1 and url = $2`, [m.org, urlN(n)])).rows[0];

  const a = depsLot('', async () => 'jamais');
  let leve = null;
  try { await traiterFichePost(a.deps, { organizationId: m.org }); } catch (e) { leve = e; }
  const l1 = await ligne(1);
  check('13. une page illisible ne lève pas', leve === null, String(leve));
  check('13a. elle incrémente `capture_attempts` (1 -> 2), la fiche reste `pending`, sans texte ni sujet',
    l1.capture_attempts === 2 && l1.review_status === 'pending' && l1.text_excerpt === null && l1.subject === null, JSON.stringify([l1.capture_attempts, l1.review_status]));

  const b = depsLot('Recruter un commercial coûte cher, voici ce que nous avons mesuré.', async (t) => `sujet de : ${t.slice(0, 8)}`);
  await traiterFichePost(b.deps, { organizationId: m.org });
  const l2 = await ligne(1);
  check('13b. une page lisible complète le texte', l2.text_excerpt?.startsWith('Recruter') === true, String(l2.text_excerpt));
  check('13c. le sujet du rédacteur est rangé, d\'origine `model`', l2.subject === 'sujet de : Recruter' && l2.subject_origin === 'model', JSON.stringify([l2.subject, l2.subject_origin]));

  await q(`update linkedin_posts set subject = 'Mon sujet', subject_origin = 'operator', text_excerpt = null where id = $1`, [l2.id]);
  const c = depsLot('Un autre texte lu sur la page.', async () => 'écrasement');
  await traiterFichePost(c.deps, { organizationId: m.org });
  const l3 = await ligne(1);
  check('13d. le sujet de l\'opérateur n\'est pas remplacé', l3.subject === 'Mon sujet' && l3.subject_origin === 'operator', JSON.stringify([l3.subject, l3.subject_origin]));

  // Plus rien d'incomplet : le lot n'ouvre rien.
  await q(`update linkedin_posts set author_name = 'Ana', posted_at = now(), text_excerpt = 'texte' where organization_id = $1`, [m.org]);
  const d = depsLot();
  await traiterFichePost(d.deps, { organizationId: m.org });
  check('13e. aucune fiche incomplète : aucun navigateur ouvert', d.vu.ouvertures === 0);
}

async function main() {
  await jouer(ficheCreeeDeuxFois, deuxSourcesMemePost, rattachementDuSignal, sujetOperateurSurvit, collecteEnModePost, collecteEnModePages, captureEnPanne, rattrapageSelection, rattrapageCritere, rattrapageLot, rattrapageTraitement);
  console.log(`\n[accroche-post] ${failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`}`);
  await boss.stop({ graceful: false, wait: false }).catch(() => undefined);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[accroche-post] ERREUR', e);
  process.exit(2);
});
