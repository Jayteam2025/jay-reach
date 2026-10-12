// Lot 5, tâche 6 : exécution RÉELLE, sur Postgres, de garantirExpediteurLinkedIn et de la déconnexion.
// Le SQL est celui de la production, lu dans le bundle ; seul le navigateur est factice.
//
// Mutations qui font rougir (une par une, puis remise en place) :
//   1. expediteurs.ts : retirer `order by created_at asc, id asc` — 3 et 3b rougissent (la ligne reprise n'est plus la plus ancienne).
//   2. retirer le CTE `desactives` (ou son `where ... is_active`) — 3, 3a et 4 rougissent (deux lignes actives).
//   3. retirer `is_active = true` du CTE `repris` — 2b et 3b rougissent (la ligne inactive reprise reste inactive).
//   4. retirer `where not exists (select 1 from cible)` du CTE `cree` — 2 rougit (une ligne créée en plus).
//   5. retirer `and kind = 'linkedin'` du CTE `desactives` — 6 rougit (la boîte email est désactivée).
//   6. retirer le verrou pg_advisory_xact_lock — 5 rougit (deux lignes actives créées en parallèle).
//   7. desactiverExpediteurLinkedIn : retirer l'appel dans deconnecter — 7 rougit.
import pg from 'pg';
import { garantirExpediteurLinkedIn, deconnecter } from '__BUNDLE__';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
async function jouer(...sections) {
  for (const section of sections) {
    try { await section(); } catch (e) {
      check(`section ${section.name} : exception, ses contrôles n'ont PAS été joués`, false, String(e?.message ?? e));
    }
  }
}

let seq = 0;
async function org() {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const id = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
  return { id, ctx: { ex: pool, organisationId: id, utilisateurId: null, role: null } };
}
const ligneLi = (o, identity, actif, ageJours) =>
  q(`insert into senders (organization_id, kind, identity, display_name, is_active, daily_quota, provider_id, created_at)
     values ($1, 'linkedin', $2, 'JB (LinkedIn)', $3, 25, 'extension', now() - ($4 || ' days')::interval) returning id`,
    [o.id, identity, actif, String(ageJours)]).then((r) => r.rows[0].id);
const lignes = (o) => q(`select id, identity, display_name, is_active, daily_quota, business_hours, timezone from senders
                          where organization_id = $1 and kind = 'linkedin' order by created_at`, [o.id]).then((r) => r.rows);
const actives = (rs) => rs.filter((r) => r.is_active);

async function creation() {
  console.log('\n1-2. sans ligne : une ligne active, quotas lus dans linkedin_settings');
  const o = await org();
  await q(`insert into linkedin_settings (organization_id, daily_cap, weekly_cap, send_from_hour, send_to_hour, send_days, timezone)
           values ($1, 17, 80, 8, 17, '{1,2,3}', 'Europe/Lisbon')`, [o.id]);
  const id = await garantirExpediteurLinkedIn(o.ctx, 'alexandre-declercq', 'alexandre-declercq (LinkedIn)');
  const rs = await lignes(o);
  check('1. une seule ligne, active, celle que la fonction rend', rs.length === 1 && rs[0].is_active && rs[0].id === id, `${rs.length} ligne(s)`);
  check('1a. identité et nom affiché posés', rs[0]?.identity === 'alexandre-declercq' && rs[0]?.display_name === 'alexandre-declercq (LinkedIn)');
  check('1b. quota lu dans linkedin_settings, pas en dur', rs[0]?.daily_quota === 17, String(rs[0]?.daily_quota));
  check('1c. fenêtre et fuseau lus dans linkedin_settings',
    (({ startHour, endHour, days } = rs[0]?.business_hours ?? {}) => startHour === 8 && endHour === 17 && days?.join() === '1,2,3')() && rs[0]?.timezone === 'Europe/Lisbon',
    JSON.stringify(rs[0]?.business_hours));
  const sans = await org();
  await garantirExpediteurLinkedIn(sans.ctx, 'x', 'X');
  const r2 = await lignes(sans);
  check('2. sans réglage enregistré : quota par défaut non nul (nul = sans plafond)', r2[0]?.daily_quota === 25, String(r2[0]?.daily_quota));
}

async function reprise() {
  console.log('\n2b. une ligne existante est reprise, jamais doublée');
  const o = await org();
  const ancien = await ligneLi(o, 'jb-linkedin', false, 30);
  const id = await garantirExpediteurLinkedIn(o.ctx, 'alexandre-declercq', 'alexandre-declercq (LinkedIn)');
  const rs = await lignes(o);
  check('2a. même ligne reprise, aucune créée', id === ancien && rs.length === 1, `${rs.length} ligne(s)`);
  check('2b. rendue active, identité et nom mis à jour', rs[0]?.is_active && rs[0]?.identity === 'alexandre-declercq' && rs[0]?.display_name === 'alexandre-declercq (LinkedIn)');
}

async function cas_reel() {
  console.log('\n3. le cas réel du 12/10 : deux lignes jb-linkedin, une active et une inactive');
  // Les deux ordres possibles : on ne sait pas laquelle des deux est la plus ancienne, la règle doit tenir dans les deux.
  for (const [nom, ageActive, ageInactive] of [['la plus ancienne est inactive', 5, 20], ['la plus ancienne est active', 20, 5]]) {
    const o = await org();
    const active = await ligneLi(o, 'jb-linkedin', true, ageActive);
    const inactive = await ligneLi(o, 'jb-linkedin', false, ageInactive);
    const plusAncienne = ageActive > ageInactive ? active : inactive;
    await q(`insert into senders (organization_id, kind, identity, is_active) values ($1, 'email', 'boite@exemple.fr', true)`, [o.id]);
    const id = await garantirExpediteurLinkedIn(o.ctx, 'jb-reel', 'jb-reel (LinkedIn)');
    const rs = await lignes(o);
    check(`3. (${nom}) exactement UNE ligne active`, actives(rs).length === 1, `${actives(rs).length} active(s)`);
    check(`3a. (${nom}) c'est la plus ancienne, qui porte l'identité du compte connecté`, id === plusAncienne && actives(rs)[0]?.id === plusAncienne && actives(rs)[0]?.identity === 'jb-reel');
    check(`3b. (${nom}) aucune ligne créée, aucune supprimée (les liaisons contact survivent)`, rs.length === 2);
    const mail = (await q(`select is_active from senders where organization_id = $1 and kind = 'email'`, [o.id])).rows[0];
    check(`3c. (${nom}) la boîte email n'est pas touchée`, mail?.is_active === true);
  }
}

async function idempotence() {
  console.log('\n4. deux appels de suite');
  const o = await org();
  await ligneLi(o, 'jb-linkedin', true, 10);
  await ligneLi(o, 'jb-linkedin', true, 3);
  const a = await garantirExpediteurLinkedIn(o.ctx, 'jb-reel', 'jb');
  const b = await garantirExpediteurLinkedIn(o.ctx, 'jb-reel', 'jb');
  const rs = await lignes(o);
  check('4. même ligne rendue deux fois, une seule active, trois lignes en tout inchangées', a === b && actives(rs).length === 1 && rs.length === 2, `${actives(rs).length} active(s) / ${rs.length}`);
}

async function concurrence() {
  console.log('\n5. appels simultanés sur des organisations sans ligne (la course est étroite : 30 organisations x 8 appels)');
  let fautives = 0;
  const detail = [];
  for (let i = 0; i < 30; i += 1) {
    const o = await org();
    const ids = await Promise.all(Array.from({ length: 8 }, () => garantirExpediteurLinkedIn(o.ctx, 'jb-reel', 'jb')));
    const rs = await lignes(o);
    if (!(rs.length === 1 && actives(rs).length === 1 && new Set(ids).size === 1)) {
      fautives += 1;
      detail.push(`${rs.length} ligne(s)/${actives(rs).length} active(s)`);
    }
  }
  check('5. jamais plus d\'une ligne ni plus d\'une active, un seul identifiant rendu', fautives === 0, `${fautives} organisation(s) fautive(s) ${detail.slice(0, 3).join(' ; ')}`);
}

const piloteFaux = (ordre) => ({
  aller: async () => void ordre.push('aller'),
  effacerCookies: async () => void ordre.push('effacer'),
  fermer: async () => void ordre.push('fermer'),
});
async function deconnexion() {
  console.log('\n7. la déconnexion désactive l\'expéditeur et révoque la session');
  const o = await org();
  await ligneLi(o, 'jb-linkedin', true, 5);
  await ligneLi(o, 'jb-linkedin', true, 2); // un reliquat actif : la déconnexion doit tout éteindre
  const autre = await org();
  await ligneLi(autre, 'autre', true, 5);
  await q(`insert into linkedin_server_sessions (organization_id, status) values ($1, 'active')`, [o.id]);
  const ordre = [];
  const d = { env: {}, ecrire: () => {}, ouvrirNavigateur: async () => piloteFaux(ordre) };
  const code = await deconnecter(o.ctx, d);
  check('7. rend 0 et efface les cookies après la navigation', code === 0 && ordre.join(',') === 'aller,effacer,fermer', ordre.join(','));
  check('7a. plus aucune ligne LinkedIn active, les lignes sont gardées', actives(await lignes(o)).length === 0 && (await lignes(o)).length === 2);
  check('7b. l\'autre organisation n\'est pas touchée', actives(await lignes(autre)).length === 1);
  const st = (await q(`select status, blocked_reason from linkedin_server_sessions where organization_id = $1`, [o.id])).rows[0];
  check('7c. session révoquée', st?.status === 'bloquee' && st?.blocked_reason === 'revoquee', JSON.stringify(st));
  // Puis la reconnexion reprend la ligne la plus ancienne : une seule active.
  await garantirExpediteurLinkedIn(o.ctx, 'alexandre-declercq', 'alexandre-declercq (LinkedIn)');
  check('7d. une reconnexion rend UNE ligne active, la plus ancienne', actives(await lignes(o)).length === 1);
}

await jouer(creation, reprise, cas_reel, idempotence, concurrence, deconnexion);
await pool.end();
console.log(failures === 0 ? '\nVERIFY_OK' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
