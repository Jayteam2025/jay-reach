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
//   5. post-engagement.ts : retirer le coalesce de source_signal_id (rattachement), le ou-membre de deja_en_campagne,
//      le parse du schéma, ou la clause « juge » — 15a2, 17c, 15g, 41b/39 rougissent.
//   6. producer.ts : remettre `compter: true` (ou retirer l'option) sur l'appel de la purge — 41f rougit.
//   7. producer.ts : retirer la borne `ct.enriched_at >= now() - make_interval(days => $2)` de
//      l'épargne par email acheté — 41d rougit (l'engageur est retenu indéfiniment) ;
//      retirer `or (ct.email is not null and ct.enriched_at is null)` — 41g rougit ;
//      retirer `or ct.created_at < s.occurred_at` — 41h rougit (le contact importé est détruit).
// NB : retirer `where linkedin_url is not null` de l'index des contacts ne fait
// PAS rougir le test 4 : Postgres traite les NULL comme distincts dans un index
// unique, la clause est donc de l'hygiène (index plus petit), pas une garantie.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import {
  compterSignauxScorables,
  ecarterSignalDePersonne,
  ecarterSignauxTropAnciens,
  enqueueEnrollments,
  enregistrerEngageur,
  importerCsv,
  persistEnrichedContact,
  runScore,
  normaliserUrlPost,
  KINDS_PERSONNE,
  sqlPredicatUniciteDePersonne,
  enregistrerChangementDePoste,
} from './_linkedin-chemin-personne-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

// Chaque section tourne dans son propre `try` : une exception dans l'une ne doit
// pas emporter les suivantes. Un harnais qui saute une preuve en silence est
// pire qu'un harnais rouge — on lit « 1 ÉCHEC » en croyant le reste prouvé.
async function jouer(...sections) {
  for (const section of sections) {
    try {
      await section();
    } catch (e) {
      check(`section ${section.name} : exception, ses contrôles n'ont PAS été joués`, false, String(e?.message ?? e));
    }
  }
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
  return { org, admin, viewer, persona, source, campagne, run, ctx: { pool, organizationId: org, sourceId: source, sourceRunId: run } };
}

const POST = 'https://www.linkedin.com/posts/x_y-1';
// La mémoire d'écart stocke une EMPREINTE (sha256) de `<post>:<urn>`, jamais l'identifiant lisible.
const empreinteSql = (id) => `encode(sha256(convert_to('${normaliserUrlPost(POST)}:urn:li:fsd_profile:ACoAA${id}', 'UTF8')), 'hex')`;
// `eng` : adresse DÉDUITE de l'URN, que ni LinkedIn ni FullEnrich ne résolvent. `engPublic` : la réponse Voyager a livré
// le nom public (`urlProfil`), c'est le cas qu'on peut chercher, enrichir, et donc scorer.
const eng = (id, nom, intitule) => ({ urn: `urn:li:fsd_profile:ACoAA${id}`, nom, intitule });
const engPublic = (id, nom, intitule) => ({ ...eng(id, nom, intitule), urlProfil: `https://www.linkedin.com/in/pub-${id}` });
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
  check('9. l’engageur connu (signal d’origine existant) rend doublon, sans second signal', r === 'doublon', r);
  const sa = (await q(`select count(*)::int n from signals where organization_id=$1 and external_id like '%ACoAAalice'`, [m.org])).rows[0].n;
  check('9b. aucun signal créé pour lui (il serait scoré pour rien)', sa === 0, String(sa));
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
  check('16. un signal par engageur nouveau (Bob), deux contacts au total', nb.s === 1 && nb.c === 2, JSON.stringify(nb));

  // Contact connu SANS signal d'origine (import manuel, signal effacé) : il reçoit le nouveau.
  const orph = (await q(`insert into contacts (organization_id, first_name, email, linkedin_provider_id) values ($1,'Odile','odile@acme.fr','ACoAAodile') returning id`, [m.org])).rows[0].id;
  check('15a. contact sans origine rattaché : nouveau', (await enregistrer(m, eng('odile', 'Odile Roche', 'Directrice commerciale'))) === 'nouveau');
  const so0 = (await q(`select c.email, c.source_signal_id, s.external_id from contacts c left join signals s on s.id = c.source_signal_id where c.id=$1`, [orph])).rows[0];
  check('15a2. son origine est comblée par le nouveau signal, son email est intact', so0.email === 'odile@acme.fr' && so0.external_id?.endsWith('ACoAAodile') === true, JSON.stringify(so0));
  const nOdile = (await q(`select count(*)::int n from contacts where organization_id=$1 and (first_name='Odile' or linkedin_provider_id='ACoAAodile')`, [m.org])).rows[0].n;
  check('15a3. aucun doublon de contact', nOdile === 1);

  // Un urn vide est refusé avant toute écriture.
  const avant = (await q(`select (select count(*) from contacts where organization_id=$1)::int c, (select count(*) from signals where organization_id=$1)::int s`, [m.org])).rows[0];
  const vide = await erreur(enregistrerEngageur(m.ctx, { urn: '', nom: 'Sans Urn', intitule: 'x' }, { id: m.campagne, personaId: m.persona }, POST));
  const apres = (await q(`select (select count(*) from contacts where organization_id=$1)::int c, (select count(*) from signals where organization_id=$1)::int s`, [m.org])).rows[0];
  check('15g. un urn vide est refusé, rien n’est écrit', vide !== null && avant.c === apres.c && avant.s === apres.s, String(vide));

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

  // Déjà en campagne, reconnue par son SEUL identifiant de membre.
  const gus = (await q(`insert into contacts (organization_id, email, linkedin_provider_id) values ($1,'gus@acme.fr','ACoAAgus') returning id`, [m.org])).rows[0].id;
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1,$2,$3,'active')`, [m.org, m.campagne, gus]);
  check('17c. inscrit, connu par son seul identifiant de membre : deja_en_campagne', (await enregistrer(m, eng('gus', 'Gus Fort', 'Directeur'))) === 'deja_en_campagne');

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
  const bonne = engPublic('bonne', 'Claire Petit', 'Directrice commerciale chez Acme');
  const mauvaise = engPublic('mauvaise', 'Marc Lenoir', 'Développeur Python');
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
  const ec = (await q(`select external_id, external_id = ${empreinteSql('mauvaise')} as attendue from linkedin_engageurs_ecartes where organization_id=$1`, [m.org])).rows;
  check('22. son EMPREINTE (sha256, pas l’URN) reste dans linkedin_engageurs_ecartes', ec.length === 1 && ec[0].attendue === true && /^[0-9a-f]{64}$/.test(ec[0].external_id), JSON.stringify(ec));
  const run = (await q(`select ecartes from source_runs where id=$1`, [m.run])).rows[0];
  check('23. source_runs.ecartes est incrémenté', run.ecartes === 1, JSON.stringify(run));
  const run2 = (await q(`insert into source_runs (source_id) values ($1) returning id`, [m.source])).rows[0].id;
  const autreProfil = engPublic('tard', 'Tardif Retard', 'Stagiaire');
  await enregistrerEngageur({ ...m.ctx, sourceRunId: m.run }, autreProfil, { id: m.campagne, personaId: m.persona }, POST);
  // Un passage plus récent existe quand le scoring juge : l'écart va à celui qui a COLLECTÉ.
  await runScore({ pool, organizationId: m.org, scorer });
  const rc1 = (await q(`select ecartes from source_runs where id=$1`, [m.run])).rows[0].ecartes;
  const rc2 = (await q(`select ecartes from source_runs where id=$1`, [run2])).rows[0].ecartes;
  check('23b. l’écart est compté sur le passage collecteur (2), pas sur le plus récent (0)', rc1 === 2 && rc2 === 0, `collecteur=${rc1} recent=${rc2}`);

  check('24. l’écarté n’est pas recréé ni rescoré au passage suivant', (await enregistrer(m, mauvaise)) === 'ecarte');
  const encore = (await q(`select count(*)::int n from signals where organization_id=$1`, [m.org])).rows[0].n;
  check('24b. aucun signal recréé', encore === 1, String(encore));
  const r2 = await runScore({ pool, organizationId: m.org, scorer });
  check('24c. un second scoring n’a rien à juger', r2.considered === 0, JSON.stringify(r2));

  // Le maillon final : enqueueEnrollments. Un engageur naît SANS email ; l'inscrire
  // maintenant brûlerait une place du plafond et le tick l'arrêterait (not_sendable).
  const jobs = [];
  const boss = { insert: async (lot) => { jobs.push(...lot); } };
  const contact = (await q(`select id from contacts where organization_id=$1`, [m.org])).rows[0].id;
  const inscrit = () => jobs.some((j) => j.name === 'sequence.enroll' && j.data.contactId === contact && j.data.campaignId === m.campagne);
  await enqueueEnrollments(boss, pool);
  check('25. un engageur qualifié SANS email n’est pas inscrit', !inscrit(), JSON.stringify(jobs.filter((j) => j.data.organizationId === m.org).map((j) => j.data.contactId)));
  // L'email est posé par le CHEMIN RÉEL : le rattachement de `persistEnrichedContact`,
  // qui retrouve le contact de l'engageur par son adresse. Un `update` nu poserait
  // l'email seul, alors que le chemin réel pose AUSSI `enriched_at`, `account_id` et
  // `persona_id` — le contrôle survivrait donc au jour où l'inscription exigera l'un
  // d'eux, comme elle exige déjà `ct.persona_id is not null`.
  const compteClaire = (await q(`insert into accounts (organization_id, name) values ($1,'Acme') returning id`, [m.org])).rows[0].id;
  const urlClaire = (await q(`select linkedin_url from contacts where id = $1`, [contact])).rows[0].linkedin_url;
  await persistEnrichedContact(pool, m.org, compteClaire, { email: 'claire@acme.fr', linkedinUrl: urlClaire, emailStatusRaw: 'valid' });
  await enqueueEnrollments(boss, pool);
  // L'assertion porte aussi sur ce que le chemin réel pose EN PLUS de l'email : le
  // jour où l'inscription exigera le compte ou le persona — elle exige déjà
  // `ct.persona_id is not null` — ce contrôle restera fidèle au chemin réel.
  const claire = (await q(`select account_id, persona_id, enriched_at from contacts where id = $1`, [contact])).rows[0];
  check('25b. le même engageur, son email posé par l’enrichissement, est inscrit',
    inscrit() && claire.account_id !== null && claire.persona_id !== null && claire.enriched_at !== null,
    JSON.stringify(claire));
}

async function purgeEtRegression() {
  console.log('purge d’ancienneté, et chemin entreprise face à l’index des adresses');
  const m = await monde({ avecPrompt: false });
  const vieux = engPublic('vieux', 'Victor Vieux', 'Directeur commercial');
  const recent = engPublic('recent', 'Rita Recente', 'Directrice commerciale');
  await enregistrer(m, vieux);
  await enregistrer(m, recent);
  await q(`update signals set occurred_at = now() - interval '30 days' where organization_id=$1 and external_id like '%ACoAAvieux'`, [m.org]);
  // Un engageur qualifié et ancien, et une offre d'emploi ancienne : le premier suit son contact, la seconde le chemin d'avant.
  const qual = engPublic('qual', 'Quentin Qualifie', 'Directeur commercial');
  await enregistrer(m, qual);
  await q(`update signals set occurred_at = now() - interval '30 days', status='qualified', score=80 where organization_id=$1 and external_id like '%ACoAAqual'`, [m.org]);
  await q(`insert into signals (organization_id, source_id, provider_id, external_id, kind, occurred_at, company_hint) values ($1,$2,'adzuna','adz:old','job_posting', now() - interval '30 days','Vieille PME')`, [m.org, m.source]);

  const ecAvant = (await q(`select ecartes from source_runs where id=$1`, [m.run])).rows[0].ecartes;
  await ecarterSignauxTropAnciens(pool, 14);
  const sv = (await q(`select count(*)::int n from signals where organization_id=$1 and external_id like '%ACoAAvieux'`, [m.org])).rows[0].n;
  const cv = (await q(`select count(*)::int n from contacts where organization_id=$1 and first_name='Victor'`, [m.org])).rows[0].n;
  const ev = (await q(`select count(*)::int n from linkedin_engageurs_ecartes where organization_id=$1 and external_id = ${empreinteSql('vieux')}`, [m.org])).rows[0].n;
  check('38. l’engageur ancien resté `new` est effacé avec son contact', sv === 0 && cv === 0, `signal=${sv} contact=${cv}`);
  check('39. périmé AVANT jugement : aucune mémoire d’écart (il pourra être recollecté)', ev === 0, String(ev));
  const sr = (await q(`select count(*)::int n from signals where organization_id=$1 and external_id like '%ACoAArecent'`, [m.org])).rows[0].n;
  check('40. l’engageur récent est intact', sr === 1);
  const sq = (await q(`select status from signals where organization_id=$1 and external_id like '%ACoAAqual'`, [m.org])).rows[0];
  const cq = (await q(`select count(*)::int n from contacts where organization_id=$1 and first_name='Quentin'`, [m.org])).rows[0].n;
  check('41. l’engageur qualifié ancien SANS email ni inscription est effacé (il n’a plus de sortie sinon), avec sa mémoire', sq === undefined && cq === 0, JSON.stringify(sq));
  const eq = (await q(`select count(*)::int n from linkedin_engageurs_ecartes where organization_id=$1 and external_id = ${empreinteSql('qual')}`, [m.org])).rows[0].n;
  check('41a. jugé donc mémorisé : il ne sera pas recollecté sur ce post', eq === 1, String(eq));
  // L'épargne d'un email ACHETÉ par nous est bornée à FACTEUR_EPARGNE_EMAIL x le délai
  // (ici 2 x 14 = 28 jours) et se compte depuis l'achat (`contacts.enriched_at`), pas depuis
  // la collecte : sinon la marge dépendrait du retard de la file d'enrichissement. Un contact
  // qui a un email sans inscription n'a jamais été contacté, il n'a aucun historique d'envoi à
  // protéger, et le garder sans limite serait la rétention indéfinie que la purge ferme.
  // Vera (achat il y a 20 jours) est dans la fenêtre, Oscar (40 jours) l'a dépassée.
  await enregistrer(m, eng('vivant', 'Vera Vivante', 'Directrice commerciale'));
  await q(`update signals set occurred_at = now() - interval '20 days', status='qualified', score=80 where organization_id=$1 and external_id like '%ACoAAvivant'`, [m.org]);
  await q(`update contacts set email = 'vera@acme.fr', enriched_at = now() - interval '20 days' where organization_id=$1 and first_name='Vera'`, [m.org]);
  await enregistrer(m, eng('oublie', 'Oscar Oublie', 'Directeur commercial'));
  await q(`update signals set occurred_at = now() - interval '40 days', status='qualified', score=80 where organization_id=$1 and external_id like '%ACoAAoublie'`, [m.org]);
  await q(`update contacts set email = 'oscar@acme.fr', enriched_at = now() - interval '40 days' where organization_id=$1 and first_name='Oscar'`, [m.org]);
  // Contact MIGRÉ DE LA V1 : `20260828150000_migration_donnees_legacy.sql:251` insère
  // `email` et `linkedin_url` sans `enriched_at`, et la migration ne crée AUCUNE
  // inscription (vérifié : le mot `enrollments` n'y figure pas). C'est le seul chemin
  // de production qui donne un email que nous n'avons pas acheté sans inscription ;
  // il n'est pas exécutable ici (il lit les tables du schéma v1), d'où le SQL direct.
  // Un engageur le retrouve ensuite par son adresse et comble son origine vide.
  const urlLegacy = 'https://www.linkedin.com/in/nina-native';
  await q(
    `insert into contacts (organization_id, first_name, email, linkedin_url, created_at)
     values ($1,'Nina','nina@acme.fr',$2, now() - interval '90 days')`,
    [m.org, urlLegacy],
  );
  await enregistrer(m, { ...eng('nina', 'Nina Native', 'Directrice commerciale'), urlProfil: urlLegacy });
  await q(`update signals set occurred_at = now() - interval '40 days', status='qualified', score=80 where organization_id=$1 and external_id like '%ACoAAnina'`, [m.org]);

  // Contact ENRICHI SANS ORIGINE : `persistEnrichedContact` accepte `sourceSignalId`
  // nul (enrichment-persist.ts:113) — l'enrichissement d'un compte crée alors une
  // fiche avec email, `enriched_at` et adresse, que `enqueueEnrollments` n'inscrira
  // jamais puisqu'il joint sur `source_signal_id`. Aucune inscription, aucune liste :
  // quand un engageur comble son origine, SEULE l'antériorité peut l'épargner, son
  // achat étant trop vieux. (L'état précédent — `source_list_id` SANS inscription —
  // n'existe dans aucun chemin : `importerCsv` inscrit systématiquement.)
  const compteIvan = (await q(`insert into accounts (organization_id, name) values ($1,'Ivan SARL') returning id`, [m.org])).rows[0].id;
  const urlImporte = 'https://www.linkedin.com/in/ivan-importe';
  await persistEnrichedContact(pool, m.org, compteIvan, { email: 'ivan@acme.fr', firstName: 'Ivan', linkedinUrl: urlImporte });
  // Le temps passe : l'achat date, et la fiche est plus ancienne que le signal à venir.
  await q(`update contacts set enriched_at = now() - interval '50 days', created_at = now() - interval '60 days' where organization_id=$1 and first_name='Ivan'`, [m.org]);
  const issueImporte = await enregistrer(m, { ...eng('importe', 'Ivan Importe', 'Directeur commercial'), urlProfil: urlImporte });
  await q(`update signals set occurred_at = now() - interval '40 days', status='qualified', score=80 where organization_id=$1 and external_id like '%ACoAAimporte'`, [m.org]);

  // L'épargne par INSCRIPTION n'a pas de borne. L'état — un contact d'engageur SANS
  // email mais inscrit — n'est pas produit par le worker (`producer.ts` refuse
  // d'inscrire un `post_engagement` sans email) : son seul producteur est l'import de
  // fichier, qui retrouve le contact par son adresse et l'inscrit même sans email.
  // La fiche est POSTÉRIEURE à son signal, donc l'antériorité ne la couvre pas :
  // l'inscription est bien la seule branche qui joue.
  const urlSacha = 'https://www.linkedin.com/in/sacha-sequence';
  await enregistrer(m, { ...eng('seq', 'Sacha Sequence', 'Directrice commerciale'), urlProfil: urlSacha });
  await importerCsv(
    { ex: pool, organisationId: m.org, utilisateurId: m.admin, role: 'admin' },
    {
      campagneId: m.campagne,
      nom: 'Salon',
      fileName: 'salon.csv',
      parsed: { headers: ['Prenom', 'Email', 'LinkedIn'], rows: [{ Prenom: 'Sacha', Email: '', LinkedIn: urlSacha }] },
      mapping: { Prenom: 'first_name', Email: 'email', LinkedIn: 'linkedin_url' },
    },
  );
  await q(`update signals set occurred_at = now() - interval '40 days', status='qualified', score=80 where organization_id=$1 and external_id like '%ACoAAseq'`, [m.org]);
  await ecarterSignauxTropAnciens(pool, 14);
  const vv = (await q(`select (select count(*)::int from signals where organization_id=$1 and external_id like '%ACoAAvivant') s, (select count(*)::int from contacts where organization_id=$1 and first_name='Vera') c`, [m.org])).rows[0];
  check('41c. email acheté il y a moins du double du délai : épargné', vv.s === 1 && vv.c === 1, JSON.stringify(vv));
  const oo = (await q(`select (select count(*)::int from signals where organization_id=$1 and external_id like '%ACoAAoublie') s, (select count(*)::int from contacts where organization_id=$1 and first_name='Oscar') c, (select count(*)::int from linkedin_engageurs_ecartes where organization_id=$1 and external_id = ${empreinteSql('oublie')}) e`, [m.org])).rows[0];
  check('41d. email acheté au-delà du double du délai : effacé avec mémoire (pas de rétention indéfinie)', oo.s === 0 && oo.c === 0 && oo.e === 1, JSON.stringify(oo));
  const nn = (await q(`select (select count(*)::int from signals where organization_id=$1 and external_id like '%ACoAAnina') s, (select count(*)::int from contacts where organization_id=$1 and first_name='Nina') c`, [m.org])).rows[0];
  // Couvert par DEUX branches (antériorité et email non acheté) : il prouve le
  // comportement — un contact migré de la v1 survit — mais aucune des deux isolément.
  check('41g. contact migré de la v1, retrouvé par un engageur : il survit avec son email', nn.s === 1 && nn.c === 1, JSON.stringify(nn));
  const ii = (await q(`select (select count(*)::int from signals where organization_id=$1 and external_id like '%ACoAAimporte') s, (select count(*)::int from contacts where organization_id=$1 and first_name='Ivan' and email is not null) c`, [m.org])).rows[0];
  check('41h. fiche enrichie sans origine, achat trop vieux, aucune inscription : seule l’antériorité l’épargne', issueImporte === 'nouveau' && ii.s === 1 && ii.c === 1, `${issueImporte} ${JSON.stringify(ii)}`);
  const ss = (await q(`select (select count(*)::int from signals where organization_id=$1 and external_id like '%ACoAAseq') s, (select count(*)::int from contacts where organization_id=$1 and first_name='Sacha') c, (select count(*)::int from enrollments e join contacts c2 on c2.id=e.contact_id where c2.organization_id=$1 and c2.first_name='Sacha') i`, [m.org])).rows[0];
  check('41e. inscrit par l’import sans email, au-delà du double : épargné, l’épargne par inscription n’est pas bornée', ss.s === 1 && ss.c === 1 && ss.i === 1, JSON.stringify(ss));
  // Le passage qui a collecté ces personnes est clos : la purge le laisse tel quel.
  const ec = (await q(`select ecartes from source_runs where id=$1`, [m.run])).rows[0].ecartes;
  check('41f. purge d’un engageur qualifié : source_runs.ecartes du passage de collecte inchangé', ec === 0 && ecAvant === 0, `avant=${ecAvant} apres=${ec}`);
  const so = (await q(`select status, discard_reason from signals where organization_id=$1 and external_id='adz:old'`, [m.org])).rows[0];
  check('42. l’offre d’emploi ancienne suit toujours la règle d’avant (discarded / stale)', so?.status === 'discarded' && so?.discard_reason === 'stale', JSON.stringify(so));

  // Périmé au pré-filtre du scoring : jamais jugé, donc jamais mémorisé non plus.
  const p = await monde();
  await enregistrer(p, engPublic('perime', 'Paul Perime', 'Directeur commercial'));
  await q(`update signals set occurred_at = now() - interval '90 days' where organization_id=$1`, [p.org]);
  const rp = await runScore({ pool, organizationId: p.org, scorer });
  const sp = (await q(`select (select count(*)::int from signals where organization_id=$1) s, (select count(*)::int from linkedin_engageurs_ecartes where organization_id=$1) e, (select ecartes from source_runs where id=$2) r`, [p.org, p.run])).rows[0];
  check('41b. périmé au pré-filtre : effacé, sans mémoire d’écart ni compteur d’écart', rp.scored === 0 && sp.s === 0 && sp.e === 0 && sp.r === 0, JSON.stringify(sp));

  // Chemin entreprise : le contact porte L et un email A ; FullEnrich rend L avec un email B.
  const compte = (await q(`insert into accounts (organization_id, name) values ($1,'Acme') returning id`, [m.org])).rows[0].id;
  await q(`insert into contacts (organization_id, first_name, email, linkedin_url) values ($1,'Ada','a@acme.fr','https://www.linkedin.com/in/ada-1')`, [m.org]);
  const r = await erreur(persistEnrichedContact(pool, m.org, compte, { email: 'b@acme.fr', linkedinUrl: 'https://www.linkedin.com/in/ada-1' }));
  check('43. adresse déjà portée par un contact avec un autre email : le job ne tombe pas', r === null, String(r));
  const nb = (await q(`select count(*)::int n from contacts where organization_id=$1 and first_name='Ada'`, [m.org])).rows[0].n;
  check('43b. aucune fiche créée ni fusionnée', nb === 1);

  // Autre graphie de la même adresse : le contact de l'engageur est retrouvé, pas doublé.
  await enregistrer(m, { ...eng('zed', 'Zed Zan', 'Directeur commercial'), urlProfil: 'https://www.linkedin.com/in/zed-zan' });
  const id = await persistEnrichedContact(pool, m.org, compte, { email: 'zed@acme.fr', linkedinUrl: 'https://fr.linkedin.com/in/zed-zan/?trk=x' });
  const zz = (await q(`select count(*)::int n from contacts where organization_id=$1 and linkedin_url like '%zed-zan%'`, [m.org])).rows[0].n;
  check('44. une autre graphie de l’adresse retrouve le contact de l’engageur', zz === 1 && id !== null, `n=${zz}`);
}

/**
 * La garde vit dans `ecarterSignalDePersonne`, donc elle vaut pour TOUS ses appelants.
 * Portée par le `select` de la purge, elle ne protégeait que celle-ci : le
 * scoring et la purge des `new` effaçaient la fiche d'un opérateur sans condition.
 */
async function gardeDeLEffacement() {
  console.log('ecarterSignalDePersonne : seule une fiche née de cet engageur est effacée');

  // Odile : importée par l'opérateur (liste), séquence TERMINÉE — `completed` n'est
  // pas un statut vivant, donc l'étape 3 ne rend pas `deja_en_campagne` — et sans
  // origine, que le rattachement comble. Le scoring la juge hors ICP.
  const m = await monde();
  const liste = (await q(`insert into lists (organization_id, name, context_note, origin) values ($1,'Salon','Contacts du salon','import') returning id`, [m.org])).rows[0].id;
  const odile = (await q(
    `insert into contacts (organization_id, first_name, email, linkedin_url, source_list_id, created_at)
     values ($1,'Odile','odile@acme.fr','https://www.linkedin.com/in/odile-ancienne',$2, now() - interval '60 days') returning id`,
    [m.org, liste],
  )).rows[0].id;
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1,$2,$3,'completed')`, [m.org, m.campagne, odile]);
  await q(`insert into list_members (list_id, contact_id, raw_row) values ($1,$2,'{}'::jsonb)`, [liste, odile]);
  await enregistrer(m, { ...eng('odile', 'Odile Ancienne', 'Plombière'), urlProfil: 'https://www.linkedin.com/in/odile-ancienne' });
  const r = await runScore({ pool, organizationId: m.org, scorer });
  const o = (await q(
    `select (select count(*)::int from contacts where id=$2) c,
            (select count(*)::int from list_members where contact_id=$2) lm,
            (select count(*)::int from enrollments where contact_id=$2) e,
            (select count(*)::int from signals where organization_id=$1 and external_id like '%ACoAAodile') s,
            (select source_signal_id from contacts where id=$2) orig`, [m.org, odile])).rows[0];
  check('49. écartée par le SCORING : la fiche importée survit, avec sa liste et son historique', r.discarded === 1 && o.c === 1 && o.lm === 1 && o.e === 1, `${JSON.stringify(r)} ${JSON.stringify(o)}`);
  check('49a. son signal est bien parti, et elle en est détachée', o.s === 0 && o.orig === null, JSON.stringify(o));

  // Le même cas par la purge des `new` : le scoring n'a jamais tourné (c'est arrivé
  // pour de vrai, scoring à 0 dans les trois organisations), 14 jours passent.
  const p = await monde();
  const liste2 = (await q(`insert into lists (organization_id, name, context_note, origin) values ($1,'Salon','Contacts du salon','import') returning id`, [p.org])).rows[0].id;
  const oscar = (await q(
    `insert into contacts (organization_id, first_name, email, linkedin_url, source_list_id, created_at)
     values ($1,'Odilon','odilon@acme.fr','https://www.linkedin.com/in/odilon-ancien',$2, now() - interval '60 days') returning id`,
    [p.org, liste2],
  )).rows[0].id;
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1,$2,$3,'replied')`, [p.org, p.campagne, oscar]);
  await enregistrer(p, { ...eng('odilon', 'Odilon Ancien', 'Plombier'), urlProfil: 'https://www.linkedin.com/in/odilon-ancien' });
  await q(`update signals set occurred_at = now() - interval '30 days' where organization_id=$1`, [p.org]);
  await ecarterSignauxTropAnciens(pool, 14);
  const d = (await q(
    `select (select count(*)::int from contacts where id=$2) c,
            (select count(*)::int from enrollments where contact_id=$2) e,
            (select count(*)::int from signals where organization_id=$1) s,
            (select source_signal_id from contacts where id=$2) orig`, [p.org, oscar])).rows[0];
  check('50. écartée par la PURGE des `new` : la fiche importée survit, son historique aussi', d.c === 1 && d.e === 1, JSON.stringify(d));
  check('50a. son signal est parti, et elle en est détachée', d.s === 0 && d.orig === null, JSON.stringify(d));

  // Contrepartie : une personne réellement née de l'engageur part toujours.
  const n = await monde();
  await enregistrer(n, engPublic('nee', 'Nina Nee', 'Plombière'));
  const rn = await runScore({ pool, organizationId: n.org, scorer });
  const nn = (await q(`select (select count(*)::int from contacts where organization_id=$1) c, (select count(*)::int from signals where organization_id=$1) s`, [n.org])).rows[0];
  check('51. une fiche réellement née de l’engageur est bien effacée (la garde ne bloque pas le cas normal)', rn.discarded === 1 && nn.c === 0 && nn.s === 0, JSON.stringify(nn));
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
  await enregistrer(u, engPublic('y', 'Yves Blanc', 'Directeur commercial'));
  check('28. la consigne vient du persona de la campagne', (await compterSignauxScorables(pool, u.org)) === 1);
  const ru = await runScore({ pool, organizationId: u.org, scorer });
  check('29. et le signal est qualifié', ru.qualified === 1, JSON.stringify(ru));
}

async function scoringAdresseDeduite() {
  console.log('une adresse déduite de l’URN n’est pas scorée : elle ne sera jamais enrichie (revue finale, 2.2)');
  const m = await monde();
  await enregistrer(m, eng('dedu', 'Dédé Duval', 'Directeur commercial'));
  await enregistrer(m, engPublic('pub', 'Paula Public', 'Directrice commerciale'));
  const n = await compterSignauxScorables(pool, m.org);
  const jugés = [];
  const r = await runScore({ pool, organizationId: m.org, scorer: async (ps) => { jugés.push(...ps.map((p) => p.title)); return ps.map((p) => ({ id: p.id, score: 85, reason: 'ok' })); } });
  check('67. le compteur de crédit et la sélection isolent le MÊME ensemble : une seule personne', n === 1 && r.considered === 1, `n=${n} considered=${r.considered}`);
  check('68. seule la personne à nom public est envoyée au modèle', jugés.length === 1 && /Directrice/.test(jugés[0]), JSON.stringify(jugés));
  const statut = (await q(`select status from signals where organization_id = $1 and external_id like '%dedu'`, [m.org])).rows[0]?.status;
  check('69. le signal de l’adresse déduite reste `new`, sans mémoire d’écart', statut === 'new' && (await q(`select 1 from linkedin_engageurs_ecartes where organization_id = $1`, [m.org])).rowCount === 0, String(statut));
  // Plus tard, la réponse Voyager livre le nom public : le contact n'a plus d'adresse déduite, le signal devient scorable.
  await q(`update contacts set linkedin_url = 'https://www.linkedin.com/in/dede-duval' where organization_id = $1 and linkedin_provider_id = 'ACoAAdedu'`, [m.org]);
  check('70. une fois l’adresse publique connue, le même signal redevient scorable', (await compterSignauxScorables(pool, m.org)) === 1);
}

/**
 * Lot 4b, etape 2 : une campagne qui n'envoie QUE par LinkedIn score ses personnes a adresse
 * deduite.
 *
 * L'exclusion d'au-dessus vise l'EMAIL : une adresse deduite n'est ni cherchable ni
 * enrichissable. Mais pour ecrire un message LinkedIn, l'URN suffit. Sans cette reserve, la
 * source « posts d'un concurrent » ne produit JAMAIS rien — un post de page ne livre pas les
 * noms publics de ses reacteurs, donc TOUTES ses personnes sont exclues. Mesure le 09/10 : 37
 * collectees, 37 laissees en « new » pour toujours.
 */
async function scoringCampagneLinkedInSeule() {
  console.log('une campagne 100 % LinkedIn score les adresses deduites : l URN suffit a ecrire');
  const m = await monde();
  await enregistrer(m, eng('dedu2', 'Dede Duval', 'Directeur commercial'));

  // Sans sequence : la reserve ne s'applique pas, le comportement d'origine tient.
  check('71. sans sequence, une adresse deduite n est toujours pas scoree',
    (await compterSignauxScorables(pool, m.org)) === 0, String(await compterSignauxScorables(pool, m.org)));

  // Une sequence qui n'envoie que par LinkedIn : elle devient scorable.
  await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, 0, 'linkedin_message')`, [m.campagne]);
  check('72. avec une sequence 100 % LinkedIn, elle le devient',
    (await compterSignauxScorables(pool, m.org)) === 1, String(await compterSignauxScorables(pool, m.org)));

  // Une etape email quelque part dans la sequence, et l'exclusion revient : il faudra un email,
  // donc un enrichissement, donc une adresse cherchable.
  await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, 1, 'email')`, [m.campagne]);
  check('73. une seule etape email suffit a la rendre de nouveau inutile a scorer',
    (await compterSignauxScorables(pool, m.org)) === 0, String(await compterSignauxScorables(pool, m.org)));

  // Et la selection de runScore isole le MEME ensemble que le compteur : c'est la regle que la
  // revue du 10/09 avait posee, elle doit tenir sur ce chemin aussi.
  await q(`delete from sequence_steps where campaign_id = $1 and channel = 'email'`, [m.campagne]);
  const juges = [];
  const r = await runScore({
    pool,
    organizationId: m.org,
    scorer: async (ps) => {
      juges.push(...ps.map((p) => p.title));
      return ps.map((p) => ({ id: p.id, score: 85, reason: 'ok' }));
    },
  });
  check('74. le compteur et la selection isolent le meme ensemble', r.considered === 1 && juges.length === 1, `considered=${r.considered} juges=${juges.length}`);

  // Scorer ne suffit pas : il faut encore ENTRER dans la campagne. `enqueueEnrollments`
  // ecartait tout engageur sans email, sans regarder les canaux de la sequence -- une
  // campagne 100 % LinkedIn etait donc sterile pour toujours, puisque rien ne viendra
  // jamais remplir `ct.email` pour un engageur. Mesure le 09/10 sur la recette du lot 4b :
  // deux engageurs qualifies a 95 et 90, jamais inscrits, sans trace ni erreur.
  const jobs = [];
  const boss = { insert: async (lot) => { jobs.push(...lot); } };
  const inscrit = (id) => jobs.some((j) => j.name === 'sequence.enroll' && j.data.contactId === id && j.data.campaignId === m.campagne);
  const contactDede = (await q(`select id from contacts where organization_id=$1 and email is null`, [m.org])).rows[0].id;
  await enqueueEnrollments(boss, pool);
  check('74b. dans une campagne 100 % LinkedIn, un engageur sans email EST inscrit',
    inscrit(contactDede), JSON.stringify(jobs.map((j) => j.data.contactId)));

  // Symetrique, et preuve que la garde d'origine tient toujours : une seule etape email
  // dans la sequence, et un engageur sans email redevient retenu jusqu'a l'enrichissement.
  await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, 1, 'email')`, [m.campagne]);
  await enregistrer(m, eng('mina', 'Mina Mornet', 'Directrice commerciale'));
  await runScore({ pool, organizationId: m.org, scorer: async (ps) => ps.map((pr) => ({ id: pr.id, score: 85, reason: 'ok' })) });
  const contactMina = (await q(`select id from contacts where organization_id=$1 and first_name='Mina'`, [m.org])).rows[0].id;
  jobs.length = 0;
  await enqueueEnrollments(boss, pool);
  check('74c. une etape email dans la sequence, et l engageur sans email attend son adresse',
    !inscrit(contactMina), JSON.stringify(jobs.map((j) => j.data.contactId)));

  // Le troisieme etage de la meme regle -- ne pas ACHETER d'adresse a une campagne qui
  // n'en enverra jamais -- se verifie dans linkedin-enrichissement.sh (section 12), seul
  // harnais a monter le vrai pg-boss que le producteur d'achat interroge.
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
  const sigZoe = (await q(`select id from signals where organization_id=$1 and external_id like '%ACoAAzoe'`, [m.org])).rows[0]?.id;
  check('33. son signal d’origine est exactement celui de départ', sigZoe !== undefined && rows[0]?.source_signal_id === sigZoe, `${rows[0]?.source_signal_id} / ${sigZoe}`);
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

async function atomicite() {
  console.log('ecarterSignalDePersonne : une panne au milieu défait tout');
  const m = await monde();
  await enregistrerEngageur(m.ctx, eng('panne', 'Pia Panne', 'Directrice commerciale'), { id: m.campagne, personaId: m.persona }, POST);
  const sigId = (await q(`select id from signals where organization_id=$1`, [m.org])).rows[0].id;
  const compter = async () => (await q(
    `select (select count(*)::int from linkedin_engageurs_ecartes where organization_id=$1) memoire,
            (select count(*)::int from contacts where organization_id=$1) contacts,
            (select count(*)::int from signals where organization_id=$1) signaux`, [m.org])).rows[0];
  const avant = await compter();
  // La preuve n'a de sens que si le point de départ est exact : un contact, un signal, aucune mémoire.
  check('45a. point de départ : un contact, un signal, aucune mémoire', avant.memoire === 0 && avant.contacts === 1 && avant.signaux === 1, JSON.stringify(avant));

  // La panne vise UNIQUEMENT la suppression de ce signal (trigger restreint à son identifiant) :
  // la mémoire est posée et le contact effacé AVANT, la panne arrive donc au milieu.
  await q(`create or replace function public.t6_panne() returns trigger language plpgsql as $f$ begin raise exception 'panne provoquee t6'; end $f$`);
  // Idempotent : avec KEEP=1, une interruption entre ce `create` et le `finally`
  // laisserait le trigger en place, et le run suivant échouerait sur « already
  // exists » — l'exception sortirait d'ici et emporterait la section `rls()`.
  await q(`drop trigger if exists t6_panne on signals`);
  await q(`create trigger t6_panne before delete on signals for each row when (old.id = '${sigId}') execute function public.t6_panne()`);
  let e = null;
  try {
    e = await erreur(ecarterSignalDePersonne(pool, m.org, sigId));
  } finally {
    await q(`drop trigger if exists t6_panne on signals`);
    await q(`drop function if exists public.t6_panne()`);
  }
  const etat = await compter();
  check('45. l’erreur vient bien de la panne provoquée (pas d’une autre cause)', e !== null && String(e.message).includes('panne provoquee t6'), String(e?.message));
  check('45b. rollback complet : la mémoire est ABSENTE, le contact et le signal intacts', etat.memoire === 0 && etat.contacts === 1 && etat.signaux === 1, JSON.stringify(etat));
  await ecarterSignalDePersonne(pool, m.org, sigId);
  const fin = await compter();
  check('45c. panne retirée, le même appel aboutit (mémoire posée, contact et signal effacés)', fin.memoire === 1 && fin.contacts === 0 && fin.signaux === 0, JSON.stringify(fin));
}

/**
 * L'index unique des adresses LinkedIn est posé par CETTE tâche : l'import de
 * fichier, qui l'ignorait, tombait sur un 23505 dès qu'une personne du fichier
 * était déjà connue comme engageur. Ici, le vrai `importerCsv` est exécuté.
 */
async function importCsv() {
  console.log('import de fichier face à l’index des adresses LinkedIn');
  const m = await monde();
  const ctx = { ex: pool, organisationId: m.org, utilisateurId: m.admin, role: 'admin' };
  const importer = (lignes, nom = 'Liste') =>
    importerCsv(ctx, {
      campagneId: m.campagne,
      nom,
      fileName: 'liste.csv',
      parsed: { headers: ['Prenom', 'Nom', 'Email', 'LinkedIn'], rows: lignes },
      mapping: { Prenom: 'first_name', Nom: 'last_name', Email: 'email', LinkedIn: 'linkedin_url' },
    });

  // Une personne déjà collectée comme engageur, reprise dans un fichier.
  await enregistrer(m, { ...eng('csv', 'Carla Sieve', 'Directrice commerciale'), urlProfil: 'https://www.linkedin.com/in/carla-sieve' });
  const avant = (await q(`select id, source_signal_id, enriched_at from contacts where organization_id=$1 and first_name='Carla'`, [m.org])).rows[0];
  const r1 = await erreur(importer([{ Prenom: 'Carla', Nom: 'Sieve', Email: 'carla@acme.fr', LinkedIn: 'https://www.linkedin.com/in/carla-sieve' }]));
  check('46. import d’une personne déjà connue comme engageur : aboutit (plus de 23505)', r1 === null, String(r1));
  const ap = (await q(`select count(*)::int n, min(id::text) id, min(email) email, count(source_list_id)::int listes, count(enriched_at)::int enrichis, min(source_signal_id::text) sig from contacts where organization_id=$1 and first_name='Carla'`, [m.org])).rows[0];
  check('46a. une seule fiche, rattachée à la liste, email du fichier posé', ap.n === 1 && ap.id === avant.id && ap.listes === 1 && ap.email === 'carla@acme.fr', JSON.stringify(ap));
  check('46b. son origine est préservée, et l’email du fichier n’est PAS un email acheté (enriched_at nul)', ap.sig === avant.source_signal_id && ap.enrichis === 0, JSON.stringify(ap));
  const membre = (await q(`select count(*)::int n from list_members lm join contacts c on c.id = lm.contact_id where c.organization_id=$1 and c.first_name='Carla'`, [m.org])).rows[0].n;
  check('46c. le contact est bien membre de la liste importée', membre === 1, String(membre));

  // Même personne, autre graphie, et SANS email dans le fichier : seule la forme
  // canonique peut la retrouver. Avec un email, le conflit sur l'email suffirait et
  // le contrôle passerait pour une autre raison que celle qu'il annonce.
  await enregistrer(m, { ...eng('graphie', 'Gina Graphie', 'Directrice commerciale'), urlProfil: 'https://www.linkedin.com/in/gina-graphie' });
  await importer([{ Prenom: 'Gina', Nom: 'Graphie', Email: '', LinkedIn: 'https://fr.linkedin.com/in/gina-graphie/?trk=partage' }], 'Liste 2');
  const g = (await q(`select count(*)::int n, count(source_list_id)::int listes from contacts where organization_id=$1 and first_name='Gina'`, [m.org])).rows[0];
  check('46d. une autre graphie de la même adresse ne crée PAS de seconde fiche', g.n === 1 && g.listes === 1, JSON.stringify(g));

  // L'email du fichier appartient déjà à une autre fiche : on rattache sans fusionner.
  await enregistrer(m, { ...eng('pris', 'Paul Pris', 'Directeur commercial'), urlProfil: 'https://www.linkedin.com/in/paul-pris' });
  await q(`insert into contacts (organization_id, first_name, email) values ($1,'Autre','pris@acme.fr')`, [m.org]);
  const r2 = await erreur(importer([{ Prenom: 'Paul', Nom: 'Pris', Email: 'pris@acme.fr', LinkedIn: 'https://www.linkedin.com/in/paul-pris' }], 'Liste 3'));
  const pp = (await q(`select count(*)::int n, min(email) email, count(source_list_id)::int listes from contacts where organization_id=$1 and first_name='Paul'`, [m.org])).rows[0];
  check('46e. email déjà porté par une autre fiche : l’import aboutit, rattache, et ne fusionne pas', r2 === null && pp.n === 1 && pp.email === null && pp.listes === 1, `${r2} ${JSON.stringify(pp)}`);

  // La COURSE, pour de vrai : une transaction concurrente insère la fiche entre la
  // recherche de l'import et son insertion. L'import doit la rattraper, pas tomber.
  const urlCourse = 'https://www.linkedin.com/in/rosa-course';
  const concurrent = await pool.connect();
  let r3;
  try {
    await concurrent.query('begin');
    await concurrent.query(`insert into contacts (organization_id, first_name, linkedin_url) values ($1,'Rosa',$2)`, [m.org, urlCourse]);
    // L'import ne voit rien (transaction non validée), puis son insertion attend le verrou.
    const promesse = erreur(importer([{ Prenom: 'Rosa', Nom: 'Course', Email: 'rosa@acme.fr', LinkedIn: urlCourse }], 'Liste 4'));
    await new Promise((r) => setTimeout(r, 400));
    await concurrent.query('commit');
    r3 = await promesse;
  } finally {
    await concurrent.query('rollback').catch(() => {});
    concurrent.release();
  }
  const rr = (await q(`select count(*)::int n, count(source_list_id)::int listes from contacts where organization_id=$1 and linkedin_url=$2`, [m.org, urlCourse])).rows[0];
  check('47. course : la fiche naît entre la recherche et l’insertion — l’import la rattrape, une seule fiche, rattachée', r3 === null && rr.n === 1 && rr.listes === 1, `${r3} ${JSON.stringify(rr)}`);

  // Une valeur qui n'est pas une adresse de profil ne doit JAMAIS devenir une
  // identité : sinon la première ligne crée un contact et toutes les suivantes se
  // rattachent dessus, en perdant leur nom et leur poste. Trois personnes, trois
  // fiches — et la ligne d'origine reste dans list_members.raw_row.
  const rNon = await erreur(importer([
    { Prenom: 'Una', Nom: 'Uno', Email: 'una@acme.fr', LinkedIn: '-' },
    { Prenom: 'Duna', Nom: 'Dos', Email: 'duna@acme.fr', LinkedIn: '-' },
    { Prenom: 'Tina', Nom: 'Tres', Email: 'tina@acme.fr', LinkedIn: 'N/A' },
  ], 'Liste 6'));
  const nonUrl = (await q(`select count(*)::int n, count(distinct first_name)::int d, count(linkedin_url)::int avec from contacts where organization_id=$1 and first_name in ('Una','Duna','Tina')`, [m.org])).rows[0];
  const brut = (await q(`select count(*)::int n from list_members lm join contacts c on c.id = lm.contact_id where c.organization_id=$1 and c.first_name='Una' and lm.raw_row->>'LinkedIn' = '-'`, [m.org])).rows[0].n;
  check('53. une valeur non-URL en colonne LinkedIn : autant de contacts que de personnes, aucune identité usurpée', rNon === null && nonUrl.n === 3 && nonUrl.d === 3 && nonUrl.avec === 0, `${rNon} ${JSON.stringify(nonUrl)}`);
  check('53a. la valeur d’origine du fichier n’est pas perdue (list_members.raw_row)', brut === 1, String(brut));

  // Adresse SANS schéma : `new URL` la refuse, le pipeline l'accepte pourtant
  // comme clé de dédup. Sans préfixe, la personne repart en brut et se double.
  await enregistrer(m, { ...eng('sch', 'Sacha Schema', 'Directeur commercial'), urlProfil: 'https://www.linkedin.com/in/sacha-schema' });
  await importer([{ Prenom: 'Sacha', Nom: 'Schema', Email: '', LinkedIn: 'linkedin.com/in/sacha-schema' }], 'Liste 7');
  const sch = (await q(`select count(*)::int n, count(source_list_id)::int listes from contacts where organization_id=$1 and first_name='Sacha'`, [m.org])).rows[0];
  check('53b. adresse sans schéma dans le fichier : la personne est retrouvée, pas doublée', sch.n === 1 && sch.listes === 1, JSON.stringify(sch));

  // Casse du slug : une adresse PUBLIQUE est insensible à la casse.
  await enregistrer(m, { ...eng('cas', 'Clea Casse', 'Directrice commerciale'), urlProfil: 'https://www.linkedin.com/in/clea-casse' });
  await importer([{ Prenom: 'Clea', Nom: 'Casse', Email: '', LinkedIn: 'https://www.linkedin.com/in/Clea-Casse' }], 'Liste 8');
  const cas = (await q(`select count(*)::int n, count(source_list_id)::int listes from contacts where organization_id=$1 and first_name='Clea'`, [m.org])).rows[0];
  check('53c. même slug écrit avec des majuscules : une seule fiche', cas.n === 1 && cas.listes === 1, JSON.stringify(cas));

  // Non-régression : une personne inconnue est bien créée.
  const r4 = await erreur(importer([{ Prenom: 'Neuf', Nom: 'Venu', Email: 'neuf@acme.fr', LinkedIn: 'https://www.linkedin.com/in/neuf-venu' }], 'Liste 5'));
  const nv = (await q(`select count(*)::int n, min(linkedin_url) u from contacts where organization_id=$1 and first_name='Neuf'`, [m.org])).rows[0];
  check('48. une personne inconnue du fichier est créée, avec son adresse sous forme canonique', r4 === null && nv.n === 1 && nv.u === 'https://www.linkedin.com/in/neuf-venu', `${r4} ${JSON.stringify(nv)}`);
}

/**
 * La migration de normalisation de l'existant, lue dans son fichier et rejouée :
 * c'est le SQL livré qui est exécuté, pas une copie. Le conteneur l'a déjà
 * appliquée sur une base vide — ici elle a de quoi travailler.
 */
async function migrationAdresses() {
  console.log('migration : les adresses déjà en base passent à la forme canonique');
  const chemin = new URL('../../supabase/migrations/20261005130320_linkedin_url_canonique.sql', import.meta.url);
  const sql = await readFile(chemin, 'utf8');
  const m = await monde();
  const ct = (nom, url) => q(`insert into contacts (organization_id, first_name, linkedin_url) values ($1,$2,$3)`, [m.org, nom, url]);
  await ct('Sans', 'https://linkedin.com/in/sans-www');
  await ct('Barre', 'https://www.linkedin.com/in/barre-finale/');
  await ct('Pays', 'https://fr.linkedin.com/in/sous-domaine?trk=x');
  await ct('Societe', 'https://www.linkedin.com/company/acme');
  await ct('Casse', 'https://www.linkedin.com/in/Majuscule-Slug');
  // Adresse FABRIQUÉE à partir d'un URN : son slug EST le linkedin_provider_id,
  // et sa casse est signifiante. La migration doit la laisser intacte.
  await q(`insert into contacts (organization_id, first_name, linkedin_url, linkedin_provider_id) values ($1,'Urne','https://www.linkedin.com/in/ACoAAUrNe','ACoAAUrNe')`, [m.org]);
  // Deux fiches qui CONVERGENT : sans précaution, la migration tomberait sur
  // l'index unique. Une organisation voisine porte le même cas, pour vérifier
  // que la normalisation ne déborde pas d'une organisation à l'autre.
  await ct('Jumelle1', 'https://linkedin.com/in/jumelle');
  await ct('Jumelle2', 'https://www.linkedin.com/in/jumelle/');
  const voisine = await monde();
  await q(`insert into contacts (organization_id, first_name, linkedin_url) values ($1,'Ailleurs','https://linkedin.com/in/jumelle')`, [voisine.org]);

  const e = await erreur(q(sql));
  check('52. la migration s’applique sans tomber, malgré deux fiches qui convergent', e === null, String(e?.message));
  const lu = async (nom) => (await q(`select linkedin_url u from contacts where organization_id=$1 and first_name=$2`, [m.org, nom])).rows[0]?.u;
  check('52a. l’adresse sans « www. » est ramenée à la forme canonique', (await lu('Sans')) === 'https://www.linkedin.com/in/sans-www', await lu('Sans'));
  check('52b. la barre finale est retirée', (await lu('Barre')) === 'https://www.linkedin.com/in/barre-finale', await lu('Barre'));
  check('52c. sous-domaine de pays et paramètre de partage : forme canonique', (await lu('Pays')) === 'https://www.linkedin.com/in/sous-domaine', await lu('Pays'));
  check('52d. ce qui n’est pas un profil n’est pas touché', (await lu('Societe')) === 'https://www.linkedin.com/company/acme', await lu('Societe'));
  check('52g. un slug public à majuscules passe en minuscules', (await lu('Casse')) === 'https://www.linkedin.com/in/majuscule-slug', await lu('Casse'));
  check('52h. une adresse déduite d’un URN garde sa casse (identifiant interne)', (await lu('Urne')) === 'https://www.linkedin.com/in/ACoAAUrNe', await lu('Urne'));
  const j = (await q(`select count(*)::int n, count(distinct linkedin_url)::int d, count(*) filter (where linkedin_url = 'https://www.linkedin.com/in/jumelle')::int canon from contacts where organization_id=$1 and first_name like 'Jumelle%'`, [m.org])).rows[0];
  check('52e. deux fiches qui convergent : une seule prend l’adresse canonique, l’autre garde la sienne', j.n === 2 && j.d === 2 && j.canon === 1, JSON.stringify(j));
  check('52f. l’organisation voisine est normalisée elle aussi (la collision ne déborde pas)', (await (async () => (await q(`select linkedin_url u from contacts where organization_id=$1 and first_name='Ailleurs'`, [voisine.org])).rows[0]?.u)()) === 'https://www.linkedin.com/in/jumelle');
}

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
/**
 * L'index unique des signaux de personne couvre-t-il EXACTEMENT la famille ?
 *
 * Un `on conflict (cols) where <prédicat>` n'infère un index partiel que si le prédicat
 * correspond. Un kind ajouté à `KINDS_PERSONNE` sans que l'index suive fait échouer l'insertion
 * sur « no unique or exclusion constraint matching », AU PREMIER enregistrement réel et nulle
 * part avant : ni le typage, ni les tests unitaires, ni la CI ne le voient. Le piège s'est posé
 * deux fois dans la même journée (people_search, puis job_change).
 */
/**
 * La garde du « sans intitulé connu » est-elle dans la FONCTION, et pas seulement chez son
 * appelant ?
 *
 * Elle décide d'un réveil, donc d'un envoi. Posée chez l'appelant, elle ne protège que celui-là :
 * le prochain collecteur qui voudrait réveiller des contacts écrirait à tout un fichier importé
 * sans titre, parce que « null » n'est pas un ancien poste. L'asymétrie décide — réveiller à tort
 * écrit à quelqu'un sans raison, ne pas réveiller fait seulement rater une occasion.
 */
async function gardeDuChangementDePoste() {
  console.log('la garde du changement de poste vit dans la fonction qui cree le signal');
  const m = await monde({ avecPrompt: false });
  const compte = (await q(`insert into accounts (organization_id, name) values ($1,'Acme') returning id`, [m.org])).rows[0].id;
  const creerContact = async (titre) => (await q(
    `insert into contacts (organization_id, account_id, persona_id, first_name, last_name, job_title, linkedin_url)
     values ($1,$2,$3,'Ada','Lemercier',$4,$5) returning id`,
    [m.org, compte, m.persona, titre, `https://www.linkedin.com/in/ada-${Date.now()}${Math.random().toString(36).slice(2, 8)}`],
  )).rows[0].id;
  const signaux = async (c) => (await q(
    `select count(*)::int n from signals s join contacts ct on ct.source_signal_id = s.id where ct.id = $1 and s.kind = 'job_change'`, [c],
  )).rows[0].n;

  // 1. Sans intitulé connu : AUCUN signal, et le lu devient la référence.
  const sansTitre = await creerContact(null);
  const issue1 = await enregistrerChangementDePoste(
    m.ctx, { contactId: sansTitre, ancienIntitule: null, nouvelIntitule: 'Directrice commerciale', urlProfil: 'https://www.linkedin.com/in/ada/' }, { personaId: m.persona });
  const fiche1 = (await q(`select job_title, linkedin_verifie_le from contacts where id = $1`, [sansTitre])).rows[0];
  check('91. sans intitule connu, la fonction ne cree aucun signal', issue1 === 'inchange' && (await signaux(sansTitre)) === 0, String(issue1));
  check('91b. mais elle pose l intitule lu comme reference, et marque la verification',
    fiche1.job_title === 'Directrice commerciale' && fiche1.linkedin_verifie_le !== null, JSON.stringify(fiche1));

  // 2. Un vrai changement, lui, cree bien le signal et fait pointer la fiche dessus.
  const avecTitre = await creerContact('Directrice regionale');
  const issue2 = await enregistrerChangementDePoste(
    m.ctx, { contactId: avecTitre, ancienIntitule: 'Directrice regionale', nouvelIntitule: 'Directrice generale', urlProfil: 'https://www.linkedin.com/in/ada2/' }, { personaId: m.persona });
  const fiche2 = (await q(`select job_title from contacts where id = $1`, [avecTitre])).rows[0];
  check('92. un vrai changement cree le signal et la fiche pointe dessus',
    issue2 === 'change' && (await signaux(avecTitre)) === 1 && fiche2.job_title === 'Directrice generale', String(issue2));

  // 3. Le meme changement, revu au passage suivant, ne cree pas un second signal.
  const issue3 = await enregistrerChangementDePoste(
    m.ctx, { contactId: avecTitre, ancienIntitule: 'Directrice generale', nouvelIntitule: 'Directrice generale', urlProfil: 'https://www.linkedin.com/in/ada2/' }, { personaId: m.persona });
  check('93. le meme intitule revu ne cree pas un second signal', issue3 === 'inchange' && (await signaux(avecTitre)) === 1, String(issue3));
}

async function uniciteDesPersonnes() {
  console.log('l index unique des signaux de personne suit la famille');
  const idx = (await q(
    `select indexdef from pg_indexes where tablename = 'signals' and indexdef like '%organization_id, external_id%' and indexdef like 'CREATE UNIQUE%'`,
  )).rows.map((r) => r.indexdef);
  check('90. il existe un index unique partiel sur (organisation, external_id)', idx.length === 1, JSON.stringify(idx));

  const def = idx[0] ?? '';
  for (const kind of KINDS_PERSONNE) {
    check(`90.${kind} — l index le couvre`, def.includes(`'${kind}'`), def);
  }
  // Et rien de plus : un kind d entreprise dans cet index ferait dedoublonner des signaux qui
  // n ont pas la meme cle.
  const cites = [...def.matchAll(/'([a-z_]+)'::signal_kind/g)].map((m) => m[1]).sort();
  check('90b. et rien d autre que la famille', JSON.stringify(cites) === JSON.stringify([...KINDS_PERSONNE].sort()),
    `index=${JSON.stringify(cites)} famille=${JSON.stringify([...KINDS_PERSONNE].sort())}`);

  // La preuve par l usage : le `on conflict` du code infere bien cet index, pour CHAQUE kind.
  for (const kind of KINDS_PERSONNE) {
    const m = await monde({ avecPrompt: false });
    const ext = `preuve-${kind}`;
    const insere = async () => q(
      `insert into signals (organization_id, source_id, provider_id, external_id, kind, occurred_at, title, url, status)
       values ($1, $2, 'linkedin', $3, $4::signal_kind, now(), 't', 'u', 'new')
       on conflict (organization_id, external_id) where ${sqlPredicatUniciteDePersonne()} do nothing
       returning id`,
      [m.org, m.source, ext, kind],
    );
    const premier = await insere();
    const second = await insere();
    check(`90c.${kind} — le on conflict infere l index et dedoublonne`,
      premier.rows.length === 1 && second.rows.length === 0,
      `premier=${premier.rows.length} second=${second.rows.length}`);
  }
}

  await jouer(index, rattachement, chaine, purgeEtRegression, gardeDeLEffacement, sansConsigne, scoringAdresseDeduite, scoringCampagneLinkedInSeule, entreprise, enrichissement, importCsv, migrationAdresses, atomicite, rls, uniciteDesPersonnes, gardeDuChangementDePoste);
} catch (e) {
  console.error('ERREUR', e);
  failures += 1;
} finally {
  await pool.end();
}
console.log(failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
