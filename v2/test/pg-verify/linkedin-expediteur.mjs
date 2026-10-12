// Lot 5, tâche 6 : exécution RÉELLE, sur Postgres, de garantirExpediteurLinkedIn et de la déconnexion.
// Le SQL est celui de la production, lu dans le bundle ; seul le navigateur est factice.
//
// Mutations qui font rougir (une par une, puis remise en place) :
//   1. expediteurs.ts : retirer `order by created_at asc, id asc` — 3a rougit (la ligne reprise n'est plus la plus ancienne).
//   2. retirer l'UPDATE `expediteur_linkedin_doublons` — 3, 4 rougissent (et l'index unique fait échouer la reprise : 3b).
//   3. retirer `is_active = true` de la reprise — 2b, 3, 7d rougissent.
//   4. retirer le verrou pg_advisory_xact_lock — 5 rougit (lignes en double ou refus de l'index).
//   5. retirer `and kind = 'linkedin'` de l'UPDATE des doublons — 3c rougit (la boîte email est désactivée).
//   6. retirer l'écriture d'audit du changement de compte — 6 rougit.
//   7. migration 20261012160000 : retirer l'index unique partiel — 8, 8a rougissent.
//   8. deconnecter : retirer l'appel `desactiverExpediteurLinkedIn` — 7a rougit.
//   9. traiter-connexion.ts : solder l'intention même quand le code retour est 1 — 9b rougit ;
//      ne pas la poser avant de différer — 9c rougit ; ne pas la reprendre au démarrage — 9d rougit.
//  10. linkedin-connexion.ts : retirer SQL_POSER_DECONNEXION de demanderDeconnexion — 9a rougit.
import pg from 'pg';
import {
  garantirExpediteurLinkedIn, deconnecter, modifierCompteLinkedIn, demanderDeconnexion,
  traiterMessageConnexion, oublierConnexionsEnCours, reprendreDeconnexionsEnAttente,
} from '__BUNDLE__';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const q = (sql, params) => pool.query(sql, params);

console.error = () => {}; // journaux d'erreur attendus du worker
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
  await ligneLi(o, 'jb-linkedin', false, 3);
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

const piloteFaux = (ordre = []) => ({
  aller: async () => void ordre.push('aller'),
  effacerCookies: async () => void ordre.push('effacer'),
  fermer: async () => void ordre.push('fermer'),
});
async function deconnexion() {
  console.log('\n7. la déconnexion désactive l\'expéditeur et révoque la session');
  const o = await org();
  await ligneLi(o, 'jb-linkedin', true, 5);
  await ligneLi(o, 'jb-linkedin', false, 2);
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

const audit = (o, action) => q(`select diff from audit_events where organization_id = $1 and action = $2 order by created_at`, [o.id, action]).then((r) => r.rows.map((x) => x.diff));
async function changementDeCompte() {
  console.log('\n6. changement de compte : la ligne est gardée, le basculement est consigné');
  const o = await org();
  const ligne = await ligneLi(o, 'jb-linkedin', true, 10);
  await garantirExpediteurLinkedIn(o.ctx, 'jb-linkedin', 'jb-linkedin (LinkedIn)');
  check('6. même compte : rien de consigné', (await audit(o, 'linkedin.expediteur_compte_change')).length === 0);
  const id = await garantirExpediteurLinkedIn(o.ctx, 'alexandre-declercq', 'alexandre-declercq (LinkedIn)');
  const ev = await audit(o, 'linkedin.expediteur_compte_change');
  check('6a. autre compte : même ligne gardée', id === ligne && (await lignes(o)).length === 1);
  check('6b. un événement avec ancienne et nouvelle identité', ev.length === 1 && ev[0].ancienneIdentite === 'jb-linkedin' && ev[0].nouvelleIdentite === 'alexandre-declercq', JSON.stringify(ev));
}

const erreurDe = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
async function indexUnique() {
  console.log('\n8. une seule ligne LinkedIn active par organisation, imposée par la base');
  const o = await org();
  await ligneLi(o, 'a', true, 5);
  const e = await erreurDe(() => ligneLi(o, 'b', true, 1));
  check('8. une seconde ligne active est refusée par l\'index (23505)', e?.code === '23505' && /un_linkedin_actif/.test(e?.constraint ?? ''), e?.message);
  check('8a. une seconde ligne INACTIVE reste permise', (await erreurDe(() => ligneLi(o, 'c', false, 1))) === null);
  const autre = await org();
  check('8b. une autre organisation peut avoir la sienne', (await erreurDe(() => ligneLi(autre, 'a', true, 1))) === null);

  // L'ancien chemin (extension) : modifierCompteLinkedIn crée sa ligne par upsert sur provider_ref. Il doit échouer bruyamment.
  const o2 = await org();
  await garantirExpediteurLinkedIn(o2.ctx, 'jb-linkedin', 'jb');
  const user = (await q(`insert into auth.users (email) values ($1) returning id`, [`ext-${Date.now()}@t.local`])).rows[0].id;
  await q(`insert into extension_tokens (token_hash, organization_id, user_id, is_active) values ($1, $2, $3, true)`, [`h${Date.now()}`, o2.id, user]);
  const ctxAdmin = { ex: pool, organisationId: o2.id, utilisateurId: user, role: 'admin' };
  const e2 = await erreurDe(() => modifierCompteLinkedIn(ctxAdmin, {
    compteId: user, active: true, quotaJour: 20, quotaSemaine: 80,
    heures: { debut: '09:00', fin: '18:00', jours: [1, 2, 3, 4, 5], fuseau: 'Europe/Paris' },
  }));
  check('8c. l\'ancien chemin ne crée PAS une seconde ligne active : erreur lisible', e2 !== null && /déjà actif/.test(e2.message) && !/senders_un|23505/.test(e2.message), e2?.message);
  check('8d. et il reste une seule ligne active', actives(await lignes(o2)).length === 1);
}

async function intentionDeDeconnexion() {
  console.log('\n9. l\'intention de déconnexion est persistée, rejouée, et soldée seulement si les cookies sont effacés');
  const lire = (o) => q(`select deconnexion_demandee_at at from linkedin_server_sessions where organization_id = $1`, [o.id]).then((r) => r.rows[0]?.at ?? null);
  const base = (pilote) => async (ctx, d) => deconnecter(ctx, { ...d, ouvrirNavigateur: async () => pilote });
  const bon = () => piloteFaux([]);
  const cassé = () => ({ ...piloteFaux([]), effacerCookies: async () => { throw new Error('cdp'); } });
  const user = async (o) => {
    const u = (await q(`insert into auth.users (email) values ($1) returning id`, [`a-${Date.now()}-${Math.random()}@t.local`])).rows[0].id;
    await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [o.id, u]);
    return { ex: pool, organisationId: o.id, utilisateurId: u, role: 'admin' };
  };
  const msg = (o) => ({ type: 'deconnexion', demandeId: '00000000-0000-4000-8000-000000000001', organizationId: o.id });

  let o = await org();
  await demanderDeconnexion(await user(o));
  check('9a. demanderDeconnexion persiste l\'intention avant tout message', (await lire(o)) !== null);

  o = await org();
  await ligneLi(o, 'jb-linkedin', true, 3);
  await traiterMessageConnexion(pool, msg(o), { deconnecter: base(bon()) });
  check('9. déconnexion réussie : intention soldée, expéditeur désactivé', (await lire(o)) === null && actives(await lignes(o)).length === 0);
  check('9a2. issue consignée en réussi', (await audit(o, 'linkedin.deconnexion_terminee')).at(-1)?.statut === 'reussi');

  o = await org();
  await ligneLi(o, 'jb-linkedin', true, 3);
  await traiterMessageConnexion(pool, msg(o), { deconnecter: base(cassé()) });
  check('9b. cookies NON effacés : l\'intention reste en base, l\'issue est un échec', (await lire(o)) !== null && (await audit(o, 'linkedin.deconnexion_terminee')).at(-1)?.statut === 'echec');
  oublierConnexionsEnCours();
  const n = await reprendreDeconnexionsEnAttente(pool, { deconnecter: base(bon()) });
  check('9d. au démarrage suivant, l\'intention est rejouée et soldée', n >= 1 && (await lire(o)) === null);

  // Pendant une connexion : persistée, pas jouée.
  o = await org();
  const demandeur = await user(o);
  const demandeId = (await q(`insert into linkedin_connexion_demandes (organization_id, demandee_par, statut) values ($1, $2, 'demandee') returning id`, [o.id, demandeur.utilisateurId])).rows[0].id;
  let jouee = 0;
  let liberer = () => {};
  const bloquee = new Promise((r) => (liberer = () => r(0)));
  const secrets = { type: 'secrets', demandeId, organizationId: o.id, identifiant: 'x', motDePasse: 'y' };
  const fausseDep = { contexte: async () => ({ ex: pool, organisationId: o.id, utilisateurId: null, role: null }), livrerCode: () => {}, vider: async () => {} };
  const premiere = traiterMessageConnexion(pool, secrets, { connecter: () => bloquee, dependances: () => fausseDep, deconnecter: async () => { jouee += 1; return 0; } });
  await new Promise((r) => setTimeout(r, 300));
  await traiterMessageConnexion(pool, msg(o), { deconnecter: async () => { jouee += 1; return 0; } });
  check('9c. pendant la connexion : intention persistée, rien de joué', (await lire(o)) !== null && jouee === 0);
  liberer();
  await premiere;
  check('9c2. à la fin de la connexion : jouée une fois, soldée', jouee === 1 && (await lire(o)) === null, `jouee=${jouee}`);
}

await jouer(creation, reprise, cas_reel, idempotence, concurrence, changementDeCompte, deconnexion, indexUnique, intentionDeDeconnexion);
await pool.end();
console.log(failures === 0 ? '\nVERIFY_OK' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
