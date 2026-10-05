// Lot 4a, tâche 4 : exécution RÉELLE, sur Postgres, du SQL des plafonds
// LinkedIn. Aucune requête de production n'est recopiée ici : seules les
// fixtures (organisations, sources, passages, horodatages) sont écrites en SQL.
//
// Mutation qui fait rougir (voir le rapport de la tâche 4) :
//   borne : remplacer `$2::date::timestamp at time zone $3` par
//           `$2::date at time zone $3` dans compterPostsLinkedInDuJour.
import pg from 'pg';
import {
  compterPostsLinkedInDuJour,
  compterRequetesLinkedIn,
  lireFenetreLinkedIn,
  lirePlafondLinkedIn,
  tracerRequeteLinkedIn,
} from './_linkedin-plafonds-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
let seq = 0;
async function userNeuf() {
  return (await q(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [`u${Date.now()}${(seq += 1)}@test.local`]))
    .rows[0].id;
}
async function orgNeuve() {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const id = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`]))
    .rows[0].id;
  const admin = await userNeuf();
  const viewer = await userNeuf();
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'viewer')`, [id, admin, viewer]);
  return { id, admin, viewer };
}
const ctxDe = (o, ex = pool) => ({ ex, organisationId: o.id ?? o, utilisateurId: null, role: null });

async function sourceNeuve(orgId, type) {
  return (await q(
    `insert into sources (organization_id, name, config) values ($1, $2, $3::jsonb) returning id`,
    [orgId, `src-${type}`, JSON.stringify({ sourceType: type })],
  )).rows[0].id;
}
async function passage(sourceId, demarreA) {
  return (await q(`insert into source_runs (source_id, started_at) values ($1, $2::timestamptz) returning id`, [sourceId, demarreA])).rows[0].id;
}

/** Deux fuseaux, mêmes données : ce qui est « le 5 » à Paris est encore « le 4 » à New York. */
async function postsDuJour() {
  console.log('postsDuJour');
  const A = await orgNeuve();
  const B = await orgNeuve();
  const post = await sourceNeuve(A.id, 'linkedin_post_engagers');
  const autre = await sourceNeuve(A.id, 'linkedin_keywords');
  const postB = await sourceNeuve(B.id, 'linkedin_post_engagers');
  // Paris (UTC+2) / New York (UTC-4), 4 et 5 octobre 2026.
  await passage(post, '2026-10-04T21:55:00Z'); // 23:55 Paris le 4  | 17:55 NY le 4
  await passage(post, '2026-10-04T22:30:00Z'); // 00:30 Paris le 5  | 18:30 NY le 4
  await passage(post, '2026-10-05T03:30:00Z'); // 05:30 Paris le 5  | 23:30 NY le 4
  await passage(post, '2026-10-05T04:30:00Z'); // 06:30 Paris le 5  | 00:30 NY le 5
  await passage(autre, '2026-10-04T22:30:00Z'); // autre type : jamais compté
  await passage(postB, '2026-10-04T22:30:00Z'); // autre organisation : jamais comptée

  const n = (ctx, jour, fuseau) => compterPostsLinkedInDuJour(ctx, jour, fuseau);
  check('1. Paris le 4 : un passage (23:55)', (await n(ctxDe(A), '2026-10-04', 'Europe/Paris')) === 1);
  check('2. Paris le 5 : trois passages', (await n(ctxDe(A), '2026-10-05', 'Europe/Paris')) === 3);
  check('3. New York le 4 : trois passages', (await n(ctxDe(A), '2026-10-04', 'America/New_York')) === 3);
  check('4. New York le 5 : un passage', (await n(ctxDe(A), '2026-10-05', 'America/New_York')) === 1);
  check('5. UTC le 4 : deux passages (autre réponse, preuve que le fuseau compte)', (await n(ctxDe(A), '2026-10-04', 'UTC')) === 2);
  check('6. autre organisation isolée', (await n(ctxDe(B), '2026-10-04', 'Europe/Paris')) === 0
    && (await n(ctxDe(B), '2026-10-05', 'Europe/Paris')) === 1);

  // Le fuseau de la SESSION ne doit rien changer : c'est tout l'objet de la forme `::date::timestamp`.
  const c = await pool.connect();
  try {
    await c.query(`set timezone = 'Pacific/Auckland'`);
    check('7. session en Pacific/Auckland : Paris le 5 reste à trois', (await n(ctxDe(A, c), '2026-10-05', 'Europe/Paris')) === 3);
    check('8. session en Pacific/Auckland : New York le 4 reste à trois', (await n(ctxDe(A, c), '2026-10-04', 'America/New_York')) === 3);
    check('9. session en Pacific/Auckland : Paris le 4 reste à un', (await n(ctxDe(A, c), '2026-10-04', 'Europe/Paris')) === 1);
  } finally {
    await c.query('reset timezone');
    c.release();
  }
}

/** Une collecte ouverte à 23 h 55 dont une requête part à 00 h 05 : une requête de chaque côté de minuit. */
async function requetes() {
  console.log('requetes');
  const A = await orgNeuve();
  const B = await orgNeuve();
  const src = await sourceNeuve(A.id, 'linkedin_post_engagers');
  const srcB = await sourceNeuve(B.id, 'linkedin_post_engagers');
  const run = await passage(src, '2026-10-04T21:55:00Z'); // 23:55 Paris
  const runB = await passage(srcB, '2026-10-04T21:55:00Z');

  await tracerRequeteLinkedIn(ctxDe(A), run);
  await tracerRequeteLinkedIn(ctxDe(A), run);
  const posees = (await q(`select count(*)::int n from linkedin_requetes where organization_id = $1 and source_run_id = $2`, [A.id, run])).rows[0].n;
  check('10. tracer pose une ligne par appel (deux appels, deux lignes)', posees === 2, `n=${posees}`);
  const maintenant = (await q(`select count(*)::int n from linkedin_requetes where organization_id = $1 and requested_at > now() - interval '1 minute'`, [A.id])).rows[0].n;
  check('11. l’horodatage est celui de la requête (now), pas celui du passage', maintenant === 2, `récentes=${maintenant}`);

  let refus = false;
  try { await tracerRequeteLinkedIn(ctxDe(A), runB); } catch { refus = true; }
  const fuite = (await q(`select count(*)::int n from linkedin_requetes where source_run_id = $1`, [runB])).rows[0].n;
  check('12. tracer refuse le passage d’une autre organisation, sans rien écrire', refus && fuite === 0, `refus=${refus} lignes=${fuite}`);

  // On pose les horodatages voulus sur les deux lignes (fixture) : 23:56 et 00:05 heure de Paris.
  await q(`delete from linkedin_requetes where organization_id = $1`, [A.id]);
  await q(
    `insert into linkedin_requetes (organization_id, source_run_id, requested_at)
     values ($1, $2, '2026-10-04T21:56:00Z'), ($1, $2, '2026-10-04T22:05:00Z')`,
    [A.id, run],
  );
  // Les deux requêtes de la même organisation, sur un autre passage ouvert à New York 23 h 55 (03:55Z).
  const runNY = await passage(src, '2026-10-05T03:55:00Z');
  await q(
    `insert into linkedin_requetes (organization_id, source_run_id, requested_at)
     values ($1, $2, '2026-10-05T03:56:00Z'), ($1, $2, '2026-10-05T04:05:00Z')`,
    [A.id, runNY],
  );
  await q(
    `insert into linkedin_requetes (organization_id, source_run_id, requested_at) values ($1, $2, '2026-10-04T22:05:00Z')`,
    [B.id, runB],
  );

  const D = (s) => new Date(s);
  const parisMinuit = D('2026-10-04T22:00:00Z'); // 00:00 Paris le 5
  const parisLendemain = D('2026-10-05T22:00:00Z');
  const parisVeille = D('2026-10-03T22:00:00Z');
  check('13. Paris, la veille : UNE requête (23:56)', (await compterRequetesLinkedIn(ctxDe(A), parisVeille, parisMinuit)) === 1);
  check('14. Paris, le lendemain : TROIS requêtes (00:05 + les deux de New York)',
    (await compterRequetesLinkedIn(ctxDe(A), parisMinuit, parisLendemain)) === 3);
  const nyMinuit = D('2026-10-05T04:00:00Z'); // 00:00 New York le 5
  const nyVeille = D('2026-10-04T04:00:00Z');
  const nyLendemain = D('2026-10-06T04:00:00Z');
  check('15. New York, la veille : TROIS requêtes (21:56Z, 22:05Z et 03:56Z, avant 04:00Z)',
    (await compterRequetesLinkedIn(ctxDe(A), nyVeille, nyMinuit)) === 3);
  check('16. New York, le lendemain : UNE requête (00:05)', (await compterRequetesLinkedIn(ctxDe(A), nyMinuit, nyLendemain)) === 1);
  check('17. sans borne haute : tout ce qui suit', (await compterRequetesLinkedIn(ctxDe(A), parisMinuit)) === 3);
  check('18. borne basse inclusive, haute exclusive', (await compterRequetesLinkedIn(ctxDe(A), D('2026-10-04T22:05:00Z'), D('2026-10-04T22:05:00Z'))) === 0
    && (await compterRequetesLinkedIn(ctxDe(A), D('2026-10-04T22:05:00Z'), D('2026-10-04T22:05:01Z'))) === 1);
  check('19. autre organisation isolée', (await compterRequetesLinkedIn(ctxDe(B), parisVeille)) === 1);
}

async function plafonds() {
  console.log('plafonds');
  const A = await orgNeuve();
  check('20. défaut posts : 3', (await lirePlafondLinkedIn(ctxDe(A), 'linkedin_posts_par_jour')) === 3);
  check('21. défaut requêtes : 60', (await lirePlafondLinkedIn(ctxDe(A), 'linkedin_requetes_par_heure')) === 60);
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'linkedin_posts_par_jour', '7'::jsonb)`, [A.id]);
  check('22. valeur en base lue', (await lirePlafondLinkedIn(ctxDe(A), 'linkedin_posts_par_jour')) === 7);
  const B = await orgNeuve();
  check('23. valeur d’une autre organisation sans effet', (await lirePlafondLinkedIn(ctxDe(B), 'linkedin_posts_par_jour')) === 3);
}

async function fenetre() {
  console.log('fenetre');
  const A = await orgNeuve();
  const d = await lireFenetreLinkedIn(ctxDe(A));
  check('32. sans ligne : défauts de la table (lun-ven, 09:00-18:00, Europe/Paris)',
    JSON.stringify(d.jours) === '[1,2,3,4,5]' && d.debut === '09:00' && d.fin === '18:00' && d.fuseau === 'Europe/Paris', JSON.stringify(d));
  await q(`insert into linkedin_settings (organization_id) values ($1)`, [A.id]);
  const colonnes = await lireFenetreLinkedIn(ctxDe(A));
  check('33. ligne aux défauts : mêmes valeurs que sans ligne (les défauts du code suivent ceux de la table)',
    JSON.stringify(colonnes) === JSON.stringify(d), JSON.stringify(colonnes));
  await q(`update linkedin_settings set send_days = '{2,4,7}', send_from_hour = 8, send_to_hour = 24, timezone = 'America/Montreal' where organization_id = $1`, [A.id]);
  const m = await lireFenetreLinkedIn(ctxDe(A));
  check('34. ligne modifiée : valeurs lues',
    JSON.stringify(m.jours) === '[2,4,7]' && m.debut === '08:00' && m.fin === '24:00' && m.fuseau === 'America/Montreal', JSON.stringify(m));
  const B = await orgNeuve();
  const b = await lireFenetreLinkedIn(ctxDe(B));
  check('35. une autre organisation ne voit pas cette ligne', b.fuseau === 'Europe/Paris' && b.debut === '09:00', JSON.stringify(b));
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
    const r = await c.query(sql, params);
    await c.query('release savepoint s');
    return { refuse: false, n: r.rowCount };
  } catch (e) {
    await c.query('rollback to savepoint s');
    return { refuse: true, code: e.code };
  }
};

async function rls() {
  console.log('rls');
  const A = await orgNeuve();
  const B = await orgNeuve();
  const sA = await passage(await sourceNeuve(A.id, 'linkedin_post_engagers'), '2026-10-04T21:55:00Z');
  const sB = await passage(await sourceNeuve(B.id, 'linkedin_post_engagers'), '2026-10-04T21:55:00Z');
  await q(`insert into linkedin_requetes (organization_id, source_run_id) values ($1, $2), ($3, $4)`, [A.id, sA, B.id, sB]);
  const lire = (c) => c.query(`select organization_id from linkedin_requetes`).then((r) => r.rows.map((x) => x.organization_id));

  await commeUtilisateur(A.admin, async (c) => {
    const vus = await lire(c);
    check('24. admin : voit ses requêtes et aucune autre', vus.length === 1 && vus[0] === A.id, `vus=${vus.length}`);
    const ok = await refuse(c, `insert into linkedin_requetes (organization_id, source_run_id) values ($1, $2)`, [A.id, sA]);
    check('25. admin : insère pour sa propre organisation', !ok.refuse, JSON.stringify(ok));
    const ins = await refuse(c, `insert into linkedin_requetes (organization_id, source_run_id) values ($1, $2)`, [B.id, sB]);
    check('26. admin : n’insère pas pour une autre organisation (42501)', ins.code === '42501', JSON.stringify(ins));
  });
  await commeUtilisateur(A.viewer, async (c) => {
    const vus = await lire(c);
    check('27. viewer : lit ses requêtes', vus.length === 1 && vus[0] === A.id, `vus=${vus.length}`);
    const ins = await refuse(c, `insert into linkedin_requetes (organization_id, source_run_id) values ($1, $2)`, [A.id, sA]);
    check('28. viewer : insert refusé par la RLS (42501)', ins.code === '42501', JSON.stringify(ins));
    const d = await c.query(`delete from linkedin_requetes where organization_id = $1`, [A.id]);
    check('29. viewer : delete sans effet', d.rowCount === 0, `rowCount=${d.rowCount}`);
  });
  const dehors = await userNeuf();
  await commeUtilisateur(dehors, async (c) => {
    check('30. non-membre : ne voit rien', (await lire(c)).length === 0);
    const ins = await refuse(c, `insert into linkedin_requetes (organization_id, source_run_id) values ($1, $2)`, [A.id, sA]);
    check('31. non-membre : insert refusé par la RLS (42501)', ins.code === '42501', JSON.stringify(ins));
  });
}

try {
  await q('truncate organizations cascade');
  await postsDuJour();
  await requetes();
  await plafonds();
  await fenetre();
  await rls();
} finally {
  await pool.end();
}
if (failures > 0) {
  console.log(`\n=== LINKEDIN-PLAFONDS FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('\n=== LINKEDIN-PLAFONDS OK ===');
