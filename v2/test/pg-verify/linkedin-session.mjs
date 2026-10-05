// Lot 4a, tâche 1 : exécution RÉELLE, sur Postgres, du SQL de la session
// LinkedIn du serveur. Aucune requête n'est recopiée ici.
//
// Mutation qui fait rougir chaque bloc (voir le rapport de la tâche 1) :
//   verrou  : retirer `lock_until < now()` du `where` de prendreVerrouLinkedIn ;
//   blocage : retirer `where ... status <> 'bloquee'` de bloquerSessionLinkedIn.
import pg from 'pg';
import {
  activerSessionLinkedIn,
  bloquerSessionLinkedIn,
  lireSessionLinkedIn,
  prendreVerrouLinkedIn,
} from './_linkedin-session-bundle.mjs';

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
/** Organisation avec deux membres (un admin, un viewer) : la notification doit en toucher deux. */
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
const ctxDe = (o) => ({ ex: pool, organisationId: o.id ?? o, utilisateurId: null, role: null });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function verrou() {
  console.log('verrou');
  const a = (await orgNeuve()).id;
  const b = (await orgNeuve()).id;
  await activerSessionLinkedIn(ctxDe(a), '203.0.113.7');
  await activerSessionLinkedIn(ctxDe(b), '203.0.113.8');

  check('1. première prise : accordée', (await prendreVerrouLinkedIn(ctxDe(a), 'w1', 1500)) === true);
  check('2. seconde prise, verrou valide : refusée', (await prendreVerrouLinkedIn(ctxDe(a), 'w2', 1500)) === false);
  const l = (await q(`select lock_owner from linkedin_server_sessions where organization_id = $1`, [a])).rows[0];
  check('3. le propriétaire reste le premier', l.lock_owner === 'w1', `lock_owner=${l.lock_owner}`);
  check('4. le verrou d’une autre organisation est indépendant', (await prendreVerrouLinkedIn(ctxDe(b), 'w3', 1500)) === true);
  await dormir(2500);
  check('5. après expiration : accordée au nouveau', (await prendreVerrouLinkedIn(ctxDe(a), 'w2', 1500)) === true);
  const l2 = (await q(`select lock_owner from linkedin_server_sessions where organization_id = $1`, [a])).rows[0];
  check('6. le propriétaire a changé', l2.lock_owner === 'w2', `lock_owner=${l2.lock_owner}`);

  check('6b. le même propriétaire renouvelle son verrou valide', (await prendreVerrouLinkedIn(ctxDe(a), 'w2', 1500)) === true);
  check('6c. un autre propriétaire reste refusé', (await prendreVerrouLinkedIn(ctxDe(a), 'w9', 1500)) === false);

  const sans = (await orgNeuve()).id;
  check('7. session absente : pas de verrou', (await prendreVerrouLinkedIn(ctxDe(sans), 'w1', 1500)) === false);
}

async function etat() {
  console.log('etat');
  const org = (await orgNeuve()).id;
  check('8. aucune ligne : lire rend null', (await lireSessionLinkedIn(ctxDe(org))) === null);

  await activerSessionLinkedIn(ctxDe(org), '203.0.113.7');
  let s = await lireSessionLinkedIn(ctxDe(org));
  check('9. activée : état active, IP attendue posée, pas de motif',
    s.etat === 'active' && s.ipAttendue === '203.0.113.7' && s.motif === null && s.connecteeLe instanceof Date);

  await bloquerSessionLinkedIn(ctxDe(org), 'defi');
  s = await lireSessionLinkedIn(ctxDe(org));
  check('10. bloquée : motif et date posés', s.etat === 'bloquee' && s.motif === 'defi' && s.bloqueeLe instanceof Date);
  const notifs = () => q(`select event, payload from notifications where organization_id = $1 and event = 'linkedin.session_blocked'`, [org]);
  const n1 = (await notifs()).rows;
  check('11. une notification par membre (2 membres, 2 lignes)', n1.length === 2, `n=${n1.length} (deux membres)`);
  
  await bloquerSessionLinkedIn(ctxDe(org), 'disjoncteur');
  const n2 = (await notifs()).rows;
  s = await lireSessionLinkedIn(ctxDe(org));
  check('12. second blocage : pas de renotification, motif d’origine conservé', n2.length === 2 && s.motif === 'defi', `n=${n2.length} motif=${s.motif}`);

  await activerSessionLinkedIn(ctxDe(org), '203.0.113.9');
  s = await lireSessionLinkedIn(ctxDe(org));
  check('13. réactivée : motif et date effacés', s.etat === 'active' && s.motif === null && s.bloqueeLe === null && s.ipAttendue === '203.0.113.9');

  const vierge = (await orgNeuve()).id;
  await bloquerSessionLinkedIn(ctxDe(vierge), 'cookie_refuse');
  s = await lireSessionLinkedIn(ctxDe(vierge));
  check('14. blocage d’une organisation sans ligne : la ligne est créée', s.etat === 'bloquee' && s.motif === 'cookie_refuse');

  // Atomicité : si la notification échoue, le blocage est annulé, et le rappel notifie.
  const panne = (await orgNeuve()).id;
  await activerSessionLinkedIn(ctxDe(panne), '203.0.113.7');
  await q(`create or replace function public.test_echec_notif() returns trigger language plpgsql as $$ begin raise exception 'panne notification simulée'; end $$`);
  await q(`create trigger test_echec_notif before insert on notifications for each row when (new.organization_id = '${panne}') execute function public.test_echec_notif()`);
  let leve = false;
  try { await bloquerSessionLinkedIn(ctxDe(panne), 'defi'); } catch { leve = true; }
  s = await lireSessionLinkedIn(ctxDe(panne));
  check('14b. notification en panne : l’erreur remonte et le blocage est annulé', leve && s.etat === 'active' && s.motif === null, `leve=${leve} etat=${s.etat}`);
  await q(`drop trigger test_echec_notif on notifications`);
  await bloquerSessionLinkedIn(ctxDe(panne), 'defi');
  const np = (await q(`select 1 from notifications where organization_id = $1 and event = 'linkedin.session_blocked'`, [panne])).rowCount;
  s = await lireSessionLinkedIn(ctxDe(panne));
  check('14c. rappel après panne : bloquée ET notifiée', s.etat === 'bloquee' && np === 2, `etat=${s.etat} notifs=${np}`);
}

/** Exécute `fn(client)` sous le rôle `authenticated`, identifié comme `userId` : la RLS s'applique (le superuser la contourne). */
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
  await activerSessionLinkedIn(ctxDe(A), '203.0.113.7');
  await activerSessionLinkedIn(ctxDe(B), '203.0.113.8');
  const lire = (c) => c.query(`select organization_id from linkedin_server_sessions`).then((r) => r.rows.map((x) => x.organization_id));

  await commeUtilisateur(A.admin, async (c) => {
    const vus = await lire(c);
    check('16. admin : voit sa session et aucune autre', vus.length === 1 && vus[0] === A.id, `vus=${vus.length}`);
    const u = await c.query(`update linkedin_server_sessions set last_egress_country = 'FR' where organization_id = $1`, [A.id]);
    check('17. admin : écrit sur sa session', u.rowCount === 1);
    const autre = await refuse(c, `update linkedin_server_sessions set last_egress_country = 'XX' where organization_id = $1`, [B.id]);
    check('18. admin : n’écrit pas sur celle d’une autre organisation', autre.refuse || autre.n === 0, JSON.stringify(autre));
    const ins = await refuse(c, `insert into linkedin_server_sessions (organization_id) values ($1)`, [(await orgNeuve()).id]);
    check('19. admin : n’insère pas pour une organisation qui n’est pas la sienne', ins.refuse, JSON.stringify(ins));
  });

  await commeUtilisateur(A.viewer, async (c) => {
    const vus = await lire(c);
    check('20. viewer : lecture seule de sa propre session (modèle linkedin_settings)', vus.length === 1 && vus[0] === A.id, `vus=${vus.length}`);
    const u = await c.query(`update linkedin_server_sessions set last_egress_country = 'ZZ' where organization_id = $1`, [A.id]);
    check('21. viewer : update sans effet', u.rowCount === 0, `rowCount=${u.rowCount}`);
    const d = await c.query(`delete from linkedin_server_sessions where organization_id = $1`, [A.id]);
    check('22. viewer : delete sans effet', d.rowCount === 0, `rowCount=${d.rowCount}`);
    const ins = await refuse(c, `insert into linkedin_server_sessions (organization_id) values ($1)`, [A.id]);
    check('23. viewer : insert refusé', ins.refuse, JSON.stringify(ins));
  });

  const dehors = await userNeuf();
  await commeUtilisateur(dehors, async (c) => {
    const vus = await lire(c);
    check('24. non-membre : ne voit rien', vus.length === 0, `vus=${vus.length}`);
    const u = await c.query(`update linkedin_server_sessions set last_egress_country = 'ZZ'`);
    check('25. non-membre : update sans effet', u.rowCount === 0);
    const ins = await refuse(c, `insert into linkedin_server_sessions (organization_id) values ($1)`, [A.id]);
    check('26. non-membre : insert refusé', ins.refuse, JSON.stringify(ins));
  });
  const reste = (await q(`select last_egress_country from linkedin_server_sessions where organization_id = $1`, [A.id])).rows[0];
  check('27. rien n’a été écrit par le viewer ni le non-membre (les écritures de l’admin sont annulées par l’assistant)', reste.last_egress_country === null, `pays=${reste.last_egress_country}`);
}

try {
  await q('truncate organizations cascade');
  await verrou();
  await etat();
  await rls();
} finally {
  await pool.end();
}
if (failures > 0) {
  console.log(`\n=== LINKEDIN-SESSION FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('\n=== LINKEDIN-SESSION OK ===');
