// Lot 4a, tâche 6 : exécution RÉELLE, sur Postgres, du chemin « personne ». Aucune
// requête de production n'est recopiée ici : seules les fixtures sont en SQL.
//
// Mutations qui font rougir (voir le rapport de la tâche 6) :
//   1. migration 20261005130305 : retirer `where kind = 'post_engagement'` de
//      l'index des signaux (et son contrôle) — le test 2 rougit ;
//   2. score.ts : mettre `case when false` dans CONSIGNE_DE_SCORING — les signaux
//      restent `new` et les tests 18 à 29 rougissent ;
//   4. post-engagement.ts : remplacer `normaliserUrlPost(urlPost)` par `urlPost` — 15b rougit.
//   3. post-engagement.ts : ne plus lire `existant` — le contact connu est
//      dupliqué (10, 13, 16).
// NB : retirer `where linkedin_url is not null` de l'index des contacts ne fait
// PAS rougir le test 4 : Postgres traite les NULL comme distincts dans un index
// unique, la clause est donc de l'hygiène (index plus petit), pas une garantie.
import pg from 'pg';
import {
  compterSignauxScorables,
  enqueueEnrollments,
  enregistrerEngageur,
  persistEnrichedContact,
  runScore,
} from './_linkedin-chemin-personne-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
const erreur = async (promesse) => {
  try {
    await promesse;
    return null;
  } catch (e) {
    return e;
  }
};

let seq = 0;
async function userNeuf() {
  return (await q(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [`u${Date.now()}${(seq += 1)}@test.local`]))
    .rows[0].id;
}
const CONSIGNE = 'Tu juges si une personne est un directeur commercial a contacter pour une offre de formation. '.repeat(3);

/** Une organisation avec persona, source d'engageurs, campagne active et passage. */
async function monde({ avecPrompt = true, personaDansSource = true } = {}) {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const org = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
  const admin = await userNeuf();
  const viewer = await userNeuf();
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'viewer')`, [org, admin, viewer]);
  const persona = (await q(
    `insert into personas (organization_id, name, scoring_prompt) values ($1, 'Directeur commercial', $2) returning id`,
    [org, avecPrompt ? CONSIGNE : null],
  )).rows[0].id;
  const config = { sourceType: 'linkedin_post_engagers', urlPost: 'https://www.linkedin.com/posts/x_y-1', garder: ['commente'] };
  if (personaDansSource) config.personaId = persona;
  const source = (await q(
    `insert into sources (organization_id, provider_id, name, config) values ($1, 'linkedin_post_engagers', 'Engageurs', $2::jsonb) returning id`,
    [org, JSON.stringify(config)],
  )).rows[0].id;
  const campagne = (await q(
    `insert into campaigns (organization_id, name, status, entry_rules) values ($1, 'C', 'active', $2::jsonb) returning id`,
    [org, JSON.stringify({ personas: [persona] })],
  )).rows[0].id;
  await q(`insert into campaign_sources (campaign_id, source_id) values ($1, $2)`, [campagne, source]);
  const run = (await q(`insert into source_runs (source_id) values ($1) returning id`, [source])).rows[0].id;
  return { org, admin, viewer, persona, source, campagne, run, ctx: { pool, organizationId: org, sourceId: source } };
}

const POST = 'https://www.linkedin.com/posts/x_y-1';
const eng = (id, nom, intitule) => ({ urn: `urn:li:fsd_profile:ACoAA${id}`, nom, intitule });
const enregistrer = (m, e) => enregistrerEngageur(m.ctx, e, { id: m.campagne, personaId: m.persona }, POST);
const scorer = async (prospects) =>
  prospects.map((p) => ({ id: p.id, score: /directeur|directrice/i.test(p.title) ? 85 : 20, reason: 'jugé sur l’intitulé' }));

async function index() {
  console.log('les deux index uniques sont réellement posés');
  const m = await monde();
  const autre = await monde();

  // Signaux : unique restreint à post_engagement.
  const sig = (org, source, kind, ext) =>
    q(`insert into signals (organization_id, source_id, provider_id, external_id, kind, occurred_at) values ($1,$2,'t',$3,$4::signal_kind,now())`, [org, source, ext, kind]);
  await sig(m.org, m.source, 'post_engagement', 'p:1');
  const s2 = await q(`insert into sources (organization_id, provider_id, name, config) values ($1,'linkedin_post_engagers','S2','{}') returning id`, [m.org]);
  const e1 = await erreur(sig(m.org, s2.rows[0].id, 'post_engagement', 'p:1'));
  check('1. même external_id post_engagement dans l’organisation : refusé (23505)', e1?.code === '23505', e1?.code);
  await sig(m.org, m.source, 'job_posting', 'adz:1');
  const e2 = await erreur(sig(m.org, s2.rows[0].id, 'job_posting', 'adz:1'));
  check('2. même annonce d’entreprise reprise sur deux sources : acceptée (l’index est restreint au kind)', e2 === null, e2?.code);
  await sig(autre.org, autre.source, 'post_engagement', 'p:1');
  check('3. même external_id dans une autre organisation : accepté', true);

  // Contacts : unique partiel sur linkedin_url.
  const ct = (org, url) => q(`insert into contacts (organization_id, linkedin_url) values ($1, $2)`, [org, url]);
  const sansUrl = await erreur((async () => { await ct(m.org, null); await ct(m.org, null); })());
  check('4. deux contacts sans adresse LinkedIn coexistent', sansUrl === null, sansUrl?.code);
  await ct(m.org, 'https://www.linkedin.com/in/AAA');
  const memeUrl = await erreur(ct(m.org, 'https://www.linkedin.com/in/AAA'));
  check('5. même adresse LinkedIn dans l’organisation : refusée (23505)', memeUrl?.code === '23505', memeUrl?.code);
  await ct(autre.org, 'https://www.linkedin.com/in/AAA');
  check('6. même adresse dans une autre organisation : acceptée', true);

  const enumOk = (await q(`select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname='signal_kind' and e.enumlabel='post_engagement'`)).rowCount === 1;
  check('7. signal_kind porte post_engagement (lu dans pg_enum)', enumOk);
  const cols = (await q(`select column_name from information_schema.columns where table_name='source_runs' and column_name = any($1)`, [['requetes','vus','nouveaux','doublons','deja_en_campagne','ecartes','ip_sortie','operateur_sortie']])).rowCount;
  check('8. source_runs porte les huit compteurs', cols === 8, String(cols));
}

async function rattachement() {
  console.log('rattachement, doublon, écarté, déjà en campagne');
  const m = await monde();
  const alice = eng('alice', 'Alice Martin', 'Directrice commerciale chez Acme');

  // Contact né d'un signal d'entreprise, avec son email, connu par son identifiant de membre.
  const sigEnt = (await q(
    `insert into signals (organization_id, source_id, provider_id, external_id, kind, occurred_at) values ($1,$2,'adzuna','adz:9','job_posting',now()) returning id`,
    [m.org, m.source],
  )).rows[0].id;
  const connu = (await q(
    `insert into contacts (organization_id, first_name, email, linkedin_provider_id, source_signal_id)
     values ($1,'Alice','alice@acme.fr','ACoAAalice',$2) returning id`,
    [m.org, sigEnt],
  )).rows[0].id;

  const r = await enregistrer(m, alice);
  check('9. l’engageur connu est enregistré', r === 'nouveau', r);
  const rows = (await q(`select id, email, source_signal_id, linkedin_url from contacts where organization_id = $1`, [m.org])).rows;
  check('10. aucun contact dupliqué', rows.length === 1, `n=${rows.length}`);
  check('11. le contact garde son email', rows[0]?.email === 'alice@acme.fr');
  check('12. le contact garde son signal d’origine', rows[0]?.source_signal_id === sigEnt);
  check('13. le contact reçoit son linkedin_url', rows[0]?.linkedin_url?.includes('ACoAAalice') === true, rows[0]?.linkedin_url);
  check('13b. c’est bien le contact connu', rows[0]?.id === connu);

  const bob = eng('bob', 'Bob Durand', 'Directeur commercial');
  check('14. premier passage : nouveau', (await enregistrer(m, bob)) === 'nouveau');
  check('15. second passage, même post : doublon', (await enregistrer(m, bob)) === 'doublon');
  const nb = (await q(`select (select count(*)::int from signals where organization_id=$1 and kind='post_engagement') s, (select count(*)::int from contacts where organization_id=$1) c`, [m.org])).rows[0];
  check('16. un signal par engageur, deux contacts au total', nb.s === 2 && nb.c === 2, JSON.stringify(nb));

  // Le même post écrit autrement n'est pas un autre post.
  const variante = await enregistrerEngageur(m.ctx, bob, { id: m.campagne, personaId: m.persona }, `${POST}/?utm_source=share#c`);
  check('15b. même post sous une autre écriture : doublon (normalisé par la fonction)', variante === 'doublon', variante);
  const sb = (await q(`select count(*)::int n from signals where organization_id=$1 and external_id like '%ACoAAbob'`, [m.org])).rows[0].n;
  check('15c. un seul signal pour Bob', sb === 1, String(sb));

  // Adresse de profil fournie : elle prime sur la déduction de l'URN.
  const fred = { ...eng('fred', 'Fred Noir', 'Directeur commercial'), urlProfil: 'https://fr.linkedin.com/in/fred-noir-42/?trk=x' };
  await enregistrer(m, fred);
  const uf = (await q(`select linkedin_url, linkedin_provider_id from contacts where organization_id=$1 and first_name='Fred'`, [m.org])).rows[0];
  check('15d. l’adresse fournie est celle du contact, en forme canonique', uf?.linkedin_url === 'https://www.linkedin.com/in/fred-noir-42', uf?.linkedin_url);
  check('15e. l’identifiant de membre reste celui de l’URN', uf?.linkedin_provider_id === 'ACoAAfred');
  const fred2 = await enregistrer(m, { ...fred, urlProfil: 'https://www.linkedin.com/in/fred-noir-42' });
  check('15f. même personne, même post : doublon', fred2 === 'doublon', fred2);

  // Déjà en campagne : une inscription vivante sur son adresse.
  const eve = eng('eve', 'Eve Roux', 'Directrice commerciale');
  const ce = (await q(`insert into contacts (organization_id, linkedin_url) values ($1,$2) returning id`, [m.org, 'https://www.linkedin.com/in/ACoAAeve'])).rows[0].id;
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1,$2,$3,'active')`, [m.org, m.campagne, ce]);
  check('17. personne déjà inscrite : deja_en_campagne', (await enregistrer(m, eve)) === 'deja_en_campagne');
  const sigEve = (await q(`select count(*)::int n from signals where organization_id=$1 and external_id like '%ACoAAeve'`, [m.org])).rows[0].n;
  check('17b. aucun signal créé pour elle', sigEve === 0);
}

async function chaine() {
  console.log('du signal au contact scoré, jusqu’à l’inscription');
  const m = await monde();
  const bonne = eng('bonne', 'Claire Petit', 'Directrice commerciale chez Acme');
  const mauvaise = eng('mauvaise', 'Marc Lenoir', 'Développeur Python');
  await enregistrer(m, bonne);
  await enregistrer(m, mauvaise);

  const attendus = await compterSignauxScorables(pool, m.org);
  check('18. compterSignauxScorables compte les deux engageurs (consigne du persona)', attendus === 2, String(attendus));

  const r = await runScore({ pool, organizationId: m.org, scorer });
  check('19. les deux sont scorés (aucun ne reste `new`)', r.scored === 2 && r.qualified === 1 && r.discarded === 1, JSON.stringify(r));

  const sigs = (await q(`select external_id, status from signals where organization_id=$1 and kind='post_engagement'`, [m.org])).rows;
  check('20. le bon est qualifié, le mauvais n’existe plus', sigs.length === 1 && sigs[0].status === 'qualified' && sigs[0].external_id.endsWith('bonne'), JSON.stringify(sigs));
  const cts = (await q(`select first_name from contacts where organization_id=$1`, [m.org])).rows;
  check('21. le contact du mauvais est effacé avec lui', cts.length === 1 && cts[0].first_name === 'Claire', JSON.stringify(cts));
  const ec = (await q(`select external_id from linkedin_engageurs_ecartes where organization_id=$1`, [m.org])).rows;
  check('22. son external_id reste dans linkedin_engageurs_ecartes', ec.length === 1 && ec[0].external_id.endsWith('mauvaise'), JSON.stringify(ec));
  const run = (await q(`select ecartes from source_runs where id=$1`, [m.run])).rows[0];
  check('23. source_runs.ecartes est incrémenté', run.ecartes === 1, JSON.stringify(run));

  check('24. l’écarté n’est pas recréé ni rescoré au passage suivant', (await enregistrer(m, mauvaise)) === 'ecarte');
  const encore = (await q(`select count(*)::int n from signals where organization_id=$1`, [m.org])).rows[0].n;
  check('24b. aucun signal recréé', encore === 1, String(encore));
  const r2 = await runScore({ pool, organizationId: m.org, scorer });
  check('24c. un second scoring n’a rien à juger', r2.considered === 0, JSON.stringify(r2));

  // Le maillon final : enqueueEnrollments, NON modifié, inscrit le contact.
  const jobs = [];
  const boss = { insert: async (lot) => { jobs.push(...lot); } };
  await enqueueEnrollments(boss, pool);
  const contact = (await q(`select id from contacts where organization_id=$1`, [m.org])).rows[0].id;
  check('25. enqueueEnrollments enfile l’inscription du contact scoré',
    jobs.some((j) => j.name === 'sequence.enroll' && j.data.contactId === contact && j.data.campaignId === m.campagne), JSON.stringify(jobs.map((j) => j.data)));
}

async function sansConsigne() {
  console.log('persona sans consigne : rien n’est crédité, rien n’est jugé');
  const m = await monde({ avecPrompt: false });
  await enregistrer(m, eng('x', 'Xavier Roy', 'Directeur commercial'));
  const n = await compterSignauxScorables(pool, m.org);
  const r = await runScore({ pool, organizationId: m.org, scorer });
  const st = (await q(`select status from signals where organization_id=$1`, [m.org])).rows[0].status;
  check('26. compteur et sélection s’accordent (0 et 0)', n === 0 && r.considered === 0, `n=${n} considered=${r.considered}`);
  check('27. le signal reste `new` (consigne non configurée)', st === 'new');

  console.log('persona unique de la campagne quand la source n’en porte pas');
  const u = await monde({ personaDansSource: false });
  await enregistrer(u, eng('y', 'Yves Blanc', 'Directeur commercial'));
  check('28. la consigne vient du persona de la campagne', (await compterSignauxScorables(pool, u.org)) === 1);
  const ru = await runScore({ pool, organizationId: u.org, scorer });
  check('29. et le signal est qualifié', ru.qualified === 1, JSON.stringify(ru));
}

async function entreprise() {
  console.log('le chemin entreprise ne bouge pas');
  const m = await monde();
  const PROMPT = 'Tu qualifies des signaux de recrutement pour une PME industrielle. '.repeat(4);
  const src = (await q(`insert into sources (organization_id, provider_id, name, config) values ($1,'adzuna','Th',$2::jsonb) returning id`, [m.org, JSON.stringify({ scoring_prompt: PROMPT })])).rows[0].id;
  const sansPrompt = (await q(`insert into sources (organization_id, provider_id, name, config) values ($1,'adzuna','Vide','{}') returning id`, [m.org])).rows[0].id;
  const mk = (source, ext, company) =>
    q(`insert into signals (organization_id, source_id, provider_id, external_id, kind, occurred_at, company_hint, title) values ($1,$2,'adzuna',$3,'job_posting',now(),$4,'Commercial')`, [m.org, source, ext, company]);
  await mk(src, 'a1', 'Super PME');
  await mk(sansPrompt, 'a2', 'Autre');
  check('30. un signal d’entreprise sans prompt de source n’est pas compté', (await compterSignauxScorables(pool, m.org)) === 1);
  const seen = [];
  const r = await runScore({ pool, organizationId: m.org, scorer: async (ps, prompt) => { seen.push(prompt); return ps.map((p) => ({ id: p.id, score: 80, reason: 'ok' })); } });
  check('31. il est jugé avec le prompt de SA source', r.qualified === 1 && seen[0] === PROMPT, JSON.stringify(r));
}

async function enrichissement() {
  console.log('un email trouvé plus tard rejoint le contact de l’engageur');
  const m = await monde();
  await enregistrer(m, eng('zoe', 'Zoé Lamy', 'Directrice commerciale'));
  const compte = (await q(`insert into accounts (organization_id, name) values ($1,'Acme') returning id`, [m.org])).rows[0].id;
  const id = await persistEnrichedContact(pool, m.org, compte, {
    email: 'zoe@acme.fr', linkedinUrl: 'https://www.linkedin.com/in/ACoAAzoe', emailStatusRaw: 'DELIVERABLE',
  });
  const rows = (await q(`select id, email, source_signal_id from contacts where organization_id=$1`, [m.org])).rows;
  check('32. un seul contact, il porte l’email', rows.length === 1 && rows[0].email === 'zoe@acme.fr' && rows[0].id === id, JSON.stringify(rows));
  check('33. son signal d’origine est intact', rows[0]?.source_signal_id !== null);
}

async function commeUtilisateur(userId, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('test.user_id', $1, true)`, [userId]);
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
  }
}
const refuse = async (c, sql, params) => {
  await c.query('savepoint s');
  try {
    await c.query(sql, params);
    await c.query('release savepoint s');
    return { refuse: false };
  } catch (e) {
    await c.query('rollback to savepoint s');
    return { refuse: true, code: e.code };
  }
};

async function rls() {
  console.log('rls de linkedin_engageurs_ecartes (sous le rôle authenticated)');
  const A = await monde();
  const B = await monde();
  await q(`insert into linkedin_engageurs_ecartes (organization_id, external_id) values ($1,'a:1'), ($2,'b:1')`, [A.org, B.org]);
  const lire = (c) => c.query(`select organization_id from linkedin_engageurs_ecartes`).then((r) => r.rows.map((x) => x.organization_id));
  await commeUtilisateur(A.viewer, async (c) => {
    const vus = await lire(c);
    check('34. viewer : lit sa ligne et aucune autre', vus.length === 1 && vus[0] === A.org, `vus=${vus.length}`);
  });
  const C = await monde(); // organisation SANS ligne : le refus ne peut venir que de la RLS
  await commeUtilisateur(C.admin, async (c) => {
    const ins = await refuse(c, `insert into linkedin_engageurs_ecartes (organization_id, external_id) values ($1,'c:1')`, [C.org]);
    check('35. admin d’une organisation sans ligne : insert refusé par la RLS (42501)', ins.code === '42501', JSON.stringify(ins));
  });
  await commeUtilisateur(A.admin, async (c) => {
    const d = await c.query(`delete from linkedin_engageurs_ecartes where organization_id = $1`, [A.org]);
    check('36. admin : ne supprime aucune ligne', d.rowCount === 0, `rowCount=${d.rowCount}`);
  });
  const dehors = await userNeuf();
  await commeUtilisateur(dehors, async (c) => check('37. non-membre : ne voit rien', (await lire(c)).length === 0));
}

try {
  await index();
  await rattachement();
  await chaine();
  await sansConsigne();
  await entreprise();
  await enrichissement();
  await rls();
} catch (e) {
  console.error('ERREUR', e);
  failures += 1;
} finally {
  await pool.end();
}
console.log(failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
