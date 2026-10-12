// Lot 5, tâche 5 : exécution RÉELLE, sur Postgres, des actions de connexion LinkedIn (cœur + worker).
// Le SQL est celui de la production, lu dans le bundle ; rien n'est simulé hors le navigateur.
//
// Mutations qui font rougir (une par une, puis remise en place) :
//   1. linkedin-connexion.ts : retirer le `catch` 23505 de demanderConnexion — 1 rougit (erreur de contrainte brute).
//   2. linkedin-connexion-sql.ts : SQL_FORMULAIRE_FERME, retirer `and max(updated_at) > now() - interval ...` — 3d rougit ;
//      retirer le `not (statut = 'echec' and motif in ...)` — 3b et 3c rougissent ; passer `limit 3` à `limit 4` — 3a rougit.
//   3. SQL_POSER_WORKER_ABSENT : retirer `and etape is null` — 4c rougit ; retirer `created_at < ...` — 4b rougit ;
//      retirer `organization_id = $1` — 4e rougit.
//   4. SQL_ANNULER : retirer `organization_id = $2` — 5b rougit ; retirer `statut in (...)` — 5c rougit.
//   5. SQL_EXPIRER_DE_L_ORGANISATION : retirer l'appel dans demanderConnexion — 6 rougit.
//   6. traiter-connexion.ts : retirer SQL_CLORE_SI_EN_COURS du `finally` — 8 et 8b rougissent.
//   7. SQL_CLORE_SI_EN_COURS : retirer `and statut in ...` — 8c rougit.
//   9. (tâche 5, reprise) cloreDemandesOrphelines : retirer la requête — 9b rougit ; SQL_ACCUSER_RECEPTION `set etape = 'recue'`
//      remis à 'navigateur_ouvert' — 8f rougit ; retirer le test `rowCount !== 1` — 8h rougit ; retirer
//      `revoquerSiAnnuleeTropTard` — 8j rougit ; retirer la clôture `verrou_occupe` — 8i rougit.
//   8. migration 20261012150000 : retirer 'erreur_interne' de la contrainte — 8 rougit (23514).
import pg from 'pg';
import {
  annulerConnexion, demanderConnexion, lireDemandeEnCours, repondreDefi,
  ErreurAucunCodeAttendu, ErreurConnexionEnCours, ErreurFormulaireFerme,
  traiterMessageConnexion, oublierConnexionsEnCours,
  SQL_ACCUSER_RECEPTION, SQL_PURGER, cloreDemandesOrphelines, activerSessionLinkedIn, lireSessionLinkedIn,
} from '__BUNDLE__';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
const erreurDe = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

let seq = 0;
/** Une organisation neuve avec un admin, et un contexte du cœur au nom de cet admin. */
async function monde(role = 'admin') {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const org = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
  const user = (await q(`insert into auth.users (email) values ($1) returning id`, [`u-${n}@t.local`])).rows[0].id;
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, $3)`, [org, user, role]);
  return { org, user, ctx: { ex: pool, organisationId: org, utilisateurId: user, role } };
}
const demande = (m, statut, { motif = null, etape = null, ageSecondes = 0, majIlYa = 0, expireDans = 900 } = {}) =>
  q(`insert into linkedin_connexion_demandes (organization_id, demandee_par, statut, motif, etape, created_at, updated_at, expires_at)
     values ($1, $2, $3, $4, $5, now() - ($6 || ' seconds')::interval, now() - ($7 || ' seconds')::interval, now() + ($8 || ' seconds')::interval)
     returning id`, [m.org, m.user, statut, motif, etape, String(ageSecondes), String(majIlYa), String(expireDans)]).then((r) => r.rows[0].id);
const ligne = (id) => q(`select statut, motif, etape from linkedin_connexion_demandes where id = $1`, [id]).then((r) => r.rows[0]);
const secrets = { identifiant: 'alex@exemple.fr', motDePasse: 'secret-123' };

console.error = () => {}; // les journaux d'erreur attendus du worker n'ont pas leur place dans la sortie du harnais
console.log0 = console.log;

async function uneSeuleEnCours() {
  console.log('\n1. une seule demande en cours (deux onglets)');
  const m = await monde();
  const [a, b] = await Promise.all([
    erreurDe(() => demanderConnexion(m.ctx, secrets)),
    erreurDe(() => demanderConnexion(m.ctx, secrets)),
  ]);
  const erreurs = [a, b].filter(Boolean);
  check('1. une des deux demandes simultanées passe, l\'autre est refusée', erreurs.length === 1, `${erreurs.length} refus`);
  check('1b. le refus est « une connexion est déjà en cours », pas une erreur de contrainte',
    erreurs[0] instanceof ErreurConnexionEnCours && !/duplicate|constraint/i.test(erreurs[0].message), erreurs[0]?.message);
  const n = (await q(`select count(*)::int n from linkedin_connexion_demandes where organization_id = $1`, [m.org])).rows[0].n;
  check('1c. une seule ligne en base', n === 1, String(n));
  const audit = (await q(`select count(*)::int n from audit_events where organization_id = $1 and action = 'linkedin.connexion_demandee' and actor_id = $2`, [m.org, m.user])).rows[0].n;
  check('1d. une ligne d\'audit pour la demande aboutie (qui, quand)', audit === 1, String(audit));
}

async function fermeture() {
  console.log('\n3. trois échecs d\'affilée ferment le formulaire un quart d\'heure');
  const tente = async (m) => erreurDe(() => demanderConnexion(m.ctx, secrets));
  let m = await monde();
  for (const motif of ['refuse', 'defi', 'delai']) await demande(m, 'echec', { motif, majIlYa: 60 });
  let e = await tente(m);
  check('3. trois échecs récents : refusé, avec l\'heure de réouverture', e instanceof ErreurFormulaireFerme && e.rouvreA > new Date(Date.now() + 10 * 60_000), e?.message);
  check('3a. rien n\'a été créé', (await q(`select count(*)::int n from linkedin_connexion_demandes where organization_id = $1 and statut = 'demandee'`, [m.org])).rows[0].n === 0);

  m = await monde();
  for (const motif of ['refuse', 'defi']) await demande(m, 'echec', { motif, majIlYa: 60 });
  check('3a. deux échecs seulement : le formulaire reste ouvert', (await tente(m)) === null);

  m = await monde();
  await demande(m, 'echec', { motif: 'refuse', majIlYa: 60 });
  await demande(m, 'echec', { motif: 'worker_absent', majIlYa: 50 });
  await demande(m, 'echec', { motif: 'annulee', majIlYa: 40 });
  await demande(m, 'echec', { motif: 'verrou_occupe', majIlYa: 30 });
  check('3b. ce qui n\'a pas atteint LinkedIn (worker absent, annulée, verrou) ne compte pas', (await tente(m)) === null);

  m = await monde();
  await demande(m, 'echec', { motif: 'refuse', majIlYa: 90 });
  await demande(m, 'echec', { motif: 'refuse', majIlYa: 80 });
  await demande(m, 'reussi', { majIlYa: 70 });
  await demande(m, 'echec', { motif: 'refuse', majIlYa: 60 });
  check('3c. un succès rompt la série (« d\'affilée »)', (await tente(m)) === null);

  m = await monde();
  for (const motif of ['refuse', 'defi', 'delai']) await demande(m, 'echec', { motif, majIlYa: 16 * 60 });
  check('3d. trois échecs vieux de plus d\'un quart d\'heure : le formulaire est rouvert', (await tente(m)) === null);

  const autre = await monde();
  const fermee = await monde();
  for (const motif of ['refuse', 'defi', 'delai']) await demande(fermee, 'echec', { motif, majIlYa: 60 });
  check('3e. la fermeture d\'une organisation ne ferme pas les autres', (await tente(autre)) === null);
}

async function workerAbsent() {
  console.log('\n4. worker absent : tranché par la lecture de l\'écran');
  const m = await monde();
  const vieille = await demande(m, 'demandee', { ageSecondes: 20 });
  const d = await lireDemandeEnCours(m.ctx);
  const l = await ligne(vieille);
  check('4. demandee depuis 20 s sans accusé : echec / worker_absent', l.statut === 'echec' && l.motif === 'worker_absent' && d?.motif === 'worker_absent', JSON.stringify(l));

  const m2 = await monde();
  const recente = await demande(m2, 'demandee', { ageSecondes: 10 });
  await lireDemandeEnCours(m2.ctx);
  check('4b. demandee depuis 10 s : encore en attente', (await ligne(recente)).statut === 'demandee');

  const m3 = await monde();
  const accusee = await demande(m3, 'demandee', { ageSecondes: 20, etape: 'recue' });
  await lireDemandeEnCours(m3.ctx);
  check('4c. demandee depuis 20 s MAIS accusée par le worker (ouverture lente) : jamais jugée sans worker', (await ligne(accusee)).statut === 'demandee');

  const m4 = await monde();
  const code = await demande(m4, 'code_demande', { ageSecondes: 200 });
  await lireDemandeEnCours(m4.ctx);
  check('4d. une demande déjà au défi n\'est pas touchée', (await ligne(code)).statut === 'code_demande');

  const m5 = await monde();
  const voisine = await demande(m5, 'demandee', { ageSecondes: 20 });
  await lireDemandeEnCours(m3.ctx);
  check('4e. la lecture d\'une organisation ne ferme pas la demande d\'une autre', (await ligne(voisine)).statut === 'demandee');

  const m6 = await monde();
  check('4f. aucune demande : rien à montrer', (await lireDemandeEnCours(m6.ctx)) === null);
  const fini = await demande(m6, 'echec', { motif: 'refuse', majIlYa: 600 });
  check('4g. un échec vieux de 10 min n\'est plus montré', (await lireDemandeEnCours(m6.ctx)) === null && fini !== null);
}

async function annulation() {
  console.log('\n5. annulation');
  const m = await monde();
  const id = await demande(m, 'navigateur_ouvert');
  await annulerConnexion(m.ctx, id);
  const l = await ligne(id);
  check('5. annulerConnexion pose echec / annulee', l.statut === 'echec' && l.motif === 'annulee', JSON.stringify(l));

  const m2 = await monde();
  const etrangere = await demande(m2, 'navigateur_ouvert');
  await annulerConnexion(m.ctx, etrangere);
  check('5b. on n\'annule pas la demande d\'une autre organisation', (await ligne(etrangere)).statut === 'navigateur_ouvert');

  const reussie = await demande(m2, 'reussi');
  await annulerConnexion(m2.ctx, reussie);
  check('5c. une demande réussie n\'est pas écrasée par une annulation tardive', (await ligne(reussie)).statut === 'reussi');
  check('5d. relancer l\'annulation est sans erreur', (await erreurDe(() => annulerConnexion(m.ctx, id))) === null);
}

async function expiration() {
  console.log('\n6. une demande abandonnée ne bloque pas la suivante');
  const m = await monde();
  const abandonnee = await demande(m, 'navigateur_ouvert', { ageSecondes: 1000, expireDans: -100 });
  const e = await erreurDe(() => demanderConnexion(m.ctx, secrets));
  check('6. expirée : la nouvelle demande passe, sans attendre la purge', e === null, e?.message);
  const l = await ligne(abandonnee);
  check('6b. l\'ancienne est close en delai', l.statut === 'echec' && l.motif === 'delai', JSON.stringify(l));
}

async function defi() {
  console.log('\n7. répondre à un défi');
  const m = await monde();
  const id = await demande(m, 'navigateur_ouvert');
  check('7. pas de défi en cours : refusé', (await erreurDe(() => repondreDefi(m.ctx, id, '123456'))) instanceof ErreurAucunCodeAttendu);
  await q(`update linkedin_connexion_demandes set statut = 'code_demande' where id = $1`, [id]);
  check('7b. au défi : accepté', (await erreurDe(() => repondreDefi(m.ctx, id, '123456'))) === null);
  const autre = await monde();
  check('7c. une autre organisation ne peut pas répondre à cette demande', (await erreurDe(() => repondreDefi(autre.ctx, id, '123456'))) instanceof ErreurAucunCodeAttendu);
  await q(`update linkedin_connexion_demandes set expires_at = now() - interval '1 second' where id = $1`, [id]);
  check('7d. défi expiré : refusé', (await erreurDe(() => repondreDefi(m.ctx, id, '123456'))) instanceof ErreurAucunCodeAttendu);
}

async function reponseDuWorker() {
  console.log('\n8. le worker clôt toujours la demande');
  const message = (m, id) => ({ type: 'secrets', demandeId: id, organizationId: m.org, ...secrets });
  const lancer = (m, id, connecter) => traiterMessageConnexion(pool, message(m, id), { connecter });
  const fausses = { dependances: undefined };
  void fausses;

  let m = await monde();
  let id = await demande(m, 'demandee');
  await lancer(m, id, async () => { throw new Error(`Chromium a planté ${secrets.motDePasse}`); });
  let l = await ligne(id);
  check('8. exception inattendue : echec / erreur_interne (l\'écran ne reste pas figé)', l.statut === 'echec' && l.motif === 'erreur_interne', JSON.stringify(l));

  m = await monde();
  id = await demande(m, 'demandee');
  await lancer(m, id, async () => 1);
  l = await ligne(id);
  check('8b. la connexion rend la main sans issue : clôturée, pas laissée en cours', l.statut === 'echec' && l.motif === 'erreur_interne', JSON.stringify(l));

  m = await monde();
  id = await demande(m, 'demandee');
  await lancer(m, id, async () => { await q(`update linkedin_connexion_demandes set statut='echec', motif='annulee' where id=$1`, [id]); throw new Error('x'); });
  l = await ligne(id);
  check('8c. une annulation, ou un motif précis déjà posé, n\'est jamais écrasé par le repli', l.motif === 'annulee', JSON.stringify(l));

  m = await monde();
  id = await demande(m, 'demandee');
  const autreOrg = await monde();
  let appele = false;
  await traiterMessageConnexion(pool, { ...message(m, id), organizationId: autreOrg.org }, { connecter: async () => { appele = true; return 0; } });
  check('8d. un message qui vise une autre organisation que celle de la demande ne pilote rien', appele === false && (await ligne(id)).statut === 'demandee');

  m = await monde();
  id = await demande(m, 'demandee');
  await traiterMessageConnexion(pool, message(m, id), { connecter: async () => 1 });
  const audit = (await q(`select diff from audit_events where organization_id = $1 and action = 'linkedin.connexion_terminee'`, [m.org])).rows;
  check('8e. l\'issue laisse une ligne d\'audit (qui, résultat)', audit.length === 1 && audit[0].diff.motif === 'erreur_interne', JSON.stringify(audit));

  m = await monde();
  id = await demande(m, 'demandee');
  const acc = await q(SQL_ACCUSER_RECEPTION, [id]);
  check('8f. l\'accusé de réception pose l\'étape `recue` (pas « navigateur ouvert ») sans changer le statut',
    (await ligne(id)).etape === 'recue' && (await ligne(id)).statut === 'demandee');
  check('8g0. le premier accusé touche exactement une ligne', acc.rowCount === 1);
  const acc2 = await q(SQL_ACCUSER_RECEPTION, [id]);
  await q(`update linkedin_connexion_demandes set statut = 'echec', motif = 'annulee', etape = null where id = $1`, [id]);
  const acc3 = await q(SQL_ACCUSER_RECEPTION, [id]);
  check('8g. accusé déjà posé : 0 ligne ; demande annulée : 0 ligne', acc2.rowCount === 0 && acc3.rowCount === 0, `${acc2.rowCount}/${acc3.rowCount}`);

  m = await monde();
  id = await demande(m, 'demandee');
  let piloter = false;
  await q(`update linkedin_connexion_demandes set statut = 'echec', motif = 'annulee' where id = $1`, [id]);
  await traiterMessageConnexion(pool, message(m, id), { connecter: async () => { piloter = true; return 0; } });
  check('8h. une demande annulée avant l\'accusé ne pilote aucun navigateur', piloter === false);

  // Accusé déjà posé (message reçu deux fois) : l'accusé ne touche aucune ligne, rien n'est piloté.
  m = await monde();
  id = await demande(m, 'demandee', { etape: 'recue' });
  piloter = false;
  await traiterMessageConnexion(pool, message(m, id), { connecter: async () => { piloter = true; return 0; } });
  check('8h2. un accusé qui ne touche aucune ligne (rowCount 0) ne pilote aucun navigateur', piloter === false);

  // Deux demandes dans le même processus : la seconde est close en verrou_occupe (un seul navigateur).
  m = await monde();
  const encours = await demande(m, 'demandee');
  let liberer;
  const bloquee = new Promise((r) => (liberer = r));
  const p1 = traiterMessageConnexion(pool, message(m, encours), { connecter: () => bloquee.then(() => 1) });
  await new Promise((r) => setTimeout(r, 300));
  // Autre organisation : l'index unique n'empêche pas une seconde demande ailleurs, le worker n'a qu'un navigateur.
  const m2 = await monde();
  const seconde = await demande(m2, 'demandee');
  await traiterMessageConnexion(pool, message(m2, seconde), { connecter: async () => 0 });
  const ls = await ligne(seconde);
  check('8i. une seconde demande pendant une connexion est close en verrou_occupe', ls.statut === 'echec' && ls.motif === 'verrou_occupe', JSON.stringify(ls));
  liberer();
  await p1;

  // Annulation entre l'activation de la session et la ligne « Session LinkedIn active. ».
  m = await monde();
  id = await demande(m, 'demandee');
  await traiterMessageConnexion(pool, message(m, id), {
    connecter: async (ctx) => {
      await activerSessionLinkedIn(ctx, '203.0.113.9');
      await q(`update linkedin_connexion_demandes set statut = 'echec', motif = 'annulee', etape = null where id = $1`, [id]);
      return 0;
    },
  });
  const sess = await lireSessionLinkedIn({ ex: pool, organisationId: m.org, utilisateurId: null, role: null });
  check('8j. annulée juste après l\'activation : la session est révoquée, pas laissée connectée', sess?.etat === 'bloquee' && sess.motif === 'revoquee', JSON.stringify(sess));
  check('8k. et la demande reste « annulee »', (await ligne(id)).motif === 'annulee');

  m = await monde();
  id = await demande(m, 'demandee');
  await traiterMessageConnexion(pool, message(m, id), {
    connecter: async (ctx, d) => { await activerSessionLinkedIn(ctx, '203.0.113.9'); d.ecrire('Session LinkedIn active.'); return 0; },
  });
  const sess2 = await lireSessionLinkedIn({ ex: pool, organisationId: m.org, utilisateurId: null, role: null });
  check('8l. connexion menée à terme : demande reussi, session active (rien n\'est révoqué)', (await ligne(id)).statut === 'reussi' && sess2?.etat === 'active', JSON.stringify(sess2));
}

async function redemarrage() {
  console.log('\n9b. un redémarrage du worker ne fige pas l\'écran');
  const m = await monde();
  const code = await demande(m, 'code_demande', { ageSecondes: 120 });
  const ouvert = await demande(await monde(), 'navigateur_ouvert', { ageSecondes: 60 });
  const fini = await demande(await monde(), 'reussi');
  const n = await cloreDemandesOrphelines(pool);
  const l = await ligne(code);
  check('9b. au démarrage, une demande au défi non expirée est close en worker_absent', l.statut === 'echec' && l.motif === 'worker_absent', JSON.stringify(l));
  check('9b2. navigateur_ouvert aussi ; une demande réussie est intacte', (await ligne(ouvert)).motif === 'worker_absent' && (await ligne(fini)).statut === 'reussi');
  check('9b3. l\'organisation peut relancer tout de suite', (await erreurDe(() => demanderConnexion(m.ctx, secrets))) === null && n >= 2);
}

async function purge() {
  console.log('\n9. la purge périodique du worker');
  const m = await monde();
  const abandonnee = await demande(m, 'code_demande', { ageSecondes: 2000, expireDans: -100 });
  const vieille = await demande(m, 'echec', { motif: 'refuse', majIlYa: 25 * 3600 });
  const recente = await demande(m, 'echec', { motif: 'refuse', majIlYa: 3600 });
  await q(SQL_PURGER);
  const l = await ligne(abandonnee);
  check('9. une demande abandonnée passe en echec / delai', l.statut === 'echec' && l.motif === 'delai', JSON.stringify(l));
  check('9b. un résultat de plus de 24 h est supprimé, un récent reste', (await ligne(vieille)) === undefined && (await ligne(recente)) !== undefined);
  check('9c. l\'organisation peut relancer une connexion', (await erreurDe(() => demanderConnexion(m.ctx, secrets))) === null);
}

async function roles() {
  console.log('\n10. les rôles, sur la vraie base');
  const m = await monde('viewer');
  const e = await erreurDe(() => demanderConnexion(m.ctx, secrets));
  check('10. un viewer ne crée aucune demande', e?.name === 'ForbiddenError' && (await q(`select count(*)::int n from linkedin_connexion_demandes where organization_id = $1`, [m.org])).rows[0].n === 0);
}

for (const s of [uneSeuleEnCours, fermeture, workerAbsent, annulation, expiration, defi, reponseDuWorker, redemarrage, purge, roles]) {
  try { await s(); } catch (e) { failures += 1; console.log(`  FAIL section ${s.name} a levé : ${e.stack ?? e.message}`); }
}
oublierConnexionsEnCours();
console.log(`\n[linkedin-connexion-actions] ${failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`}`);
await pool.end();
process.exit(failures === 0 ? 0 : 1);
