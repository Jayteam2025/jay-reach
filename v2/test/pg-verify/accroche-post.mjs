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
//  16. fiche-post.ts : passer la quantité de `consume_provider_credit` de 1 à 2 — 14 rougit.
//  17. message-values.ts : retirer la jointure `linkedin_posts` de REQUETE_LIGNE_INSCRIPTION — 15a et 15c rougissent.
//  18. valeurs-contact.ts : retirer la jointure `linkedin_posts` de lireValeursContact — 15b et 15c rougissent.
//  19. migration linkedin_posts : remettre `people_search,job_change` dans la reprise — 16b et 16c rougissent.
//   7. engageurs.ts : faire naviguer `lireFicheDuPostOuvert` (`pilote.aller`) — 7d rougit.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import PgBoss from 'pg-boss';
import {
  AGE_MAX_SIGNAL_JOURS,
  campagneNommeUnPost,
  compterRetenuesParPost,
  ecrireReglage,
  fenetreValidationPost,
  rejeterFichesPostExpirees,
  ecarterSignauxTropAnciens,
  enqueueEnrichmentContactsConnus,
  enqueueEnrollments,
  enrichirContactConnu,
  enrollContact,
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
  prendreCreditAnthropic,
  fichesARattraper,
  ficheIncomplete,
  prendreVerrouLinkedIn,
  registerQueues,
  chargerLigneInscription,
  buildMessageValues,
  lireValeursContact,
  renderTemplate,
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
      redacteurPour: async () => redacteur,
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

async function sujetCredit() {
  console.log('\n# le crédit du sujet : celui du scoring, une unité par appel');
  const m = await monde();
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'scoring_par_jour', '2'::jsonb)`, [m.org]);
  const r = [await prendreCreditAnthropic(pool, m.org), await prendreCreditAnthropic(pool, m.org), await prendreCreditAnthropic(pool, m.org)];
  const u = (await q(`select used from provider_daily_usage where organization_id = $1 and provider_id = 'anthropic'`, [m.org])).rows;
  check('14. plafond de scoring à 2 : deux crédits accordés, le troisième refusé', JSON.stringify(r) === '[true,true,false]', JSON.stringify(r));
  check('14a. une unité par appel, sur le fournisseur `anthropic`', u.length === 1 && u[0].used === 2, JSON.stringify(u));
}

async function deuxCheminsDeRendu() {
  console.log('\n# les variables de post : même rendu à l\'envoi et à l\'aperçu, sur le même enregistrement');
  const m = await monde();
  const source = await sourceDePost(m, URL_POST, 'Engageurs');
  const runId = await startSourceRun(pool, source);
  const f = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set subject = 'le recrutement des commerciaux', subject_origin = 'operator', review_status = 'approved' where id = $1`, [f.id]);
  const ctx = { pool, organizationId: m.org, sourceId: source, sourceRunId: runId, exclusions: {} };
  await enregistrerEngageur(ctx, { urn: 'urn:li:fsd_profile:ACoAAdeux', nom: 'Dana Test', intitule: 'Directrice commerciale' }, { id: m.campagne, personaId: m.persona }, URL_POST, f.id);
  const sig = (await q(`select id from signals where organization_id = $1`, [m.org])).rows[0];
  const contact = (await q(`select id from contacts where organization_id = $1 order by created_at desc limit 1`, [m.org])).rows[0];
  const insc = (
    await q(`insert into enrollments (organization_id, campaign_id, contact_id, signal_id) values ($1, $2, $3, $4) returning id`, [m.org, m.campagne, contact.id, sig.id])
  ).rows[0].id;

  const CORPS = '{{post_auteur}} | {{post_sujet}} | {{post_url}} | {{post_date}}';
  const envoi = buildMessageValues(await chargerLigneInscription(pool, insc));
  const apercu = (await lireValeursContact(pool, m.org, contact.id, m.campagne))?.valeurs ?? {};
  const rE = renderTemplate(CORPS, envoi);
  const rA = renderTemplate(CORPS, apercu);
  check('15a. la requête d\'envoi résout les quatre variables', rE.missing.length === 0 && rE.text.startsWith('Ana | le recrutement des commerciaux | https://www.linkedin.com/'), JSON.stringify(rE));
  check('15b. la requête de l\'aperçu résout les quatre variables', rA.missing.length === 0, JSON.stringify(rA));
  check('15c. les deux chemins rendent exactement la même chose', rE.text === rA.text && rE.text.endsWith('12/10/2026'), `${rE.text} / ${rA.text}`);

  // Une fiche sans nom affiché : ni l'un ni l'autre n'invente une valeur.
  await q(`update linkedin_posts set author_display_name = null, subject = null where id = $1`, [f.id]);
  const e2 = renderTemplate(CORPS, buildMessageValues(await chargerLigneInscription(pool, insc)));
  const a2 = renderTemplate(CORPS, (await lireValeursContact(pool, m.org, contact.id, m.campagne))?.valeurs ?? {});
  check('15d. sans nom affiché ni sujet, les deux chemins les retiennent', JSON.stringify(e2.missing.sort()) === '["post_auteur","post_sujet"]' && JSON.stringify(a2.missing.sort()) === JSON.stringify(e2.missing), JSON.stringify([e2.missing, a2.missing]));

  // La fiche d'une autre organisation ne se lit jamais, même rattachée par erreur au signal.
  const autre = await monde();
  const g = await enregistrerFichePost(pool, autre.org, fiche(), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set author_display_name = 'Intrus', subject = 'sujet étranger' where id = $1`, [g.id]);
  await q(`update signals set linkedin_post_id = $2 where id = $1`, [sig.id, g.id]);
  const e3 = buildMessageValues(await chargerLigneInscription(pool, insc));
  const a3 = (await lireValeursContact(pool, m.org, contact.id, m.campagne))?.valeurs ?? {};
  check('15e. une fiche d\'une autre organisation n\'est lue par aucun des deux chemins', e3.post_auteur === undefined && a3.post_auteur === undefined, JSON.stringify([e3.post_auteur, a3.post_auteur]));
}

// ------------------------------------------------- la garde d'entrée (tâche 8)

const ACCROCHE = 'Bonjour, je vous ai vu réagir au post de {{post_auteur}} sur {{post_sujet}}.';
const SANS_ACCROCHE = 'Bonjour, parlons prospection.';
/** Accroches qui ne citent qu'UNE variable de post : la garde ne doit exiger que celle-là. */
const ACCROCHE_URL = 'Bonjour, je vous ai vu réagir à ce post : {{post_url}}.';
const ACCROCHE_DATE = 'Bonjour, votre réaction du {{post_date}} m\'a interpellé.';

/**
 * Une étape de séquence et son gabarit : c'est le CORPS du gabarit qui dit si la campagne nomme
 * un post. Canal `linkedin_message` par défaut — une campagne 100 % LinkedIn inscrit un engageur
 * sans email (`sqlCampagneSansEmail`), ce qui isole la garde du post de celle de l'adresse.
 */
async function etapeAvecCorps(m, corps, { canal = 'linkedin_message', position = 0, sujet = null } = {}) {
  const gabarit = (
    await q(
      `insert into message_templates (organization_id, name, channel, locale, body, subject)
       values ($1, 'Modele', $2::channel_kind, 'fr', $3, $4) returning id`,
      [m.org, canal, corps, sujet],
    )
  ).rows[0].id;
  await q(
    `insert into sequence_steps (campaign_id, position, channel, template_parent_id) values ($1, $2, $3::channel_kind, $4)`,
    [m.campagne, position, canal, gabarit],
  );
  return gabarit;
}

/**
 * Une personne collectée sur le post `n`, par les fonctions de production, avec sa fiche dans
 * l'état demandé. Une fiche par post : deux états à éprouver dans la même organisation
 * demandent deux posts.
 */
async function engageurDUnPost(m, n, { etat = 'pending', sujet = 'le recrutement des commerciaux', nomAffiche = 'Ana' } = {}) {
  const source = await sourceDePost(m, urlN(n), `Engageurs ${n}`);
  const runId = await startSourceRun(pool, source);
  const f = await enregistrerFichePost(pool, m.org, ficheN(n), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set review_status = $2, subject = $3, author_display_name = $4 where id = $1`, [
    f.id,
    etat,
    sujet,
    nomAffiche,
  ]);
  const ctx = { pool, organizationId: m.org, sourceId: source, sourceRunId: runId, exclusions: {} };
  await enregistrerEngageur(
    ctx,
    {
      urn: `urn:li:fsd_profile:ACoAA${n}${seq}`,
      nom: `Bob ${n}`,
      intitule: 'Directeur commercial',
      // Adresse PUBLIQUE : sans elle, `sqlAdresseResolvable` écarte la personne de l'achat et la
      // section du gel de la dépense ne prouverait rien.
      urlProfil: `https://www.linkedin.com/in/bob-${n}-${seq}/`,
    },
    { id: m.campagne, personaId: m.persona },
    urlN(n),
    f.id,
  );
  const ligne = (
    await q(
      `select c.id as contact_id, s.id as signal_id from contacts c join signals s on s.id = c.source_signal_id
        where c.organization_id = $1 and s.linkedin_post_id = $2`,
      [m.org, f.id],
    )
  ).rows[0];
  return { fiche: f.id, source, ...ligne };
}

/** Les inscriptions réellement créées pour une organisation, par la production seule. */
const inscritsDe = async (org) =>
  (await q(`select contact_id from enrollments where organization_id = $1`, [org])).rows.map((r) => r.contact_id);

/** Joue `f` en captant ce que le moteur écrit dans ses journaux. */
async function enEcoutant(f) {
  const lignes = [];
  const log = console.log;
  const warn = console.warn;
  console.log = (...a) => lignes.push(a.join(' '));
  console.warn = (...a) => lignes.push(a.join(' '));
  try {
    return { valeur: await f(), lignes };
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

/**
 * Un tour complet de production des inscriptions : le producteur dépose, le traitement inscrit.
 * `limit` large car la requête balaie TOUTES les organisations du harnais d'un seul passage.
 */
async function tourDInscription(org) {
  await demarrerBoss();
  await enqueueEnrollments(boss, pool, { limit: 500 });
  const jobs = (
    await q(`select data from pgboss.job where name = 'sequence.enroll' and data->>'organizationId' = $1`, [org])
  ).rows.map((r) => r.data);
  for (const job of jobs) await enrollContact(pool, job);
  return jobs;
}

async function gardeDEntree() {
  console.log('\n# une campagne qui nomme le post n\'inscrit que sur une fiche validée');
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE);
  const attente = await engageurDUnPost(m, 21, { etat: 'pending' });

  const { valeur: deposes, lignes: journal } = await enEcoutant(() => tourDInscription(m.org));
  check('17. fiche `pending` : personne n\'est inscrit', (await inscritsDe(m.org)).length === 0, JSON.stringify(await inscritsDe(m.org)));
  // Le PRÉ-FILTRE du producteur, distinct du contrôle autoritaire : sans lui, un job serait
  // déposé chaque jour pour une personne que l'inscription refuse, et la file se remplirait de
  // travail nul sans que rien ne le dise.
  check('17-a. et aucun job d\'inscription n\'est déposé pour elle', deposes.length === 0, JSON.stringify(deposes));
  // Une campagne qui retient toute sa population doit être indistinguable d'une campagne SANS
  // candidat pour personne : ni pour l'opérateur, ni dans les journaux du moteur. Le décompte
  // dit COMBIEN et POURQUOI, campagne par campagne.
  const traceRetenues = journal.find((l) => l.includes(m.campagne) && l.includes('validation du post'));
  check('17-b. le moteur journalise ce que la garde retient, par campagne et par motif',
    traceRetenues !== undefined && /1 personne\(s\) retenue\(s\)/.test(traceRetenues)
      && /1 en attente de validation/.test(traceRetenues) && /0 sans post/.test(traceRetenues)
      && /0 fiche inexploitable/.test(traceRetenues), String(traceRetenues));

  await q(`update linkedin_posts set review_status = 'approved' where id = $1`, [attente.fiche]);
  await tourDInscription(m.org);
  check('17a. la fiche validée, la personne est inscrite au passage suivant', (await inscritsDe(m.org)).includes(attente.contact_id));

  // Contrôle autoritaire : un job déposé autrement (reprise à la main, serveur MCP) ne contourne rien.
  const n = await monde();
  await etapeAvecCorps(n, ACCROCHE);
  const direct = await engageurDUnPost(n, 22, { etat: 'pending' });
  const job = { organizationId: n.org, campaignId: n.campagne, contactId: direct.contact_id, signalId: direct.signal_id };
  check('17b. `enrollContact` appelé directement refuse aussi', (await enrollContact(pool, job)) === null);
  await q(`update linkedin_posts set review_status = 'approved' where id = $1`, [direct.fiche]);
  check('17c. et accepte dès que la fiche est validée', typeof (await enrollContact(pool, job)) === 'string');

  // Point de vigilance 1 : c'est le nom AFFICHÉ qui décide, jamais `author_name` (un slug de page).
  const p = await monde();
  await etapeAvecCorps(p, ACCROCHE);
  const slug = await engageurDUnPost(p, 23, { etat: 'approved', nomAffiche: null });
  await q(`update linkedin_posts set author_name = 'uptoo-france' where id = $1`, [slug.fiche]);
  const sansSujet = await engageurDUnPost(p, 24, { etat: 'approved', sujet: null });
  await tourDInscription(p.org);
  const inscritsP = await inscritsDe(p.org);
  check('17d. fiche validée SANS nom affiché : personne n\'est inscrit (le slug ne fait pas une accroche)',
    !inscritsP.includes(slug.contact_id), JSON.stringify(inscritsP));
  check('17e. fiche validée sans sujet : personne n\'est inscrit non plus', !inscritsP.includes(sansSujet.contact_id), JSON.stringify(inscritsP));
  check('17f. ni l\'un ni l\'autre ne produit d\'action envoyable', inscritsP.length === 0, JSON.stringify(inscritsP));
  // L'OBJET d'un email nomme le post aussi bien que son corps : la tâche 6 fabrique justement un
  // objet qui le nomme. Un gabarit dont seul le sujet porte la variable doit être gardé pareil.
  const o = await monde();
  await etapeAvecCorps(o, SANS_ACCROCHE, { canal: 'email', sujet: 'Votre réaction au post de {{post_auteur}}' });
  const parLeSujet = await engageurDUnPost(o, 41, { etat: 'pending' });
  const refusSujet = await enrollContact(pool, {
    organizationId: o.org,
    campaignId: o.campagne,
    contactId: parLeSujet.contact_id,
    signalId: parLeSujet.signal_id,
  });
  check("17g. une campagne qui ne nomme le post que dans l'OBJET est gardée pareil", refusSujet === null, String(refusSujet));

  // Point de vigilance 5, par le chemin des VERSIONS : l'opérateur ne réécrit pas le gabarit, il
  // en publie une nouvelle version. L'ancienne reste en base, retirée. Seules les versions EN
  // VIGUEUR comptent, sinon la campagne resterait « nomme le post » pour toujours et retiendrait
  // ses personnes sans que rien ne l'explique.
  const w = await monde();
  const gabaritW = await etapeAvecCorps(w, ACCROCHE);
  const versionne = await engageurDUnPost(w, 43, { etat: 'pending' });
  const jobW = { organizationId: w.org, campaignId: w.campagne, contactId: versionne.contact_id, signalId: versionne.signal_id };
  check('17h. retenu tant que la version en vigueur nomme le post', (await enrollContact(pool, jobW)) === null);
  await q(`update message_templates set is_active = false where id = $1`, [gabaritW]);
  await q(
    `insert into message_templates (organization_id, name, channel, locale, version, body, parent_id, is_active)
     values ($1, 'Modele', 'linkedin_message'::channel_kind, 'fr', 2, $2, $3, true)`,
    [w.org, SANS_ACCROCHE, gabaritW],
  );
  check('17i. une nouvelle version sans la variable libère la personne, l\'ancienne version ne compte plus',
    typeof (await enrollContact(pool, jobW)) === 'string');

  // La fiche d'une AUTRE organisation ne valide rien, même rattachée par erreur au signal : la
  // garde filtre par organisation, comme les deux chemins de rendu (contrôle 15e).
  const x = await monde();
  await etapeAvecCorps(x, ACCROCHE);
  const local = await engageurDUnPost(x, 44, { etat: 'pending' });
  const etrangere = await monde();
  const ficheEtrangere = await enregistrerFichePost(pool, etrangere.org, ficheN(44), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set review_status = 'approved', subject = 'un sujet', author_display_name = 'Zoe' where id = $1`, [ficheEtrangere.id]);
  await q(`update signals set linkedin_post_id = $2 where id = $1`, [local.signal_id, ficheEtrangere.id]);
  check('17j. une fiche validée d\'une autre organisation ne fait entrer personne',
    (await enrollContact(pool, { organizationId: x.org, campaignId: x.campagne, contactId: local.contact_id, signalId: local.signal_id })) === null);

  // La garde exige les SEULES variables que la campagne écrit. Une campagne qui ne cite que
  // l'adresse du post n'a besoin de rien d'autre : l'URL existe dès la création de la fiche.
  // Exiger l'auteur et le sujet ici retiendrait ses personnes sans aucune raison.
  const y = await monde();
  await etapeAvecCorps(y, ACCROCHE_URL);
  const parLUrl = await engageurDUnPost(y, 46, { etat: 'approved', sujet: null, nomAffiche: null });
  check('17k. une campagne qui ne cite que {{post_url}} inscrit sans auteur affiché ni sujet',
    typeof (await enrollContact(pool, { organizationId: y.org, campaignId: y.campagne, contactId: parLUrl.contact_id, signalId: parLUrl.signal_id })) === 'string');

  // Et symétriquement : celle qui cite la date exige la date, pas le sujet.
  const z = await monde();
  await etapeAvecCorps(z, ACCROCHE_DATE);
  const parLaDate = await engageurDUnPost(z, 47, { etat: 'approved', sujet: null, nomAffiche: null });
  await q(`update linkedin_posts set posted_at = null where id = $1`, [parLaDate.fiche]);
  const jobZ = { organizationId: z.org, campaignId: z.campagne, contactId: parLaDate.contact_id, signalId: parLaDate.signal_id };
  check('17l. une campagne qui cite {{post_date}} est retenue tant que la fiche n\'a pas de date', (await enrollContact(pool, jobZ)) === null);
  await q(`update linkedin_posts set posted_at = now() - interval '2 days' where id = $1`, [parLaDate.fiche]);
  check('17m. et elle entre dès que la date est là, sans exiger ni auteur ni sujet', typeof (await enrollContact(pool, jobZ)) === 'string');
}

async function campagneSansAccrocheNonGelee() {
  console.log('\n# une campagne qui ne nomme pas le post n\'est pas gelée');
  const m = await monde();
  await etapeAvecCorps(m, SANS_ACCROCHE);
  const attente = await engageurDUnPost(m, 25, { etat: 'pending' });
  await tourDInscription(m.org);
  check('18. fiche `pending`, campagne sans accroche : la personne est inscrite', (await inscritsDe(m.org)).includes(attente.contact_id));

  const n = await monde();
  await etapeAvecCorps(n, SANS_ACCROCHE);
  const direct = await engageurDUnPost(n, 26, { etat: 'pending' });
  const id = await enrollContact(pool, { organizationId: n.org, campaignId: n.campagne, contactId: direct.contact_id, signalId: direct.signal_id });
  check('18b. le contrôle autoritaire ne refuse pas non plus', typeof id === 'string', String(id));
}

async function retraitDeLaVariable() {
  console.log('\n# retirer la variable des étapes libère les retenues, sans intervention');
  const m = await monde();
  const gabarit = await etapeAvecCorps(m, ACCROCHE);
  const retenu = await engageurDUnPost(m, 27, { etat: 'pending' });
  const avant = await tourDInscription(m.org);
  check('19. retenu tant que la campagne nomme le post', (await inscritsDe(m.org)).length === 0 && avant.length === 0, JSON.stringify(avant));

  await q(`update message_templates set body = $2 where id = $1`, [gabarit, SANS_ACCROCHE]);
  await tourDInscription(m.org);
  check('19a. la variable retirée, la personne est inscrite au passage suivant', (await inscritsDe(m.org)).includes(retenu.contact_id));
}

async function epargneReelle() {
  console.log('\n# la branche d\'épargne épargne réellement');
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE);
  const qualifie = await engageurDUnPost(m, 28, { etat: 'pending' });
  const neuf = await engageurDUnPost(m, 29, { etat: 'pending' });
  const sansFiche = await engageurDUnPost(m, 30, { etat: 'pending' });
  await q(`update signals set linkedin_post_id = null where id = $1`, [sansFiche.signal_id]);
  // Le signal est plus vieux que le délai d'ancienneté, mais la fiche est encore dans sa fenêtre.
  const vieillir = (id, jours) => q(`update signals set occurred_at = now() - make_interval(days => $2) where id = $1`, [id, jours]);
  await vieillir(qualifie.signal_id, AGE_MAX_SIGNAL_JOURS + 2);
  await vieillir(neuf.signal_id, AGE_MAX_SIGNAL_JOURS + 2);
  await vieillir(sansFiche.signal_id, AGE_MAX_SIGNAL_JOURS + 2);
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [qualifie.signal_id]);

  const vivants = async () =>
    (await q(`select id from signals where id = any($1::uuid[])`, [[qualifie.signal_id, neuf.signal_id, sansFiche.signal_id]])).rows.map((r) => r.id);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  const apres = await vivants();
  check('20. une personne QUALIFIÉE rattachée à une fiche `pending` dans sa fenêtre est épargnée', apres.includes(qualifie.signal_id), JSON.stringify(apres));
  check('20a. une personne jamais scorée l\'est aussi', apres.includes(neuf.signal_id), JSON.stringify(apres));
  check('20b. sans fiche, rien n\'est épargné : la branche n\'épargne pas tout le monde', !apres.includes(sansFiche.signal_id), JSON.stringify(apres));

  // La fenêtre passée, la personne retombe sous la purge ordinaire.
  await q(`update linkedin_posts set expires_at = now() - interval '1 day' where id = any($1::uuid[])`, [[qualifie.fiche, neuf.fiche]]);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  const fin = await vivants();
  check('20c. `expires_at` passé, la personne disparaît', fin.length === 0, JSON.stringify(fin));

  // L'épargne ne vaut que si QUELQU'UN attend la validation de ce post : une campagne qui nomme
  // le post, reliée à la source d'où il vient. Sans cela, on garderait plus longtemps le nom et
  // l'intitulé de personnes que personne n'attend — le coût de la fenêtre sans son bénéfice.
  const sans = await monde();
  await etapeAvecCorps(sans, SANS_ACCROCHE);
  const delaissee = await engageurDUnPost(sans, 48, { etat: 'pending' });
  await q(`update signals set occurred_at = now() - make_interval(days => $2) where id = $1`, [delaissee.signal_id, AGE_MAX_SIGNAL_JOURS + 2]);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  const resteDelaissee = async () => (await q(`select 1 from signals where id = $1`, [delaissee.signal_id])).rowCount;
  check('20d. aucune campagne ne nomme le post : la personne est effacée à l\'échéance ordinaire', (await resteDelaissee()) === 0);

  // La même situation, mais une campagne qui nomme le post est reliée à la source : épargnée.
  const avecQui = await monde();
  await etapeAvecCorps(avecQui, SANS_ACCROCHE);
  const attendue = await engageurDUnPost(avecQui, 49, { etat: 'pending' });
  await q(`update signals set occurred_at = now() - make_interval(days => $2) where id = $1`, [attendue.signal_id, AGE_MAX_SIGNAL_JOURS + 2]);
  const campagneQuiNomme = (
    await q(
      `insert into campaigns (organization_id, name, status, entry_rules) values ($1, 'Avec accroche', 'active', $2::jsonb) returning id`,
      [avecQui.org, JSON.stringify({ personas: [avecQui.persona] })],
    )
  ).rows[0].id;
  await q(`insert into campaign_sources (campaign_id, source_id) values ($1, $2)`, [campagneQuiNomme, attendue.source]);
  await etapeAvecCorps({ ...avecQui, campagne: campagneQuiNomme }, ACCROCHE);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  check('20e. une campagne qui nomme le post, reliée à sa source, l\'épargne', (await q(`select 1 from signals where id = $1`, [attendue.signal_id])).rowCount === 1);

  // Et elle l'épargne même en PAUSE : mettre sa campagne en pause une semaine ne doit pas faire
  // effacer les personnes dont on allait valider le post. C'est l'inverse du quantificateur du
  // gel de la dépense (contrôle 21g), et pour la raison inverse : ici, l'erreur coûteuse est
  // d'effacer à tort. L'épargne reste bornée par `expires_at`.
  await q(`update campaigns set status = 'paused' where id = $1`, [campagneQuiNomme]);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  check('20f. la campagne qui nomme le post est en pause : la personne est épargnée quand même',
    (await q(`select 1 from signals where id = $1`, [attendue.signal_id])).rowCount === 1);

  // Archivée, en revanche, elle n'attend plus rien : garder le nom et l'intitulé d'une personne
  // pour une campagne que personne ne reprendra, c'est payer la rétention sans le bénéfice.
  await q(`update campaigns set status = 'archived' where id = $1`, [campagneQuiNomme]);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  check('20g. la campagne qui nomme le post est archivée : la personne est effacée à l\'échéance ordinaire',
    (await q(`select 1 from signals where id = $1`, [attendue.signal_id])).rowCount === 0);
}

async function gelDeLaDepense() {
  console.log('\n# aucun email acheté sur un post qu\'un humain n\'a pas relu');
  await demarrerBoss();
  const candidats = async (org) =>
    (await q(`select data from pgboss.job where name = 'enrichment.contact_connu' and data->>'organizationId' = $1`, [org])).rows.map(
      (r) => r.data.contactId,
    );
  // La campagne nomme le post ET envoie des emails : c'est le cas où l'achat sert.
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE, { canal: 'email' });
  const attente = await engageurDUnPost(m, 31, { etat: 'pending' });
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [attente.signal_id]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check('21. fiche `pending` : aucun achat enfilé', !(await candidats(m.org)).includes(attente.contact_id), JSON.stringify(await candidats(m.org)));

  await q(`update linkedin_posts set review_status = 'approved' where id = $1`, [attente.fiche]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check('21a. la fiche validée, l\'achat repart', (await candidats(m.org)).includes(attente.contact_id), JSON.stringify(await candidats(m.org)));

  // Une campagne qui ne nomme pas le post achète comme avant : le lot ne gèle aucune dépense existante.
  const n = await monde();
  await etapeAvecCorps(n, SANS_ACCROCHE, { canal: 'email' });
  const libre = await engageurDUnPost(n, 32, { etat: 'pending' });
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [libre.signal_id]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check('21b. campagne sans accroche : l\'achat part malgré la fiche `pending`', (await candidats(n.org)).includes(libre.contact_id), JSON.stringify(await candidats(n.org)));

  // Contrôle autoritaire : la fonction qui DÉPENSE refuse elle-même, et n'appelle pas le fournisseur.
  const p = await monde();
  await etapeAvecCorps(p, ACCROCHE, { canal: 'email' });
  const retenu = await engageurDUnPost(p, 33, { etat: 'pending' });
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [retenu.signal_id]);
  const appels = [];
  const deps = {
    pool,
    cleFullEnrich: async () => 'cle-de-test',
    acheter: async (_cle, entree) => {
      appels.push(entree);
      return { resultat: null, credits: 1 };
    },
  };
  const warn = console.warn;
  console.warn = () => undefined;
  let issue;
  try {
    issue = await enrichirContactConnu(deps, { organizationId: p.org, contactId: retenu.contact_id });
  } finally {
    console.warn = warn;
  }
  check('21c. la fonction qui dépense refuse elle-même, sans appeler le fournisseur', issue === 'post_a_relire' && appels.length === 0, `${issue} / ${appels.length} appel(s)`);
  const marque = (await q(`select enriched_at from contacts where id = $1`, [retenu.contact_id])).rows[0];
  check('21d. et ne marque PAS le contact : le refus est temporaire, pas définitif', marque.enriched_at === null, String(marque.enriched_at));

  // Deux campagnes actives sur la MÊME source, une seule nomme le post. L'autre inscrira la
  // personne dès qu'elle aura son adresse : l'achat n'est donc pas prématuré. C'est pour ce cas
  // que la règle est « TOUTES les campagnes de la source nomment le post », et pas « au moins
  // une » — avec « au moins une », la seconde campagne serait stérilisée sans un mot.
  const r = await monde();
  await etapeAvecCorps(r, ACCROCHE, { canal: 'email' });
  const partage = await engageurDUnPost(r, 42, { etat: 'pending' });
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [partage.signal_id]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check("21e. une seule campagne, qui nomme le post : l'achat est retenu", !(await candidats(r.org)).includes(partage.contact_id));
  const seconde = (
    await q(
      `insert into campaigns (organization_id, name, status, entry_rules) values ($1, 'Sans accroche', 'active', $2::jsonb) returning id`,
      [r.org, JSON.stringify({ personas: [r.persona] })],
    )
  ).rows[0].id;
  await q(`insert into campaign_sources (campaign_id, source_id) values ($1, $2)`, [seconde, partage.source]);
  await etapeAvecCorps({ ...r, campagne: seconde }, SANS_ACCROCHE, { canal: 'email' });
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check("21f. une seconde campagne qui ne le nomme pas rend l'achat légitime", (await candidats(r.org)).includes(partage.contact_id), JSON.stringify(await candidats(r.org)));

  // Une campagne qui n'est pas ACTIVE n'inscrit personne, donc elle ne décide rien ici : l'achat
  // part comme avant ce lot. Sans cette réserve, mettre sa campagne en pause une semaine gèlerait
  // en silence tous les achats de ses sources — un comportement que ce lot n'a pas à changer.
  const u = await monde();
  await etapeAvecCorps(u, ACCROCHE, { canal: 'email' });
  const enPause = await engageurDUnPost(u, 45, { etat: 'pending' });
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [enPause.signal_id]);
  await q(`update campaigns set status = 'paused' where id = $1`, [u.campagne]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check("21g. une campagne en pause ne gèle aucun achat", (await candidats(u.org)).includes(enPause.contact_id), JSON.stringify(await candidats(u.org)));
}

async function fenetreReglable() {
  console.log('\n# la fenêtre de décision est un réglage, et elle a un terme');
  const m = await monde();
  await ecrireReglage(m.ctx, { cle: 'linkedin_fenetre_validation_post_jours', valeur: 40 });
  check('22. la fenêtre lue est celle de l\'organisation', (await fenetreValidationPost(pool, m.org)) === 40);
  const defaut = await monde();
  check('22a. sans réglage, le défaut de 28 jours', (await fenetreValidationPost(pool, defaut.org)) === 28);

  // Point de vigilance 4 : sous le délai d'ancienneté, l'épargne n'épargnerait jamais rien.
  let refus = null;
  try {
    await ecrireReglage(m.ctx, { cle: 'linkedin_fenetre_validation_post_jours', valeur: AGE_MAX_SIGNAL_JOURS });
  } catch (e) {
    refus = e;
  }
  // Le message compte autant que le refus : c'est lui que l'écran affiche (`messageDErreur`,
  // `app/actions/plafonds.ts` lit `details.fieldErrors.valeur`).
  const motif = refus?.details?.fieldErrors?.valeur?.[0] ?? '';
  check('22b. une fenêtre sous le délai d\'ancienneté est refusée, avec un message qui dit pourquoi',
    refus !== null && motif.includes(String(AGE_MAX_SIGNAL_JOURS)) && /ancienneté/.test(motif), `${refus} / ${motif}`);
  check('22c. et la valeur en base n\'a pas bougé', (await fenetreValidationPost(pool, m.org)) === 40);

  // La bascule périodique : seule une `pending` échue change d'état.
  const f = await enregistrerFichePost(pool, m.org, ficheN(34), { fenetreJours: FENETRE });
  const g = await enregistrerFichePost(pool, m.org, ficheN(35), { fenetreJours: FENETRE });
  const h = await enregistrerFichePost(pool, m.org, ficheN(36), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set expires_at = now() - interval '1 hour' where id = any($1::uuid[])`, [[f.id, g.id]]);
  await q(`update linkedin_posts set review_status = 'approved' where id = $1`, [g.id]);
  const bascules = await rejeterFichesPostExpirees(pool);
  const etats = Object.fromEntries(
    (await q(`select id, review_status, reviewed_at, reviewed_by from linkedin_posts where id = any($1::uuid[])`, [[f.id, g.id, h.id]])).rows.map((r) => [
      r.id,
      r,
    ]),
  );
  check('22d. la fiche échue passe en `rejected`', bascules >= 1 && etats[f.id].review_status === 'rejected', `${bascules} / ${etats[f.id].review_status}`);
  check('22e. une fiche validée, même échue, n\'est pas touchée', etats[g.id].review_status === 'approved');
  check('22f. une fiche encore dans sa fenêtre non plus', etats[h.id].review_status === 'pending');
  check('22g. le rejet d\'expiration ne se fait pas passer pour une relecture humaine',
    etats[f.id].reviewed_at === null && etats[f.id].reviewed_by === null, JSON.stringify([etats[f.id].reviewed_at, etats[f.id].reviewed_by]));
}

async function decompteLisible() {
  console.log('\n# le décompte : pourquoi personne ne part');
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE);
  const attente = await engageurDUnPost(m, 37, { etat: 'pending' });
  const prete = await engageurDUnPost(m, 38, { etat: 'approved' });
  const inexploitable = await engageurDUnPost(m, 39, { etat: 'approved', sujet: null });
  const orpheline = await engageurDUnPost(m, 40, { etat: 'pending' });
  await q(`update signals set linkedin_post_id = null where id = $1`, [orpheline.signal_id]);

  const r = await compterRetenuesParPost(pool, m.org, m.campagne);
  check('23. la campagne nomme un post et a une source de post', r.nommeUnPost === true && r.aUneSourceDePost === true, JSON.stringify(r));
  check('23a. les personnes en attente de validation sont comptées', r.enAttenteDeValidation === 1, JSON.stringify(r));
  check('23b. celles sans aucun post aussi', r.sansPost === 1, JSON.stringify(r));
  check('23c. et celles dont la fiche est inexploitable', r.postInexploitable === 1, JSON.stringify(r));

  // Chaque compteur suit bien SA personne : on corrige une fiche à la fois, et un seul bouge.
  await q(`update linkedin_posts set review_status = 'approved' where id = $1`, [attente.fiche]);
  const r2 = await compterRetenuesParPost(pool, m.org, m.campagne);
  check('23d. valider le post en attente vide ce compteur-là, et lui seul',
    r2.enAttenteDeValidation === 0 && r2.sansPost === 1 && r2.postInexploitable === 1, JSON.stringify(r2));
  await q(`update linkedin_posts set subject = 'la prospection' where id = $1`, [inexploitable.fiche]);
  const r3 = await compterRetenuesParPost(pool, m.org, m.campagne);
  check('23e. compléter la fiche inexploitable vide le sien', r3.postInexploitable === 0 && r3.sansPost === 1, JSON.stringify(r3));

  // La personne prête n'est comptée nulle part : une fois inscrite, elle sort même de la population.
  await tourDInscription(m.org);
  const apres = await compterRetenuesParPost(pool, m.org, m.campagne);
  check('23f. la personne inscrite sort du décompte', (await inscritsDe(m.org)).includes(prete.contact_id) && apres.sansPost === 1, JSON.stringify(apres));

  // La mauvaise configuration que l'enregistrement accepte volontairement.
  const n = await monde();
  await etapeAvecCorps(n, ACCROCHE);
  const sansSource = await compterRetenuesParPost(pool, n.org, n.campagne);
  check('23g. une campagne qui nomme un post sans aucune source de post est signalée',
    sansSource.nommeUnPost === true && sansSource.aUneSourceDePost === false, JSON.stringify(sansSource));
  check('23h. `campagneNommeUnPost` dit faux sur une campagne sans étape', (await campagneNommeUnPost(pool, (await monde()).campagne)) === false);
}

async function indexDeJointureDesGabarits() {
  console.log('\n# la jointure des gabarits, que la garde d\'accroche évalue à chaque candidat, porte un index');
  // Les cinq sous-requêtes de la garde (une par variable de post, plus la question « nomme un
  // post ») joignent `message_templates` par `parent_id`. Sans index, chaque évaluation est un
  // parcours séquentiel ; et le coût croît comme le nombre de contacts sans inscription vivante
  // multiplié par le nombre de campagnes actives — exactement ce que la collecte fait grossir.
  const colonnes = (
    await q(
      `select (select array_agg(a.attname::text) from pg_attribute a
                where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) as cols
         from pg_index i where i.indrelid = 'public.message_templates'::regclass and i.indnatts = 1`,
    )
  ).rows.map((r) => (r.cols ?? []).join(','));
  check('24. un index à une colonne sur `message_templates(parent_id)` existe en base', colonnes.includes('parent_id'), JSON.stringify(colonnes));
  const sql = readFileSync(new URL('../../supabase/migrations/20261015092540_linkedin_posts.sql', import.meta.url), 'utf8');
  check('24a. et c\'est la migration du lot qui le pose, pas une main sur la base',
    /create index[^;]*message_templates[^;]*parent_id/i.test(sql));
  check('24b. la migration se vérifie elle-même sur cet index', /index de jointure/i.test(sql));
}

/** La partie « reprise » et la partie « auto-vérification » de la migration, telles qu'écrites dans le fichier. */
function morceauxDeLaMigration() {
  const sql = readFileSync(new URL('../../supabase/migrations/20261015092540_linkedin_posts.sql', import.meta.url), 'utf8');
  const debut = sql.indexOf('create function pg_temp.cle_post');
  const verif = sql.indexOf('-- La migration se vérifie elle-même.');
  return { reprise: sql.slice(debut, verif), verification: sql.slice(verif) };
}

async function repriseDeLExistant() {
  console.log('\n# la reprise de l\'existant : seulement post_engagement');
  const m = await monde();
  const source = await sourceDePost(m, URL_POST, 'Engageurs');
  const signal = async (kind, ext, url) =>
    (await q(`insert into signals (organization_id, source_id, external_id, kind, occurred_at, url) values ($1, $2, $3, $4::signal_kind, now(), $5) returning id`, [m.org, source, ext, kind, url])).rows[0].id;
  const sPost = await signal('post_engagement', 'rep-post', URL_POST);
  const sRech = await signal('people_search', 'rep-rech', 'https://www.linkedin.com/search/results/content/?keywords=prospection');
  const sPoste = await signal('job_change', 'rep-poste', 'https://www.linkedin.com/in/dana-test/');

  // Les sections précédentes ont laissé des signaux sans fiche (cas voulus) : l'auto-vérification de la
  // migration lit toute la base, on ne garde donc que ceux de cette section (elle joue en dernier).
  await q(`delete from signals where organization_id <> $1`, [m.org]);
  const { reprise, verification } = morceauxDeLaMigration();
  const client = await pool.connect();
  try {
    await client.query(reprise); // les fonctions pg_temp vivent le temps de la session
    await client.query(verification);
  } finally {
    client.release();
  }
  const rattaches = (await q(`select id, linkedin_post_id from signals where id = any($1::uuid[])`, [[sPost, sRech, sPoste]])).rows;
  const par = Object.fromEntries(rattaches.map((r) => [r.id, r.linkedin_post_id]));
  const fiches = (await q(`select url from linkedin_posts where organization_id = $1`, [m.org])).rows;
  check('16a. le signal post_engagement est rattaché', par[sPost] !== null);
  check('16b. ni la recherche par mots-clés ni le changement de poste ne le sont', par[sRech] === null && par[sPoste] === null, JSON.stringify(par));
  check('16c. aucune fiche créée pour leur adresse', fiches.length === 1 && fiches[0].url === URL_POST, JSON.stringify(fiches));
}

async function main() {
  await jouer(ficheCreeeDeuxFois, deuxSourcesMemePost, rattachementDuSignal, sujetOperateurSurvit, collecteEnModePost, collecteEnModePages, captureEnPanne, rattrapageSelection, rattrapageCritere, rattrapageLot, rattrapageTraitement, sujetCredit, deuxCheminsDeRendu, gardeDEntree, campagneSansAccrocheNonGelee, retraitDeLaVariable, epargneReelle, gelDeLaDepense, fenetreReglable, decompteLisible, indexDeJointureDesGabarits, repriseDeLExistant);
  console.log(`\n[accroche-post] ${failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`}`);
  await boss.stop({ graceful: false, wait: false }).catch(() => undefined);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[accroche-post] ERREUR', e);
  process.exit(2);
});
