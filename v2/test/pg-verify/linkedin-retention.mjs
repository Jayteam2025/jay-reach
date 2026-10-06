// Lot 4a, tâche 11 : exécution RÉELLE, sur Postgres et avec de vraies dates, de la
// rétention des personnes collectées sur LinkedIn. Aucune requête de production
// n'est recopiée ici : seules les fixtures sont en SQL. Les âges sont posés avec
// `now() - make_interval(...)` : la base mesure elle-même ce qu'elle compare.
//
// Mutations qui font rougir (observées, voir le rapport de la tâche 11) :
//   1. core : RETENTION_PERSONNES_NON_CONTACTEES_JOURS 90 -> 60 (1, 3, 4) ou -> 120 (1, 2, 4, 9, 18, 19) ;
//   2. retention-purge.ts : retirer `occurred_at <` de la sélection — 3 et 4 ;
//   3. post-engagement.ts : neutraliser la garde `contacte` de ecarterEngageur — 15 et 15c. La purge
//      reste SÛRE (la sélection exclut déjà les contactés) : c'est la défense en profondeur ;
//   4. retention-purge.ts : retirer les trois `not exists` de la sélection — 7, 8, 11b (le bilan compte des
//      `conserves` : la fonction qui détruit a refusé, les données restent intactes) ;
//   3b. post-engagement.ts : retirer `c.created_at >= occurred` de l'expression « contactée » — 19b (une fiche importée
//       contactée retiendrait indéfiniment son signal) ;
//   4b. les deux ensemble — 10, 11, 12, 13, 15, 15c : les personnes contactées sont détruites ;
//   5. post-engagement.ts : ne plus consulter `suppressions` — 20 à 23 ; sans `lower()` — 22, 23 ; sans le
//      filtre d'expiration — 24 ; sans le filtre d'organisation — 24b ;
//   6. mention-origine.ts : retirer le test du kind — 28, 29 ; de l'étape — 27 ; de l'organisation — 30.
import pg from 'pg';
import {
  RETENTION_PERSONNES_NON_CONTACTEES_JOURS,
  ecarterEngageur,
  enregistrerEngageur,
  mentionOrigineDuMessage,
  purgerEngageursPerimes,
} from './_linkedin-retention-bundle.mjs';

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

let seq = 0;
const POST = 'https://www.linkedin.com/posts/x_y-1';
const eng = (id, nom = `Nom ${id}`, intitule = 'Directrice commerciale') => ({ urn: `urn:li:fsd_profile:ACoAA${id}`, nom, intitule });

/** Une organisation avec persona, source, campagne de deux étapes (positions 0 et 1) et passage. */
async function monde() {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const org = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
  const persona = (await q(`insert into personas (organization_id, name) values ($1, 'Directeur commercial') returning id`, [org])).rows[0].id;
  const source = (await q(
    `insert into sources (organization_id, provider_id, name, config) values ($1, 'linkedin_post_engagers', 'Engageurs', $2::jsonb) returning id`,
    [org, JSON.stringify({ sourceType: 'linkedin_post_engagers', urlPost: POST, garder: ['commente'], personaId: persona })],
  )).rows[0].id;
  const campagne = (await q(
    `insert into campaigns (organization_id, name, status, entry_rules) values ($1, 'C', 'active', $2::jsonb) returning id`,
    [org, JSON.stringify({ personas: [persona] })],
  )).rows[0].id;
  const pos0 = (await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, 0, 'email') returning id`, [campagne])).rows[0].id;
  const pos1 = (await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, 1, 'email') returning id`, [campagne])).rows[0].id;
  const run = (await q(`insert into source_runs (source_id) values ($1) returning id`, [source])).rows[0].id;
  return { org, persona, source, campagne, pos0, pos1, run, ctx: { pool, organizationId: org, sourceId: source, sourceRunId: run } };
}

/** Collecte réelle d'un engageur ; rend l'issue, l'id du signal et celui du contact. */
async function collecter(m, e) {
  const issue = await enregistrerEngageur(m.ctx, e, { id: m.campagne, personaId: m.persona }, POST);
  const signal = (await q(`select id from signals where organization_id = $1 and kind = 'post_engagement' and external_id like $2`, [m.org, `%${e.urn}`])).rows[0]?.id ?? null;
  const contact = signal ? (await q(`select id from contacts where organization_id = $1 and source_signal_id = $2`, [m.org, signal])).rows[0]?.id ?? null : null;
  return { issue, signal, contact };
}

/** Pose l'âge du signal avec l'horloge de la base : `jours` jours et `minutes` minutes avant maintenant. */
const vieillir = (signal, jours, minutes = 0) =>
  q(`update signals set occurred_at = now() - make_interval(days => $2, mins => $3) where id = $1`, [signal, jours, minutes]);

const existe = async (table, id) => (await q(`select 1 from ${table} where id = $1`, [id])).rowCount === 1;
const memoire = async (m) => (await q(`select count(*)::int n from linkedin_engageurs_ecartes where organization_id = $1`, [m.org])).rows[0].n;

async function purgeParAge() {
  console.log('la purge efface à 90 jours ce qui n’a jamais été contacté');
  const m = await monde();
  check('1. la durée de la purge est la constante de l’écran Réglages (90)', RETENTION_PERSONNES_NON_CONTACTEES_JOURS === 90);

  const vieux = await collecter(m, eng('vieux'));
  const recent = await collecter(m, eng('recent'));
  const juste_apres = await collecter(m, eng('apres')); // 90 j + 1 min : dépassé
  const juste_avant = await collecter(m, eng('avant')); // 90 j - 1 min : pas encore
  const note = await collecter(m, eng('note')); // jugé par le scoring puis oublié
  await vieillir(vieux.signal, 91);
  await vieillir(recent.signal, 89);
  await vieillir(juste_apres.signal, 90, 1);
  await vieillir(juste_avant.signal, 89, 24 * 60 - 1);
  await vieillir(note.signal, 120);
  await q(`update signals set score = 85, status = 'qualified', scored_at = now() where id = $1`, [note.signal]);

  const bilan = await purgerEngageursPerimes(pool);
  check('2. 91 jours, jamais contacté : le signal ET le contact sont effacés', !(await existe('signals', vieux.signal)) && !(await existe('contacts', vieux.contact)));
  check('2b. 91 jours, jamais jugé : aucune mémoire d’écart (la personne peut revenir)',
    (await q(`select 1 from linkedin_engageurs_ecartes where organization_id = $1 and external_id like '%ACoAAvieux'`, [m.org])).rowCount === 0);
  check('3. 89 jours : rien n’est effacé', (await existe('signals', recent.signal)) && (await existe('contacts', recent.contact)));
  check('4. 90 jours et 1 minute : effacé ; 90 jours moins 1 minute : conservé',
    !(await existe('signals', juste_apres.signal)) && (await existe('signals', juste_avant.signal)) && (await existe('contacts', juste_avant.contact)));
  check('5. une personne déjà jugée garde sa mémoire d’écart (sinon le collecteur la recréerait et la repaierait)',
    !(await existe('signals', note.signal)) &&
      (await q(`select 1 from linkedin_engageurs_ecartes where organization_id = $1 and external_id like '%ACoAAnote'`, [m.org])).rowCount === 1);
  check('6. le compteur d’écarts du passage collecteur ne bouge pas (passage clos depuis longtemps)',
    (await q(`select ecartes from source_runs where id = $1`, [m.run])).rows[0].ecartes === 0);
  check('7. le bilan ne compte aucun refus de la fonction qui détruit', bilan.conserves === 0, JSON.stringify(bilan));

  const second = await purgerEngageursPerimes(pool);
  check('8. second passage : rien à faire (la garantie vient des données, pas d’un identifiant de job)', second.candidats === 0 && second.effaces === 0, JSON.stringify(second));
  const recoll = await collecter(m, eng('vieux'));
  check('9. une personne purgée sans jugement peut être recollectée : nouvelle ligne, horloge repartie', recoll.issue === 'nouveau');
  const recollNote = await collecter(m, eng('note'));
  check('9b. une personne jugée puis purgée n’est pas recréée', recollNote.issue === 'ecarte', recollNote.issue);
}

async function jamaisLesContactes() {
  console.log('une personne contactée n’est JAMAIS effacée');
  const m = await monde();
  const autre = await monde();

  // 1. Inscription du contact né du signal, séquence terminée.
  const a = await collecter(m, eng('inscrit'));
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1,$2,$3,'completed')`, [m.org, m.campagne, a.contact]);
  // 2. Inscription portée par le signal seul (enrollments.signal_id), sur un autre contact.
  const b = await collecter(m, eng('parsignal'));
  const tiers = (await q(`insert into contacts (organization_id, first_name) values ($1,'Tiers') returning id`, [m.org])).rows[0].id;
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, signal_id, status) values ($1,$2,$3,$4,'replied')`, [m.org, m.campagne, tiers, b.signal]);
  // 3. Fil de messages sans inscription.
  const c = await collecter(m, eng('fil'));
  await q(`insert into threads (organization_id, contact_id, channel) values ($1,$2,'email')`, [m.org, c.contact]);
  // 4. Autre organisation : une personne contactée ET une qui ne l'est pas.
  const d = await collecter(autre, eng('autreinscrit'));
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1,$2,$3,'active')`, [autre.org, autre.campagne, d.contact]);
  const e = await collecter(autre, eng('autrelibre'));
  for (const s of [a, b, c, d, e]) await vieillir(s.signal, 200);

  const bilan = await purgerEngageursPerimes(pool);
  check('10. contact inscrit (séquence terminée) : signal et contact conservés', (await existe('signals', a.signal)) && (await existe('contacts', a.contact)));
  check('11. inscription portée par le signal seul : signal conservé', await existe('signals', b.signal));
  check('11b. la sélection exclut ces personnes : la fonction qui détruit n’a rien eu à refuser', bilan.conserves === 0, JSON.stringify(bilan));
  check('12. fil de messages sans inscription : signal et contact conservés', (await existe('signals', c.signal)) && (await existe('contacts', c.contact)));
  check('13. autre organisation : sa personne contactée est conservée', (await existe('signals', d.signal)) && (await existe('contacts', d.contact)));
  check('14. autre organisation : sa personne non contactée, du même âge, est effacée', !(await existe('signals', e.signal)) && !(await existe('contacts', e.contact)));

  // La garde vit dans la fonction qui détruit : appelée DIRECTEMENT, sans passer par la sélection.
  const avant = await memoire(m);
  const issue = await ecarterEngageur(pool, m.org, a.signal, { juge: false });
  check('15. ecarterEngageur appelée directement sur une personne contactée : refuse (conserve) et ne détruit rien',
    issue === 'conserve' && (await existe('signals', a.signal)) && (await existe('contacts', a.contact)), issue);
  check('15b. elle n’écrit aucune mémoire quand elle n’a rien jugé', (await memoire(m)) === avant);
  const issueJugee = await ecarterEngageur(pool, m.org, c.signal, { juge: true, compter: false });
  check('15c. jugée et contactée : conservée aussi, la mémoire d’écart est posée',
    issueJugee === 'conserve' && (await existe('signals', c.signal)) && (await memoire(m)) === avant + 1, issueJugee);
  const etat = (await q(`select status, discard_reason from signals where id = $1`, [a.signal])).rows[0];
  check('16. un signal contacté encore « new » est marqué écarté : le scoring ne le reprend plus', etat.status === 'discarded' && etat.discard_reason === 'contacted', JSON.stringify(etat));
  const qualifie = await collecter(m, eng('qualifie'));
  await q(`update signals set status = 'qualified', score = 90 where id = $1`, [qualifie.signal]);
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1,$2,$3,'active')`, [m.org, m.campagne, qualifie.contact]);
  await ecarterEngageur(pool, m.org, qualifie.signal, { juge: false });
  check('16b. un signal qualifié contacté garde son statut', (await q(`select status from signals where id = $1`, [qualifie.signal])).rows[0].status === 'qualified');

  // Isolation : la bonne personne mais la mauvaise organisation ne détruit rien.
  const libre = await collecter(m, eng('libre'));
  await ecarterEngageur(pool, autre.org, libre.signal, { juge: false });
  check('16c. une organisation ne peut pas effacer le signal (ni le contact) d’une autre', (await existe('signals', libre.signal)) && (await existe('contacts', libre.contact)));
}

async function contactPreexistant() {
  console.log('une fiche antérieure à l’engageur survit à la purge, détachée');
  const m = await monde();
  const connu = (await q(
    `insert into contacts (organization_id, first_name, email, linkedin_provider_id, created_at)
     values ($1,'Odile','odile@acme.fr','ACoAAodile', now() - interval '400 days') returning id`,
    [m.org],
  )).rows[0].id;
  const r = await collecter(m, eng('odile', 'Odile Roche'));
  check('17. la fiche existante est rattachée à l’engageur', r.issue === 'nouveau' && r.contact === connu, JSON.stringify(r));
  await vieillir(r.signal, 100);
  await purgerEngageursPerimes(pool);
  const apres = (await q(`select email, source_signal_id from contacts where id = $1`, [connu])).rows[0];
  check('18. le signal est effacé, la fiche (et son email) est conservée', !(await existe('signals', r.signal)) && apres?.email === 'odile@acme.fr', JSON.stringify(apres));
  check('19. elle est détachée du signal effacé', apres?.source_signal_id === null);

  // Même cas, mais la fiche importée a déjà été CONTACTÉE (séquence terminée) : elle ne naît pas de
  // l'engageur, donc le signal part comme avant, et la fiche garde son historique.
  const importee = (await q(
    `insert into contacts (organization_id, first_name, email, linkedin_provider_id, created_at)
     values ($1,'Odilon','odilon@acme.fr','ACoAAodilon', now() - interval '400 days') returning id`,
    [m.org],
  )).rows[0].id;
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1,$2,$3,'completed')`, [m.org, m.campagne, importee]);
  const r2 = await collecter(m, eng('odilon', 'Odilon Roche'));
  await vieillir(r2.signal, 100);
  await purgerEngageursPerimes(pool);
  const apres2 = (await q(`select source_signal_id, (select count(*)::int from enrollments where contact_id = $1) e from contacts where id = $1`, [importee])).rows[0];
  check('19b. fiche importée DÉJÀ contactée : le signal est effacé, la fiche et son historique restent, détachée',
    !(await existe('signals', r2.signal)) && apres2?.e === 1 && apres2?.source_signal_id === null, JSON.stringify(apres2));
}

async function suppression() {
  console.log('la liste de suppression est consultée dès la collecte');
  const m = await monde();
  const autre = await monde();
  const sup = (org, scope, value, expires = null) =>
    q(`insert into suppressions (organization_id, scope, value, origin, expires_at) values ($1,$2::suppression_scope,$3,'manual',$4)`, [org, scope, value, expires]);
  const total = async () => (await q(`select (select count(*) from signals where organization_id = $1)::int s, (select count(*) from contacts where organization_id = $1)::int c`, [m.org])).rows[0];

  await sup(m.org, 'linkedin', 'https://www.linkedin.com/in/alice-martin-1');
  const alice = await enregistrerEngageur(m.ctx, { ...eng('alice', 'Alice Martin'), urlProfil: 'https://www.linkedin.com/in/alice-martin-1' }, { id: m.campagne, personaId: m.persona }, POST);
  check('20. adresse supprimée : refusée dès la collecte', alice === 'supprime', alice);
  const t = await total();
  check('21. rien n’est écrit : ni signal, ni contact (rien à scorer, rien à enrichir)', t.s === 0 && t.c === 0, JSON.stringify(t));

  await sup(m.org, 'linkedin', 'HTTPS://WWW.LINKEDIN.COM/in/Bob-Durand-2');
  const bob = await enregistrerEngageur(m.ctx, { ...eng('bob', 'Bob Durand'), urlProfil: 'https://www.linkedin.com/in/bob-durand-2' }, { id: m.campagne, personaId: m.persona }, POST);
  check('22. la casse de la valeur ne compte pas', bob === 'supprime', bob);

  await sup(m.org, 'linkedin', 'https://www.linkedin.com/in/ACoAAclara');
  const clara = await enregistrerEngageur(m.ctx, eng('clara', 'Clara Petit'), { id: m.campagne, personaId: m.persona }, POST);
  check('23. suppression posée sur l’adresse déduite de l’URN : refusée aussi', clara === 'supprime', clara);

  await sup(m.org, 'linkedin', 'https://www.linkedin.com/in/dora-expiree-3', new Date(Date.now() - 86_400_000).toISOString());
  const dora = await enregistrerEngageur(m.ctx, { ...eng('dora', 'Dora Expiree'), urlProfil: 'https://www.linkedin.com/in/dora-expiree-3' }, { id: m.campagne, personaId: m.persona }, POST);
  check('24. suppression expirée : la personne est collectée', dora === 'nouveau', dora);

  await sup(autre.org, 'linkedin', 'https://www.linkedin.com/in/eric-voisin-4');
  const eric = await enregistrerEngageur(m.ctx, { ...eng('eric', 'Eric Voisin'), urlProfil: 'https://www.linkedin.com/in/eric-voisin-4' }, { id: m.campagne, personaId: m.persona }, POST);
  check('24b. suppression d’une autre organisation : sans effet', eric === 'nouveau', eric);

  await sup(m.org, 'email', 'https://www.linkedin.com/in/fanny-lopez-5');
  const fanny = await enregistrerEngageur(m.ctx, { ...eng('fanny', 'Fanny Lopez'), urlProfil: 'https://www.linkedin.com/in/fanny-lopez-5' }, { id: m.campagne, personaId: m.persona }, POST);
  check('24c. une suppression d’un autre périmètre (email) ne bloque pas une adresse LinkedIn', fanny === 'nouveau', fanny);
}

async function mention() {
  console.log('la mention d’origine, choisie en base');
  const m = await monde();
  const r = await collecter(m, eng('gaelle', 'Gaëlle Moreau'));
  const insc = (await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1,$2,$3,'active') returning id`, [m.org, m.campagne, r.contact])).rows[0].id;
  const demande = (stepId, locale, org = m.org) => ({ organizationId: org, enrollmentId: insc, stepId, locale });

  const fr = await mentionOrigineDuMessage(pool, demande(m.pos0, 'fr'));
  check('25. contact né d’un engageur, étape 0, fr : la mention d’origine', typeof fr === 'string' && fr.includes('LinkedIn') && fr.includes('répondez'), String(fr).slice(0, 60));
  const en = await mentionOrigineDuMessage(pool, demande(m.pos0, 'en'));
  const nl = await mentionOrigineDuMessage(pool, demande(m.pos0, 'nl'));
  check('26. la mention sort dans la langue du contact (en, nl), le français pour une langue inconnue ou absente',
    en?.startsWith('You are receiving') === true && nl?.startsWith('U ontvangt') === true &&
      (await mentionOrigineDuMessage(pool, demande(m.pos0, 'de'))) === fr && (await mentionOrigineDuMessage(pool, demande(m.pos0, null))) === fr);
  check('27. étape 1 (une relance) : pas de mention', (await mentionOrigineDuMessage(pool, demande(m.pos1, 'fr'))) === null);

  const sigEnt = (await q(`insert into signals (organization_id, source_id, provider_id, external_id, kind, occurred_at) values ($1,$2,'adzuna','adz:1','job_posting',now()) returning id`, [m.org, m.source])).rows[0].id;
  const ent = (await q(`insert into contacts (organization_id, first_name, email, source_signal_id) values ($1,'Hugo','hugo@acme.fr',$2) returning id`, [m.org, sigEnt])).rows[0].id;
  const inscEnt = (await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1,$2,$3,'active') returning id`, [m.org, m.campagne, ent])).rows[0].id;
  check('28. contact né d’un signal d’entreprise, étape 0 : pas de mention',
    (await mentionOrigineDuMessage(pool, { organizationId: m.org, enrollmentId: inscEnt, stepId: m.pos0, locale: 'fr' })) === null);
  const sansOrigine = (await q(`insert into contacts (organization_id, first_name, email) values ($1,'Ines','ines@acme.fr') returning id`, [m.org])).rows[0].id;
  const inscSans = (await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1,$2,$3,'active') returning id`, [m.org, m.campagne, sansOrigine])).rows[0].id;
  check('29. contact sans signal d’origine (import) : pas de mention',
    (await mentionOrigineDuMessage(pool, { organizationId: m.org, enrollmentId: inscSans, stepId: m.pos0, locale: 'fr' })) === null);
  const autre = await monde();
  check('30. l’inscription d’une autre organisation ne donne rien',
    (await mentionOrigineDuMessage(pool, demande(m.pos0, 'fr', autre.org))) === null);
}

try {
  await jouer(purgeParAge, jamaisLesContactes, contactPreexistant, suppression, mention);
} catch (e) {
  console.error('ERREUR', e);
  failures += 1;
} finally {
  await pool.end();
}
console.log(failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
