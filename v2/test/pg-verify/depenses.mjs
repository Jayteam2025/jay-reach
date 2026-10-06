// T1 (lot 2) : exécution RÉELLE, sur Postgres, du SQL de production qui décide
// de ce qui coûte de l'argent. Aucune requête n'est recopiée ici : on appelle
// `insertSignals`, `enqueueEnrollments`, `enrollContact`, `chargerContraintesSender`,
// `quotaSenderRestant` et `tickDueEnrollments` tels qu'ils tournent en production.
//
// Chaque bloc donne pour chaque assertion la mutation du SQL (ou du code) qui la
// fait rougir ; la liste complète, avec l'effet constaté, est dans le message de
// commit et le rapport de T1.
import pg from 'pg';
import {
  insertSignals,
  enqueueEnrollments,
  enrollContact,
  compterEntreesDuJour,
  chargerContraintesSender,
  quotaSenderRestant,
  tickDueEnrollments,
} from './_depenses-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${etiquette}${label}${extra ? ` — ${extra}` : ''}`);
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
const JOUR_MS = 24 * 3600 * 1000;
const HEURE_MS = 3600 * 1000;
let seq = 0;
let idSeq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function orgNeuve(fuseau) {
  const id = (
    await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${uniq()}`, `org-${uniq()}`])
  ).rows[0].id;
  if (fuseau) {
    await q(`insert into organization_settings (organization_id, key, value) values ($1, 'fuseau', $2::jsonb)`, [
      id,
      JSON.stringify(fuseau),
    ]);
  }
  return id;
}
async function sourceNeuve(org) {
  return (
    await q(`insert into sources (organization_id, name, provider_id) values ($1, $2, 'adzuna') returning id`, [
      org,
      `Source ${uniq()}`,
    ])
  ).rows[0].id;
}

// ---------------------------------------------------------------------------
// (a) Dédoublonnage des signaux
// ---------------------------------------------------------------------------
const AGE_MAX_LARGE = 365; // le filtre d'âge JS n'est pas ce qu'on teste ici
const NOW = new Date();
const offre = (url, { company = 'Acme', title = 'Technicien', location = 'Lyon', ilYa = 1 * JOUR_MS } = {}) => ({
  signal_type: 'job_posting',
  source: 'adzuna',
  source_url: url,
  raw_content: '{}',
  extracted_data: {
    company_name: company,
    job_title: title,
    location,
    posted_date: ilYa === null ? null : new Date(Date.now() - ilYa).toISOString(),
  },
});
const inserer = (org, source, signaux) => insertSignals(pool, org, source, 'adzuna', signaux, AGE_MAX_LARGE, NOW);
const compter = async (org) =>
  (await q(`select count(*)::int n from signals where organization_id = $1`, [org])).rows[0].n;

async function dedoublonnage() {
  console.log('\n[a] Dédoublonnage des signaux (insertSignals, SQL réel)');
  const orgA = await orgNeuve();
  const orgB = await orgNeuve();
  const src1 = await sourceNeuve(orgA);
  const src2 = await sourceNeuve(orgA);
  const srcB = await sourceNeuve(orgB);

  // 1. Premier passage : tout ce qui est nouveau est inséré.
  let r = await inserer(orgA, src1, [offre('https://ex.fr/1')]);
  check('1. une offre nouvelle est insérée', r.inserted.length === 1, `${r.inserted.length}`);

  // 2. Le MÊME signal proposé une seconde fois (même URL, même source) : rien.
  //    Tient par `on conflict (source_id, external_id)` ET par le `not exists`.
  r = await inserer(orgA, src1, [offre('https://ex.fr/1')]);
  check('2. même URL proposée deux fois : rien de réinséré', r.inserted.length === 0 && (await compter(orgA)) === 1);

  // 3. Même offre republiée sous une AUTRE URL (même source) : seule l'empreinte
  //    la reconnaît -> c'est le `not exists` qui protège (et le seul).
  r = await inserer(orgA, src1, [offre('https://ex.fr/1-republiee')]);
  check('3. même empreinte, autre URL, même source : écartée par le not exists', r.inserted.length === 0 && (await compter(orgA)) === 1);

  // 4. Même empreinte mais AUTRE SOURCE de la même organisation : écartée aussi
  //    (le dédoublonnage est par organisation, pas par source).
  r = await inserer(orgA, src2, [offre('https://autre-job-board.fr/9')]);
  check('4. même empreinte, autre source (même organisation) : écartée', r.inserted.length === 0 && (await compter(orgA)) === 1);

  // 5. Même empreinte dans une AUTRE ORGANISATION : insérée (jamais de fuite
  //    d'une organisation à l'autre).
  r = await inserer(orgB, srcB, [offre('https://ex.fr/1')]);
  check('5. même empreinte dans une autre organisation : insérée', r.inserted.length === 1 && (await compter(orgB)) === 1);

  // 6. Empreinte différente (autre intitulé, autre lieu, autre entreprise) : insérée.
  r = await inserer(orgA, src1, [
    offre('https://ex.fr/t', { title: 'Commercial' }),
    offre('https://ex.fr/l', { location: 'Marseille' }),
    offre('https://ex.fr/c', { company: 'Globex' }),
  ]);
  check('6. empreintes différentes (intitulé / lieu / entreprise) : toutes insérées', r.inserted.length === 3, `${r.inserted.length}`);

  // 7. Fenêtre de 30 jours. Un signal identique daté de 30 j + 1 h ne protège plus ;
  //    daté de 30 j - 1 h il protège encore. Les deux côtés de la borne, pour que
  //    ni 29 ni 31 jours ne passent inaperçus.
  const orgF = await orgNeuve();
  const srcF = await sourceNeuve(orgF);
  const posePasse = async (company, ilYa) => {
    // Ancien signal posé par le chemin réel d'insertion, avec sa date de parution.
    const res = await inserer(orgF, srcF, [offre(`https://ex.fr/ancien-${company}`, { company, ilYa })]);
    return res.inserted.length;
  };
  check('7a. ancien signal (30 j + 1 h) posé', (await posePasse('Vieux', 30 * JOUR_MS + HEURE_MS)) === 1);
  check('7b. ancien signal (30 j - 1 h) posé', (await posePasse('Recent', 30 * JOUR_MS - HEURE_MS)) === 1);
  r = await inserer(orgF, srcF, [
    offre('https://ex.fr/neuf-vieux', { company: 'Vieux' }),
    offre('https://ex.fr/neuf-recent', { company: 'Recent' }),
  ]);
  const urls = (await q(`select url from signals where organization_id = $1 and url like '%/neuf-%'`, [orgF])).rows.map((x) => x.url);
  check('7c. identique à plus de 30 jours : réinséré (la fenêtre est passée)', urls.includes('https://ex.fr/neuf-vieux'));
  check('7d. identique à moins de 30 jours : écarté', !urls.includes('https://ex.fr/neuf-recent'));

  // 8. Sans lieu, pas d'empreinte : deux URL différentes = deux insertions
  //    (décision documentée dans db.ts : un doublon se voit, une offre perdue non),
  //    mais la MÊME URL deux fois reste écartée par `on conflict`.
  const orgN = await orgNeuve();
  const srcN = await sourceNeuve(orgN);
  r = await inserer(orgN, srcN, [offre('https://ex.fr/n1', { location: '' }), offre('https://ex.fr/n2', { location: '' })]);
  check('8a. sans lieu : deux URL différentes, deux insertions (pas d’empreinte)', r.inserted.length === 2);
  r = await inserer(orgN, srcN, [offre('https://ex.fr/n1', { location: '' })]);
  check('8b. sans lieu : même URL rejouée, écartée par on conflict', r.inserted.length === 0 && (await compter(orgN)) === 2);

  // 9. `on conflict` seul : même (source, URL) mais l'intitulé a changé donc
  //    l'empreinte aussi -> le `not exists` laisse passer, seul le conflit protège.
  const orgC = await orgNeuve();
  const srcC = await sourceNeuve(orgC);
  await inserer(orgC, srcC, [offre('https://ex.fr/c1', { title: 'Plombier' })]);
  r = await inserer(orgC, srcC, [offre('https://ex.fr/c1', { title: 'Plombier chauffagiste' })]);
  check('9. même (source, URL), empreinte changée : écartée par on conflict', r.inserted.length === 0 && (await compter(orgC)) === 1);
  //    Même URL dans une AUTRE source : la contrainte porte sur (source, URL).
  const srcC2 = await sourceNeuve(orgC);
  r = await inserer(orgC, srcC2, [offre('https://ex.fr/c1', { title: 'Soudeur' })]);
  check('9b. même URL, autre source, empreinte différente : insérée', r.inserted.length === 1);

  // 10. Mélange dans un seul lot : ne passe que ce qui doit passer.
  const orgM = await orgNeuve();
  const srcM = await sourceNeuve(orgM);
  await inserer(orgM, srcM, [offre('https://ex.fr/m0', { company: 'Deja' })]);
  r = await inserer(orgM, srcM, [
    offre('https://ex.fr/m1', { company: 'Deja' }), // doublon d'empreinte
    offre('https://ex.fr/m2', { company: 'Neuf' }), // nouveau
    offre('https://ex.fr/m0', { company: 'Deja' }), // doublon d'URL
  ]);
  check('10. lot mixte : un seul des trois insérés', r.inserted.length === 1 && (await compter(orgM)) === 2, `${r.inserted.length}`);
}

// ---------------------------------------------------------------------------
// (b1) Plafond d'entrées en campagne
// ---------------------------------------------------------------------------
function fauxBoss() {
  const jobs = [];
  return { boss: { insert: async (l) => void jobs.push(...l) }, jobs };
}
// Les journaux `[enroll] ... reportes au lendemain` : seul signe observable du
// pré-filtre SQL (voir 'pré-filtre' plus bas).
async function avecJournal(fn) {
  const lignes = [];
  const orig = console.log;
  console.log = (...a) => {
    const s = a.join(' ');
    if (s.startsWith('[enroll]')) lignes.push(s);
    else orig(...a);
  };
  try {
    return { valeur: await fn(), lignes };
  } finally {
    console.log = orig;
  }
}

async function debutDeJourOrg(fuseau) {
  return new Date(
    (await q(`select date_trunc('day', now() at time zone $1) at time zone $1 as d`, [fuseau])).rows[0].d,
  );
}

/** Une campagne active, sa source, une persona acceptée et `n` contacts éligibles (ids croissants). */
async function campagneEtContacts(org, source, { dailyCap, n, prefixeId }) {
  const persona = (await q(`insert into personas (organization_id, name) values ($1, $2) returning id`, [org, `P ${uniq()}`])).rows[0].id;
  const camp = (
    await q(
      `insert into campaigns (organization_id, name, status, source_id, daily_cap, entry_rules)
       values ($1, $2, 'active', $3, $4, $5::jsonb) returning id`,
      [org, `C ${uniq()}`, source, dailyCap, JSON.stringify({ personas: [persona] })],
    )
  ).rows[0].id;
  const contacts = [];
  for (let i = 0; i < n; i += 1) {
    const sig = (
      await q(
        `insert into signals (organization_id, source_id, external_id, kind, occurred_at, status)
         values ($1, $2, $3, 'job_posting', now(), 'new') returning id`,
        [org, source, `sig-${uniq()}`],
      )
    ).rows[0].id;
    idSeq += 1;
    const id = `${prefixeId}0000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`;
    await q(
      `insert into contacts (id, organization_id, persona_id, email, source_signal_id) values ($1, $2, $3, $4, $5)`,
      [id, org, persona, `c-${uniq()}@example.test`, sig],
    );
    contacts.push(id);
  }
  return { camp, persona, contacts };
}

/** Pose `n` inscriptions « déjà entrées » dans la campagne, démarrées à `startedAt`, d'autres contacts. */
async function entreesDejaFaites(org, camp, n, startedAt) {
  for (let i = 0; i < n; i += 1) {
    const ct = (await q(`insert into contacts (organization_id, email) values ($1, $2) returning id`, [org, `h-${uniq()}@example.test`])).rows[0].id;
    await q(
      `insert into enrollments (organization_id, campaign_id, contact_id, status, started_at)
       values ($1, $2, $3, 'completed', $4)`,
      [org, camp, ct, startedAt.toISOString()],
    );
  }
}

async function plafondEntrees() {
  console.log('\n[b1] Plafond d’entrées en campagne (enqueueEnrollments + enrollContact, SQL réel)');
  const FUSEAU = 'Europe/Paris';

  // --- enqueueEnrollments : sous le plafond, AU plafond, AU-DESSUS ---
  const org = await orgNeuve(FUSEAU);
  const source = await sourceNeuve(org);
  const debut = await debutDeJourOrg(FUSEAU);
  const aujourdhui = new Date(debut.getTime() + 60_000); // 1 min après le début du jour de l'org
  const hier = new Date(debut.getTime() - 60_000); // 1 min avant : jour précédent

  // Sous le plafond : cap 3, 1 déjà entrée aujourd'hui, 5 candidats -> 2 places.
  const sous = await campagneEtContacts(org, source, { dailyCap: 3, n: 5, prefixeId: 'a' });
  await entreesDejaFaites(org, sous.camp, 1, aujourdhui);
  let { boss, jobs } = fauxBoss();
  let n = await enqueueEnrollments(boss, pool);
  const pourSous = jobs.filter((j) => j.data.campaignId === sous.camp);
  check('1. sous le plafond (cap 3, 1 faite) : 2 contacts enfilés, pas 5', n === 2 && pourSous.length === 2, `${n}`);

  // AU plafond : cap 3, 3 déjà entrées -> 0. (Même campagne, on complète à 3.)
  await entreesDejaFaites(org, sous.camp, 2, aujourdhui);
  ({ boss, jobs } = fauxBoss());
  n = await enqueueEnrollments(boss, pool);
  check('2. AU plafond (cap 3, 3 faites) : aucun contact enfilé', n === 0 && jobs.length === 0, `${n}`);

  // AU-DESSUS : cap 3, 5 déjà entrées (plafond baissé après coup par le boss) -> 0.
  await entreesDejaFaites(org, sous.camp, 2, aujourdhui);
  ({ boss, jobs } = fauxBoss());
  n = await enqueueEnrollments(boss, pool);
  check('3. AU-DESSUS du plafond (cap 3, 5 faites) : aucun contact enfilé', n === 0 && jobs.length === 0, `${n}`);

  // Les entrées d'HIER ne comptent pas : cap 2, 5 entrées hier, 4 candidats -> 2.
  const orgH = await orgNeuve(FUSEAU);
  const sourceH = await sourceNeuve(orgH);
  const hierCamp = await campagneEtContacts(orgH, sourceH, { dailyCap: 2, n: 4, prefixeId: 'b' });
  await entreesDejaFaites(orgH, hierCamp.camp, 5, hier);
  ({ boss, jobs } = fauxBoss());
  n = await enqueueEnrollments(boss, pool);
  check('4. les entrées de la veille ne comptent pas (cap 2 : 2 enfilés)', jobs.filter((j) => j.data.campaignId === hierCamp.camp).length === 2);

  // Plafond nul = pause voulue : zéro place ; plafond absent = sans limite.
  const orgZ = await orgNeuve(FUSEAU);
  const sourceZ = await sourceNeuve(orgZ);
  const zero = await campagneEtContacts(orgZ, sourceZ, { dailyCap: 0, n: 3, prefixeId: 'c' });
  const libre = await campagneEtContacts(orgZ, sourceZ, { dailyCap: null, n: 3, prefixeId: 'd' });
  ({ boss, jobs } = fauxBoss());
  await enqueueEnrollments(boss, pool);
  check('5a. plafond 0 (pause) : aucun contact enfilé', jobs.filter((j) => j.data.campaignId === zero.camp).length === 0);
  check('5b. plafond absent (null) : tous les contacts enfilés', jobs.filter((j) => j.data.campaignId === libre.camp).length === 3);

  // Pré-filtre SQL (`c.daily_cap > count`) : une campagne PLEINE ne doit pas
  // occuper le `limit` du producteur au détriment des autres. Les contacts de la
  // campagne pleine ont les ids les plus bas (order by ct.id) : sans pré-filtre,
  // ils remplissent le lot de 2 et la campagne libre ne reçoit rien.
  const orgP = await orgNeuve(FUSEAU);
  const sourceP = await sourceNeuve(orgP);
  const pleine = await campagneEtContacts(orgP, sourceP, { dailyCap: 1, n: 3, prefixeId: '1' });
  await entreesDejaFaites(orgP, pleine.camp, 1, aujourdhui);
  const autre = await campagneEtContacts(orgP, sourceP, { dailyCap: null, n: 2, prefixeId: '9' });
  ({ boss, jobs } = fauxBoss());
  const { lignes } = await avecJournal(() => enqueueEnrollments(boss, pool, { limit: 2 }));
  check('6a. pré-filtre : une campagne pleine ne prend pas le lot des autres (limit 2)', jobs.filter((j) => j.data.campaignId === autre.camp).length === 2, `${jobs.length} job(s)`);
  check('6b. pré-filtre : la campagne pleine n’est même pas candidate (rien « reporté »)', !lignes.some((l) => l.includes(pleine.camp)), lignes.join(' | '));

  // Jour de l'ORGANISATION, pas du serveur : mêmes entrées aux bornes, deux fuseaux
  // extrêmes. Au moins l'un des deux a un début de jour différent du jour UTC.
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    const o = await orgNeuve(tz);
    const s = await sourceNeuve(o);
    const d = await debutDeJourOrg(tz);
    const c = await campagneEtContacts(o, s, { dailyCap: 2, n: 4, prefixeId: 'e' });
    await entreesDejaFaites(o, c.camp, 3, new Date(d.getTime() - 60_000)); // veille locale : ignorées
    await entreesDejaFaites(o, c.camp, 1, new Date(d.getTime() + 60_000)); // aujourd'hui local : 1 place
    ({ boss, jobs } = fauxBoss());
    await enqueueEnrollments(boss, pool);
    check(`7. ${tz} : jour de l’organisation (cap 2, 1 faite aujourd’hui, 3 hier) -> 1 enfilé`, jobs.filter((j) => j.data.campaignId === c.camp).length === 1, `${jobs.filter((j) => j.data.campaignId === c.camp).length}`);
    const compte = await compterEntreesDuJour(pool, c.camp, o);
    check(`7b. ${tz} : compterEntreesDuJour = 1`, compte === 1, `${compte}`);
  }

  // Borne incluse : une entrée EXACTEMENT au début du jour de l'organisation compte.
  const orgBorne = await orgNeuve(FUSEAU);
  const sourceBorne = await sourceNeuve(orgBorne);
  const borne = await campagneEtContacts(orgBorne, sourceBorne, { dailyCap: 5, n: 1, prefixeId: '2' });
  await entreesDejaFaites(orgBorne, borne.camp, 1, debut);
  const compteBorne = await compterEntreesDuJour(pool, borne.camp, orgBorne);
  check('7c. une entrée exactement au début du jour compte (borne incluse)', compteBorne === 1, `${compteBorne}`);

  // --- enrollContact : le contrôle AUTORITAIRE, juste avant l'insertion ---
  const orgE = await orgNeuve(FUSEAU);
  const sourceE = await sourceNeuve(orgE);
  const e = await campagneEtContacts(orgE, sourceE, { dailyCap: 2, n: 5, prefixeId: 'f' });
  const inscrire = (i) => enrollContact(pool, { organizationId: orgE, campaignId: e.camp, contactId: e.contacts[i] });
  const e0 = await inscrire(0);
  const e1 = await inscrire(1);
  check('8a. enrollContact : sous le plafond (cap 2), les deux premiers entrent', typeof e0 === 'string' && typeof e1 === 'string');
  const e2 = await inscrire(2);
  check('8b. enrollContact : AU plafond (2/2), le troisième est refusé', e2 === null);
  await entreesDejaFaites(orgE, e.camp, 3, aujourdhui);
  const e3 = await inscrire(3);
  check('8c. enrollContact : AU-DESSUS (5/2), refusé aussi', e3 === null);
  const nbActives = (await q(`select count(*)::int n from enrollments where campaign_id = $1 and status = 'active'`, [e.camp])).rows[0].n;
  check('8d. aucune inscription active en trop (2)', nbActives === 2, `${nbActives}`);

  await q(`update campaigns set daily_cap = 0 where id = $1`, [e.camp]);
  check('8e. enrollContact : plafond 0 (pause), refusé', (await inscrire(4)) === null);
  await q(`update campaigns set daily_cap = null where id = $1`, [e.camp]);
  check('8f. enrollContact : plafond absent, accepté', typeof (await inscrire(4)) === 'string');
  await q(`update campaigns set daily_cap = 6 where id = $1`, [e.camp]);
  const jourNeuf = await enrollContact(pool, { organizationId: orgE, campaignId: e.camp, contactId: e.contacts[2] });
  check('8g. enrollContact : cap relevé à 6 (6 faites : 2 + 3 + 1), refusé juste à la borne', jourNeuf === null);
  await q(`update campaigns set daily_cap = 7 where id = $1`, [e.camp]);
  check('8h. enrollContact : cap 7 (6 faites), une place de plus, accepté', typeof (await enrollContact(pool, { organizationId: orgE, campaignId: e.camp, contactId: e.contacts[2] })) === 'string');
}

// ---------------------------------------------------------------------------
// (b2) Quota d'expéditeur : send-time (chargerContraintesSender) ET tick (loadSenders)
// ---------------------------------------------------------------------------
async function senderNeuf(org, { daily = null, hourly = null, tz = 'UTC', kind = 'email' } = {}) {
  return (
    await q(
      `insert into senders (organization_id, kind, identity, daily_quota, hourly_quota, timezone, is_active, business_hours)
       values ($1, $2, $3, $4, $5, $6, true, '{"startHour":0,"endHour":24,"days":[1,2,3,4,5,6,7]}'::jsonb) returning id`,
      [org, kind, `s-${uniq()}@example.test`, daily, hourly, tz],
    )
  ).rows[0].id;
}

/** Une action « historique » du sender, rattachée à une inscription terminée. */
async function actionDuSender(org, sender, { status, createdAt = null, dispatchedAt = null }) {
  const ct = (await q(`insert into contacts (organization_id, email) values ($1, $2) returning id`, [org, `a-${uniq()}@example.test`])).rows[0].id;
  const camp = (await q(`select id from campaigns where organization_id = $1 limit 1`, [org])).rows[0]?.id
    ?? (await q(`insert into campaigns (organization_id, name, status) values ($1, 'hist', 'archived') returning id`, [org])).rows[0].id;
  const enr = (
    await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1, $2, $3, 'completed') returning id`, [org, camp, ct])
  ).rows[0].id;
  await q(
    `insert into actions (organization_id, enrollment_id, channel, sender_id, status, dispatched_at, created_at, idempotency_key)
     values ($1, $2, 'email', $3, $4, $5, coalesce($6::timestamptz, now()), $7)`,
    [org, enr, sender, status, dispatchedAt, createdAt, `idem-${uniq()}`],
  );
}

// Trois fuseaux, pas un : le jour et l'heure se comptent dans l'heure murale de
// l'ORGANISATION. Kolkata (+5:30) a un début d'heure différent de l'UTC ;
// Kiritimati (+14) et Pago_Pago (-11) ont un début de jour et un numéro d'heure
// qui diffèrent de l'UTC quelle que soit l'heure d'exécution (un seul fuseau
// ferait passer une mutation « jour du serveur » pendant les heures où son jour
// coïncide avec l'UTC).
const FUSEAUX = ['Asia/Kolkata', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];

let etiquette = '';
async function quotaSender(TZ) {
  etiquette = `[${TZ}] `;
  console.log(`\n[b2] Quota d’expéditeur : chargerContraintesSender + quotaSenderRestant (SQL réel) — ${TZ}`);
  const org = await orgNeuve(TZ);
  const debutHeure = new Date((await q(`select date_trunc('hour', now() at time zone $1) at time zone $1 as d`, [TZ])).rows[0].d);
  const debutJour = await debutDeJourOrg(TZ);
  const cetteHeure = new Date(debutHeure.getTime() + 60_000);
  const heurePrecedente = new Date(debutHeure.getTime() - 60_000);
  const heurePrecedenteEstAujourdhui = heurePrecedente.getTime() >= debutJour.getTime();
  const veille = new Date(debutJour.getTime() - 60_000);
  const lire = async (s) => chargerContraintesSender(pool, s, org);

  // 1. Aucun envoi : le quota entier reste.
  let s = await senderNeuf(org, { daily: 5, hourly: 2 });
  let c = await lire(s);
  check('1. aucun envoi : usedToday 0, usedThisHour 0, reste min(5, 2) = 2', c.usedToday === 0 && c.usedThisHour === 0 && quotaSenderRestant(c) === 2, JSON.stringify(c));

  // 2. Quota horaire atteint : 2 envois cette heure, quota horaire 2 -> 0.
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: cetteHeure });
  await actionDuSender(org, s, { status: 'delivered', dispatchedAt: cetteHeure });
  c = await lire(s);
  check('2. AU quota horaire (2/2) : restant 0', quotaSenderRestant(c) === 0 && c.usedThisHour === 2, `usedThisHour=${c.usedThisHour} restant=${quotaSenderRestant(c)}`);

  // 3. Quota horaire dépassé (3 pour 2) : jamais négatif.
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: cetteHeure });
  c = await lire(s);
  check('3. AU-DESSUS du quota horaire (3/2) : restant 0, jamais négatif', quotaSenderRestant(c) === 0 && c.usedThisHour === 3);

  // 4. Quota journalier seul : 5 envois aujourd'hui, quota 5 -> 0, quota 6 -> 1.
  s = await senderNeuf(org, { daily: 5 });
  for (let i = 0; i < 5; i += 1) await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: cetteHeure });
  c = await lire(s);
  check('4a. AU quota journalier (5/5) : restant 0', c.usedToday === 5 && quotaSenderRestant(c) === 0);
  await q(`update senders set daily_quota = 6 where id = $1`, [s]);
  c = await lire(s);
  check('4b. quota journalier 6 pour 5 envoyés : restant 1', quotaSenderRestant(c) === 1);
  await q(`update senders set daily_quota = 4 where id = $1`, [s]);
  c = await lire(s);
  check('4c. AU-DESSUS du quota journalier (5/4) : restant 0', quotaSenderRestant(c) === 0);

  // 5. Aucun quota réglé : illimité.
  s = await senderNeuf(org, {});
  for (let i = 0; i < 3; i += 1) await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: cetteHeure });
  c = await lire(s);
  check('5. aucun quota réglé : illimité (Infinity)', quotaSenderRestant(c) === Infinity);

  // 6. Le plus contraignant des deux : jour 3 / heure 10, 1 envoi heure précédente
  //    + 1 cette heure. min(3-2, 10-1).
  s = await senderNeuf(org, { daily: 3, hourly: 10 });
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: cetteHeure });
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: heurePrecedente });
  c = await lire(s);
  const attenduJour = heurePrecedenteEstAujourdhui ? 3 - 2 : 3 - 1;
  check('6a. min des deux quotas : le journalier est le plus contraignant', quotaSenderRestant(c) === Math.min(attenduJour, 10 - 1), `restant=${quotaSenderRestant(c)} attendu=${Math.min(attenduJour, 9)}`);
  check('6b. un envoi de l’heure précédente ne compte pas dans l’heure courante', c.usedThisHour === 1, `${c.usedThisHour}`);

  // 7. Le comptage ne prend que les envois réellement partis.
  s = await senderNeuf(org, { daily: 2 });
  for (const status of ['scheduled', 'failed', 'blocked', 'pending_approval']) {
    await actionDuSender(org, s, { status, dispatchedAt: null });
  }
  c = await lire(s);
  check('7. scheduled / failed / blocked / pending_approval ne comptent pas', c.usedToday === 0 && quotaSenderRestant(c) === 2, `usedToday=${c.usedToday}`);

  // 8. Les envois de la veille (jour de l'organisation) ne comptent pas.
  s = await senderNeuf(org, { daily: 2 });
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: veille });
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: veille });
  c = await lire(s);
  check('8. envois de la veille ne comptent pas', c.usedToday === 0 && quotaSenderRestant(c) === 2, `usedToday=${c.usedToday}`);
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: new Date(debutJour.getTime() + 60_000) });
  c = await lire(s);
  check('8b. un envoi une minute après le début du jour de l’organisation compte', c.usedToday === 1, `usedToday=${c.usedToday}`);
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: debutJour });
  c = await lire(s);
  check('8c. un envoi exactement au début du jour compte (borne incluse)', c.usedToday === 2, `usedToday=${c.usedToday}`);

  // 9. Un autre expéditeur n'est pas compté.
  s = await senderNeuf(org, { daily: 2 });
  const autre = await senderNeuf(org, { daily: 2 });
  await actionDuSender(org, autre, { status: 'dispatched', dispatchedAt: cetteHeure });
  c = await lire(s);
  check('9. les envois d’un autre expéditeur ne comptent pas', c.usedToday === 0);
}

async function doubleDefinitionDuQuota() {
  console.log('\n[b2bis] Double définition du quota : le tick (loadSenders, created_at) contre l’envoi (dispatched_at)');
  // `tickDueEnrollments` appelle `loadSenders` ; on observe sa décision (defer =
  // pas d'action créée) et on la confronte à `chargerContraintesSender` pour les
  // MÊMES lignes d'actions. Jour de l'organisation : UTC, sender en UTC.
  const NOW_TICK = new Date('2026-10-07T12:00:00.000Z'); // mercredi midi UTC
  const org = await orgNeuve('UTC');
  const source = await sourceNeuve(org);
  const camp = (
    await q(`insert into campaigns (organization_id, name, status, source_id) values ($1, 'tick', 'active', $2) returning id`, [org, source])
  ).rows[0].id;
  await q(`insert into sequence_steps (campaign_id, position, channel, delay_hours) values ($1, 0, 'email', 0)`, [camp]);

  const debutJour = await debutDeJourOrg('UTC');
  const hier = new Date(debutJour.getTime() - HEURE_MS);

  const dueEnrollment = async () => {
    const ct = (await q(`insert into contacts (organization_id, email, email_status, first_name, last_name) values ($1, $2, 'valid', 'Jean', 'Test') returning id`, [org, `due-${uniq()}@example.test`])).rows[0].id;
    return (
      await q(
        `insert into enrollments (organization_id, campaign_id, contact_id, status, current_step, next_action_at)
         values ($1, $2, $3, 'active', 0, '2000-01-01') returning id`,
        [org, camp, ct],
      )
    ).rows[0].id;
  };
  const nbActions = async (enr) => (await q(`select count(*)::int n from actions where enrollment_id = $1`, [enr])).rows[0].n;
  const decisionDuTick = async () => {
    const enr = await dueEnrollment();
    await tickDueEnrollments(pool, NOW_TICK);
    return (await nbActions(enr)) > 0 ? 'passe' : 'defer';
  };
  const envoi = async (s) => quotaSenderRestant(await chargerContraintesSender(pool, s, org));

  // A. 2 actions `dispatched` aujourd'hui, quota 2 : les deux définitions s'accordent.
  let s = await senderNeuf(org, { daily: 2 });
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: new Date() });
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: new Date() });
  check('A1. quota journalier atteint par des envois partis : le tick reporte', (await decisionDuTick()) === 'defer');
  check('A2. ... et le contrôle d’envoi donne 0 : les deux définitions s’accordent', (await envoi(s)) === 0);
  await q(`update senders set is_active = false where id = $1`, [s]);

  // B. 2 actions `scheduled` créées aujourd'hui mais JAMAIS parties, quota 2 :
  //    le tick les compte (created_at, sans filtre de statut), pas l'envoi.
  s = await senderNeuf(org, { daily: 2 });
  await actionDuSender(org, s, { status: 'scheduled' });
  await actionDuSender(org, s, { status: 'scheduled' });
  const dB = await decisionDuTick();
  const eB = await envoi(s);
  check('B1. DIVERGENCE : 2 actions planifiées non parties : le tick reporte...', dB === 'defer', dB);
  check('B2. ... alors que le contrôle d’envoi voit encore 2 places', eB === 2, `${eB}`);
  await q(`update senders set is_active = false where id = $1`, [s]);

  // C. Une action `failed` d'aujourd'hui (jamais partie) consomme du quota au tick.
  s = await senderNeuf(org, { daily: 1 });
  await actionDuSender(org, s, { status: 'failed' });
  const dC = await decisionDuTick();
  check('C1. DIVERGENCE : un envoi en échec consomme le quota du tick...', dC === 'defer', dC);
  check('C2. ... pas celui du contrôle d’envoi (1 place)', (await envoi(s)) === 1);
  await q(`update senders set is_active = false where id = $1`, [s]);

  // D. Action créée HIER mais partie AUJOURD'HUI (approbation tardive), quota 1 :
  //    le tick (created_at) ne la voit pas, l'envoi (dispatched_at) la voit.
  s = await senderNeuf(org, { daily: 1 });
  await actionDuSender(org, s, { status: 'dispatched', createdAt: hier, dispatchedAt: new Date() });
  const dD = await decisionDuTick();
  check('D1. DIVERGENCE : créée hier, partie aujourd’hui : le tick laisse passer...', dD === 'passe', dD);
  check('D2. ... et le contrôle d’envoi, dernier verrou, voit le quota épuisé (0)', (await envoi(s)) === 0);
  await q(`update senders set is_active = false where id = $1`, [s]);

  // E. Quota horaire au tick : 1 action créée cette heure, quota horaire 1.
  s = await senderNeuf(org, { hourly: 1 });
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: new Date() });
  check('E. quota horaire atteint : le tick reporte', (await decisionDuTick()) === 'defer');
  await q(`update senders set is_active = false where id = $1`, [s]);

  // F. Sous le quota : le tick laisse passer (le contrôle n'est pas un no-op inverse).
  s = await senderNeuf(org, { daily: 3 });
  await actionDuSender(org, s, { status: 'dispatched', dispatchedAt: new Date() });
  check('F1. sous le quota (1/3) : le tick laisse passer', (await decisionDuTick()) === 'passe');
  check('F2. ... et le contrôle d’envoi donne 2', (await envoi(s)) === 2);
  await q(`update senders set is_active = false where id = $1`, [s]);

  // G. CONSTAT (non corrigé, hors périmètre de T1) : le tick charge les compteurs
  //    UNE fois pour tout le lot, sans les incrémenter. Trois inscriptions dues,
  //    quota 1, zéro envoi -> les trois passent. Seul le contrôle d'envoi retient
  //    ensuite les deux de trop.
  s = await senderNeuf(org, { daily: 1 });
  const dues = [await dueEnrollment(), await dueEnrollment(), await dueEnrollment()];
  await tickDueEnrollments(pool, NOW_TICK);
  let passees = 0;
  for (const enr of dues) passees += (await nbActions(enr)) > 0 ? 1 : 0;
  console.log(`  CONSTAT  tick : quota 1, 3 inscriptions dues dans un même passage -> ${passees} action(s) créée(s) (compteur non incrémenté dans le passage ; le contrôle d'envoi retient le surplus)`);
  await q(`update senders set is_active = false where id = $1`, [s]);
}

async function tickEtFuseau(tz) {
  etiquette = `[${tz}] `;
  console.log(`\n[b2ter] Le tick compte le jour et l’heure de l’organisation — ${tz}`);
  const NOW_TICK = new Date('2026-10-07T12:00:00.000Z');
  const org = await orgNeuve(tz);
  const source = await sourceNeuve(org);
  const camp = (
    await q(`insert into campaigns (organization_id, name, status, source_id) values ($1, 'tick-tz', 'active', $2) returning id`, [org, source])
  ).rows[0].id;
  await q(`insert into sequence_steps (campaign_id, position, channel, delay_hours) values ($1, 0, 'email', 0)`, [camp]);
  const debutJour = await debutDeJourOrg(tz);
  const debutHeure = new Date((await q(`select date_trunc('hour', now() at time zone $1) at time zone $1 as d`, [tz])).rows[0].d);
  const decision = async () => {
    const ct = (await q(`insert into contacts (organization_id, email, email_status, first_name, last_name) values ($1, $2, 'valid', 'Jean', 'Test') returning id`, [org, `tz-${uniq()}@example.test`])).rows[0].id;
    const enr = (await q(`insert into enrollments (organization_id, campaign_id, contact_id, status, current_step, next_action_at) values ($1, $2, $3, 'active', 0, '2000-01-01') returning id`, [org, camp, ct])).rows[0].id;
    await tickDueEnrollments(pool, NOW_TICK);
    return (await q(`select count(*)::int n from actions where enrollment_id = $1`, [enr])).rows[0].n > 0 ? 'passe' : 'defer';
  };
  const avec = async (opts, action) => {
    const s = await senderNeuf(org, opts);
    await actionDuSender(org, s, action);
    const d = await decision();
    await q(`update senders set is_active = false where id = $1`, [s]);
    return d;
  };
  const sansTimer = (ms) => new Date(ms);
  // Jour : une action créée une minute AVANT le début du jour de l'organisation
  // n'est pas d'aujourd'hui (quota 1 -> passe) ; une minute APRÈS, si (-> reporte).
  check('1. action de la veille (org) : ne consomme pas le quota du jour', (await avec({ daily: 1 }, { status: 'scheduled', createdAt: sansTimer(debutJour.getTime() - 60_000) })) === 'passe');
  check('2. action d’une minute après le début du jour (org) : consomme le quota', (await avec({ daily: 1 }, { status: 'scheduled', createdAt: sansTimer(debutJour.getTime() + 60_000) })) === 'defer');
  // Heure : créée dans l'heure précédente (quota horaire 1 -> passe), dans l'heure courante (-> reporte).
  check('3. action de l’heure précédente : ne consomme pas le quota horaire', (await avec({ hourly: 1 }, { status: 'scheduled', createdAt: sansTimer(debutHeure.getTime() - 60_000) })) === 'passe');
  check('4. action de l’heure courante : consomme le quota horaire', (await avec({ hourly: 1 }, { status: 'scheduled', createdAt: sansTimer(debutHeure.getTime() + 60_000) })) === 'defer');
}

try {
  // Base de test jetable (ou conservée par KEEP=1) : on repart de zéro, car
  // `enqueueEnrollments` balaie TOUTES les organisations d'un coup.
  await q('truncate organizations cascade');
  for (const tz of FUSEAUX) await quotaSender(tz);
  etiquette = '';
  for (const tz of FUSEAUX) await tickEtFuseau(tz);
  etiquette = '';
  await jouer(dedoublonnage, plafondEntrees, doubleDefinitionDuQuota);
} finally {
  await pool.end();
}
if (failures > 0) {
  console.log(`\n=== DEPENSES FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('\n=== DEPENSES OK ===');
