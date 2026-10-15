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
import pg from 'pg';
import {
  clePost,
  enregistrerEngageur,
  enregistrerFichePost,
  marquerPostTraite,
  rattacherSignalAuPost,
  creerSource,
  startSourceRun,
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

async function main() {
  await jouer(ficheCreeeDeuxFois, deuxSourcesMemePost, rattachementDuSignal, sujetOperateurSurvit);
  console.log(`\n[accroche-post] ${failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[accroche-post] ERREUR', e);
  process.exit(2);
});
