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
async function orgNeuve() {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const id = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`]))
    .rows[0].id;
  await q(`insert into memberships (organization_id, user_id, role)
           select $1, u.id, 'owner' from auth.users u limit 1`, [id]);
  return id;
}
const ctxDe = (organisationId) => ({ ex: pool, organisationId, utilisateurId: null, role: null });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function verrou() {
  console.log('verrou');
  const a = await orgNeuve();
  const b = await orgNeuve();
  await activerSessionLinkedIn(ctxDe(a), '203.0.113.7');
  await activerSessionLinkedIn(ctxDe(b), '203.0.113.8');

  check('1. première prise : accordée', (await prendreVerrouLinkedIn(ctxDe(a), 'w1', 1500)) === true);
  check('2. seconde prise, verrou valide : refusée', (await prendreVerrouLinkedIn(ctxDe(a), 'w2', 1500)) === false);
  const l = (await q(`select lock_owner from linkedin_server_sessions where organization_id = $1`, [a])).rows[0];
  check('3. le propriétaire reste le premier', l.lock_owner === 'w1', `lock_owner=${l.lock_owner}`);
  check('4. le verrou d’une autre organisation est indépendant', (await prendreVerrouLinkedIn(ctxDe(b), 'w3', 1500)) === true);
  await dormir(1800);
  check('5. après expiration : accordée au nouveau', (await prendreVerrouLinkedIn(ctxDe(a), 'w2', 1500)) === true);
  const l2 = (await q(`select lock_owner from linkedin_server_sessions where organization_id = $1`, [a])).rows[0];
  check('6. le propriétaire a changé', l2.lock_owner === 'w2', `lock_owner=${l2.lock_owner}`);

  const sans = await orgNeuve();
  check('7. session absente : pas de verrou', (await prendreVerrouLinkedIn(ctxDe(sans), 'w1', 1500)) === false);
}

async function etat() {
  console.log('etat');
  const org = await orgNeuve();
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
  check('11. une notification par membre', n1.length === 1, `n=${n1.length}`);
  
  await bloquerSessionLinkedIn(ctxDe(org), 'disjoncteur');
  const n2 = (await notifs()).rows;
  s = await lireSessionLinkedIn(ctxDe(org));
  check('12. second blocage : pas de renotification, motif d’origine conservé', n2.length === 1 && s.motif === 'defi', `n=${n2.length} motif=${s.motif}`);

  await activerSessionLinkedIn(ctxDe(org), '203.0.113.9');
  s = await lireSessionLinkedIn(ctxDe(org));
  check('13. réactivée : motif et date effacés', s.etat === 'active' && s.motif === null && s.bloqueeLe === null && s.ipAttendue === '203.0.113.9');

  const vierge = await orgNeuve();
  await bloquerSessionLinkedIn(ctxDe(vierge), 'cookie_refuse');
  s = await lireSessionLinkedIn(ctxDe(vierge));
  check('14. blocage d’une organisation sans ligne : la ligne est créée', s.etat === 'bloquee' && s.motif === 'cookie_refuse');
}

try {
  await q('truncate organizations cascade');
  await q(`insert into auth.users (id) values (gen_random_uuid()) on conflict do nothing`).catch(() => {});
  await verrou();
  await etat();
} finally {
  await pool.end();
}
if (failures > 0) {
  console.log(`\n=== LINKEDIN-SESSION FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('\n=== LINKEDIN-SESSION OK ===');
