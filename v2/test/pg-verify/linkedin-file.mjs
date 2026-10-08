// Lot 4b, tâche 3 : exécution RÉELLE, sur Postgres, du SQL de la file d'actions
// LinkedIn portée dans le cœur (reclamerProchaineAction, enregistrerResultat,
// mettreEnPauseEnvoiLinkedIn). Aucun appel LinkedIn.
//
// Mutations qui font rougir :
//   1. file.ts : `q.method = 'serveur'` -> `'extension_auto'` : 1 et 2 rougissent.
//   2. file.ts : retirer `camp.status = 'active'` : 3 rougit.
//   3. file.ts : renommer `envoi_pause_jusqua` : 4 et 5 rougissent (colonne inconnue).
//   4. file.ts : retirer `and status = 'processing'` de la mise a jour de resultat : 7 rougit.
//   8. file.ts : remettre le requeue apres les refus de session/pause : 10 rougit.
//   7. file.ts : retirer le refus `session_inactive` : 9 rougit.
//   6. file.ts : retirer `greatest` de la mise en pause : 8 rougit.
//   5. file.ts : retirer le requeue : 6 rougit.
//   9. file.ts : retirer `and status = 'processing'` de remettreActionEnAttente : 11 rougit.
//  10. file.ts : inverser `comptee` (decrement/plafond) : 11 et 12 rougissent.
//  12. file.ts : un seul UPDATE de requeue pour les deux methodes : 6 et 10 rougissent.
//  13. file.ts : retirer `dansUneTransaction` de enregistrerResultat : 17a rougit (ligne `sent` sans action marquee partie).
//  14. file.ts : retirer `q.scheduled_for <= now()`, le filtre de campagne ou la pause de la sonde : 16a, 16b, 16c rougissent.
//  15. migration 20261007120000 : reprendre l'ancien predicat : 18a, 18c et 18d rougissent.
//  16. file.ts : retirer le filtre `method = 'serveur'` ou la coupure de dix minutes de `prochainEnvoiLinkedIn` : 19c, 19d rougissent ;
//      retirer la branche `perimees` : 19d rougit ; faire rendre `quand` sans attendre l intervalle : 19e rougit.
//  17. file.ts : retirer `group by kind` ou le filtre sur le type du compteur (retour au compteur commun) :
//      20a, 20b, 20d rougissent ; relire `weekly_cap` de linkedin_settings : 20e rougit.
//  18. reglages-envoi.ts : remettre 8 / 21 dans un site de repli (file.ts, pacing.ts, expediteurs.ts) : 20f rougit.
//  19. file.ts : retirer le contrôle du budget horaire de prochainEnvoiLinkedIn : 21a, 21b, 21c rougissent ;
//      changer le seuil (REQUETES_PAR_ENVOI) ou le calcul de la date : 21c, 21d rougissent.
//  20. migration 20261008100000 : retirer l'insert, ou en fausser la valeur : 22a, 22b, 22d rougissent ; 22e prouve que la
//      vérification interne lève.
//  11. plafonds.ts : retirer `q.organization_id = $1` de tracerEnvoiLinkedIn : 13 rougit.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { seededRandom } from './_lkpace.mjs';
import { prochainEnvoiLinkedIn, reparerLignesCoincees, existeActionServeurEnAttente, reclamerProchaineAction, enregistrerResultat, mettreEnPauseEnvoiLinkedIn, remettreActionEnAttente } from './_lkf.mjs';
import { tracerEnvoiLinkedIn, compterRequetesLinkedIn } from './_lkp.mjs';
import { enqueueAction } from './_lkq.mjs';
import { enqueueLinkedInAction } from './_lkd.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

// Mardi 15/09/2026 12:00 Paris : dans la fenetre par defaut, en semaine.
const NOW = new Date('2026-09-15T10:00:00.000Z');
const AVANT = new Date(NOW.getTime() - 60 * 60_000).toISOString();

let org;
let seq = 0;

async function remettreAZero({ sansSession = false } = {}) {
  await q('delete from linkedin_action_queue where organization_id = $1', [org]);
  await q('delete from linkedin_server_sessions where organization_id = $1', [org]);
  await q('delete from linkedin_settings where organization_id = $1', [org]);
  await q(`delete from organization_settings where organization_id = $1 and key like 'linkedin_%'`, [org]);
  await q('delete from linkedin_requetes where organization_id = $1', [org]);
  // Le canal n'est disponible que si la session est `active` : par defaut, une l'est.
  if (!sansSession) await q(`insert into linkedin_server_sessions (organization_id, status) values ($1, 'active')`, [org]);
}
async function ligne(method, extra = {}) {
  seq += 1;
  const r = await q(
    `insert into linkedin_action_queue (organization_id, linkedin_url, kind, method, status, scheduled_for, processing_started_at, action_id)
     values ($1, $2, $8, $3, $4, $5, $6, $7) returning id`,
    [
      org,
      `https://www.linkedin.com/in/fictif-${seq}`,
      method,
      extra.status ?? 'pending',
      extra.scheduledFor ?? AVANT,
      extra.processingStartedAt ?? null,
      extra.actionId ?? null,
      extra.kind ?? 'invite',
    ],
  );
  return r.rows[0].id;
}
const statut = async (id) => (await q('select status from linkedin_action_queue where id = $1', [id])).rows[0].status;

async function campagneAvecAction(statutCampagne) {
  seq += 1;
  const c = (await q(`insert into contacts (organization_id) values ($1) returning id`, [org])).rows[0].id;
  const camp = (
    await q(`insert into campaigns (organization_id, name, status) values ($1, $2, $3) returning id`, [
      org,
      `Camp ${seq}`,
      statutCampagne,
    ])
  ).rows[0].id;
  const en = (
    await q(`insert into enrollments (organization_id, campaign_id, contact_id) values ($1, $2, $3) returning id`, [
      org,
      camp,
      c,
    ])
  ).rows[0].id;
  const act = (
    await q(
      `insert into actions (organization_id, enrollment_id, channel, idempotency_key)
       values ($1, $2, 'linkedin_invite', $3) returning id`,
      [org, en, `cle-${seq}-${Date.now()}-${Math.random()}`],
    )
  ).rows[0].id;
  return act;
}

async function serveur_reclamee_et_passee_en_processing() {
  console.log('\n[lkf] 1. method = serveur reclamee et passee en processing');
  const idServeur = await ligne('serveur');
  const r1 = await reclamerProchaineAction(pool, org, NOW);
  check('action reclamee', r1.action?.id === idServeur, r1.motif ?? '');
  check('ligne en processing', (await statut(idServeur)) === 'processing');
  const att = (await q('select attempts, processing_started_at from linkedin_action_queue where id = $1', [idServeur])).rows[0];
  check('attempts = 1 et processing_started_at pose', att.attempts === 1 && att.processing_started_at !== null);
}

async function extension_auto_jamais_reclamee() {
  console.log('\n[lkf] 2. method = extension_auto jamais reclamee');
  await remettreAZero();
  const idExt = await ligne('extension_auto');
  const r2 = await reclamerProchaineAction(pool, org, NOW);
  check('file vide pour le serveur', r2.action === null && r2.motif === 'queue_empty', r2.motif ?? '');
  check('ligne extension_auto intacte', (await statut(idExt)) === 'pending');
}

async function campagne_non_active_non_reclamee() {
  console.log('\n[lkf] 3. campagne non active : non reclamee ; active : reclamee');
  await remettreAZero();
  const actPause = await campagneAvecAction('paused');
  const idPause = await ligne('serveur', { actionId: actPause });
  const r3 = await reclamerProchaineAction(pool, org, NOW);
  check('campagne en pause : rien', r3.action === null && r3.motif === 'queue_empty', r3.motif ?? '');
  check('ligne restee pending', (await statut(idPause)) === 'pending');
  await q(`update campaigns set status = 'active' where id = (select e.campaign_id from actions a join enrollments e on e.id = a.enrollment_id where a.id = $1)`, [actPause]);
  const r3b = await reclamerProchaineAction(pool, org, NOW);
  check('campagne relancee : reclamee', r3b.action?.id === idPause, r3b.motif ?? '');
}

async function pause_active_refuse_la_reclamation() {
  console.log('\n[lkf] 4. pause active : refus');
  await remettreAZero();
  const idPauseCanal = await ligne('serveur');
  const jusqua = new Date(NOW.getTime() + 30 * 60_000);
  await mettreEnPauseEnvoiLinkedIn(pool, org, jusqua);
  const ecrit = (await q('select envoi_pause_jusqua from linkedin_server_sessions where organization_id = $1', [org])).rows[0].envoi_pause_jusqua;
  check('echeance ecrite en base', new Date(ecrit).getTime() === jusqua.getTime());
  const r4 = await reclamerProchaineAction(pool, org, NOW);
  check('canal_en_pause', r4.action === null && r4.motif === 'canal_en_pause', r4.motif ?? '');
  check('ligne intacte', (await statut(idPauseCanal)) === 'pending');
}

async function pause_echue_laisse_passer() {
  console.log('\n[lkf] 5. pause echue : la reclamation passe');
  await remettreAZero();
  const idPauseCanal = await ligne('serveur');
  const jusqua = new Date(NOW.getTime() + 30 * 60_000);
  await mettreEnPauseEnvoiLinkedIn(pool, org, jusqua);
  const r5 = await reclamerProchaineAction(pool, org, new Date(jusqua.getTime() + 1000));
  check('reclamee apres l echeance', r5.action?.id === idPauseCanal, r5.motif ?? '');
}

async function ligne_coincee_requeue_apres_dix_minutes() {
  console.log('\n[lkf] 6. ligne coincee en processing');
  await remettreAZero();
  const idRecent = await ligne('serveur', { status: 'processing', processingStartedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() });
  const r6a = await reclamerProchaineAction(pool, org, NOW);
  check('serveur coincee depuis 5 min : pas reclamable', r6a.action === null && r6a.motif === 'queue_empty', r6a.motif ?? '');
  check('reste en processing', (await statut(idRecent)) === 'processing');
  await q(`update linkedin_action_queue set processing_started_at = $2 where id = $1`, [idRecent, new Date(NOW.getTime() - 11 * 60_000).toISOString()]);
  const r6b = await reclamerProchaineAction(pool, org, NOW);
  // L'action a pu partir : elle n'est JAMAIS reclamee a nouveau (double envoi).
  const l6 = (await q('select status, error_code, error_message from linkedin_action_queue where id = $1', [idRecent])).rows[0];
  check('serveur coincee depuis 11 min : jamais reclamee, statut terminal resultat_indetermine', r6b.action === null && l6.status === 'failed' && l6.error_code === 'resultat_indetermine' && l6.error_message !== null, JSON.stringify(l6));
  const idExt = await ligne('extension_auto', { status: 'processing', processingStartedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() });
  await reclamerProchaineAction(pool, org, NOW);
  check('extension_auto coincee depuis 5 min : reste processing', (await statut(idExt)) === 'processing');
  await q(`update linkedin_action_queue set processing_started_at = $2 where id = $1`, [idExt, new Date(NOW.getTime() - 11 * 60_000).toISOString()]);
  await reclamerProchaineAction(pool, org, NOW);
  check('extension_auto coincee depuis 11 min : remise pending comme avant', (await statut(idExt)) === 'pending');
}

async function resultat_seulement_depuis_processing() {
  console.log('\n[lkf] 7. enregistrement : transition depuis processing seulement');
  await remettreAZero();
  const idPending = await ligne('serveur');
  check('pending -> refuse', (await enregistrerResultat(pool, { organizationId: org, queueId: idPending, status: 'sent', now: NOW })) === false);
  check('toujours pending', (await statut(idPending)) === 'pending');
  const actSent = await campagneAvecAction('active');
  const idProc = await ligne('serveur', { status: 'processing', processingStartedAt: AVANT, actionId: actSent });
  check('processing -> sent accepte', (await enregistrerResultat(pool, { organizationId: org, queueId: idProc, status: 'sent', now: NOW })) === true);
  const fin = (await q('select status, sent_at from linkedin_action_queue where id = $1', [idProc])).rows[0];
  check('statut sent et sent_at pose', fin.status === 'sent' && fin.sent_at !== null);
  const apres = (await q('select a.status as action_status, a.dispatched_at is not null as parti from actions a where a.id = $1', [actSent])).rows[0];
  check('mark_action_dispatched a joue', apres.parti === true, JSON.stringify(apres));
  check('rejeu refuse', (await enregistrerResultat(pool, { organizationId: org, queueId: idProc, status: 'sent', now: NOW })) === false);
  const idEchec = await ligne('serveur', { status: 'processing', processingStartedAt: AVANT });
  check('processing -> failed accepte', (await enregistrerResultat(pool, { organizationId: org, queueId: idEchec, status: 'failed', errorCode: 'x', now: NOW })) === true);
  check('statut failed, sent_at nul', (await q(`select status = 'failed' and sent_at is null as ok from linkedin_action_queue where id = $1`, [idEchec])).rows[0].ok);
  const autreOrg = (await q(`insert into organizations (name, slug) values ('Autre', 'autre-' || gen_random_uuid()) returning id`)).rows[0].id;
  const idAutre = await ligne('serveur', { status: 'processing', processingStartedAt: AVANT });
  check('autre organisation : refuse', (await enregistrerResultat(pool, { organizationId: autreOrg, queueId: idAutre, status: 'sent', now: NOW })) === false);
}

async function pause_ne_se_raccourcit_pas_et_dit_quand_rien_n_est_pose() {
  console.log('\n[lkf] 8. une pause plus courte ne raccourcit pas une pause deja posee');
  await remettreAZero({ sansSession: true });
  const sansSession = await mettreEnPauseEnvoiLinkedIn(pool, org, new Date(NOW.getTime() + 60_000));
  check('sans ligne de session : rend false', sansSession === false);
  await q(`insert into linkedin_server_sessions (organization_id, status) values ($1, 'active')`, [org]);
  const longue = new Date(NOW.getTime() + 22 * 60 * 60_000);
  const courte = new Date(NOW.getTime() + 60 * 60_000);
  check('premiere pause posee : rend true', (await mettreEnPauseEnvoiLinkedIn(pool, org, longue)) === true);
  await mettreEnPauseEnvoiLinkedIn(pool, org, courte);
  const lue = (await q('select envoi_pause_jusqua from linkedin_server_sessions where organization_id = $1', [org])).rows[0].envoi_pause_jusqua;
  check('pause plus courte : echeance inchangee en base', new Date(lue).getTime() === longue.getTime(), new Date(lue).toISOString());
  const plusLongue = new Date(longue.getTime() + 60 * 60_000);
  await mettreEnPauseEnvoiLinkedIn(pool, org, plusLongue);
  const lue2 = (await q('select envoi_pause_jusqua from linkedin_server_sessions where organization_id = $1', [org])).rows[0].envoi_pause_jusqua;
  check('pause plus lointaine : echeance repoussee', new Date(lue2).getTime() === plusLongue.getTime());
}

async function session_non_active_refuse_la_reclamation() {
  console.log('\n[lkf] 9. une session bloquee ou absente refuse, ligne intacte');
  await remettreAZero();
  const id = await ligne('serveur');
  await q(`update linkedin_server_sessions set status = 'bloquee', blocked_at = now(), blocked_reason = 'defi' where organization_id = $1`, [org]);
  const r = await reclamerProchaineAction(pool, org, NOW);
  check('session bloquee : session_inactive', r.action === null && r.motif === 'session_inactive', r.motif ?? '');
  const ap = (await q('select status, attempts, processing_started_at from linkedin_action_queue where id = $1', [id])).rows[0];
  check('ligne restee pending, attempts inchange', ap.status === 'pending' && ap.attempts === 0 && ap.processing_started_at === null, JSON.stringify(ap));
  await q('delete from linkedin_server_sessions where organization_id = $1', [org]);
  const r2 = await reclamerProchaineAction(pool, org, NOW);
  check('aucune ligne de session : session_inactive', r2.action === null && r2.motif === 'session_inactive', r2.motif ?? '');
  await q(`insert into linkedin_server_sessions (organization_id, status) values ($1, 'active')`, [org]);
  const r3 = await reclamerProchaineAction(pool, org, NOW);
  check('session active : reclamee', r3.action?.id === id, r3.motif ?? '');
}

async function requeue_passe_avant_les_refus_de_session() {
  console.log('\n[lkf] 10. session bloquee : la ligne coincee est quand meme remise en file');
  await remettreAZero();
  const id = await ligne('extension_auto', { status: 'processing', processingStartedAt: new Date(NOW.getTime() - 11 * 60_000).toISOString() });
  const idServeur = await ligne('serveur', { status: 'processing', processingStartedAt: new Date(NOW.getTime() - 11 * 60_000).toISOString() });
  await q(`update linkedin_server_sessions set status = 'bloquee', blocked_at = now(), blocked_reason = 'defi' where organization_id = $1`, [org]);
  const r = await reclamerProchaineAction(pool, org, NOW);
  check('session bloquee : session_inactive', r.action === null && r.motif === 'session_inactive', r.motif ?? '');
  const ap = (await q('select status, processing_started_at from linkedin_action_queue where id = $1', [id])).rows[0];
  check('ligne coincee repassee pending, processing_started_at nul', ap.status === 'pending' && ap.processing_started_at === null, JSON.stringify(ap));
  check('ligne serveur coincee : terminale meme session bloquee, jamais pending', (await statut(idServeur)) === 'failed');
}

async function remise_en_attente_ne_rouvre_que_processing_et_borne_les_tentatives() {
  await remettreAZero();
  const ex = { organizationId: org };
  // 11. Seule une ligne `processing` bouge ; une ligne `sent` ou `failed` n'est jamais rouverte.
  const envoyee = await ligne('serveur', { status: 'sent' });
  const echouee = await ligne('serveur', { status: 'failed' });
  const r1 = await remettreActionEnAttente(pool, org, envoyee, { comptee: true });
  const r2 = await remettreActionEnAttente(pool, org, echouee, { comptee: false });
  check('11. une ligne sent ou failed n est jamais rouverte', r1 === null && r2 === null && (await statut(envoyee)) === 'sent' && (await statut(echouee)) === 'failed');
  // 12. Tentative rendue (comptee: false) : attempts redescend, jamais sous zero, pas de plafond.
  const a = await ligne('serveur', { status: 'processing', processingStartedAt: AVANT });
  await q('update linkedin_action_queue set attempts = 5 where id = $1', [a]);
  const r3 = await remettreActionEnAttente(pool, org, a, { comptee: false, maxTentatives: 3 });
  const la = (await q('select status, attempts, error_code, processing_started_at from linkedin_action_queue where id = $1', [a])).rows[0];
  check('12a. comptee false : pending, tentative rendue, jamais abandonnee', r3 === 'pending' && la.status === 'pending' && la.attempts === 4 && la.error_code === null && la.processing_started_at === null, JSON.stringify(la));
  const z = await ligne('serveur', { status: 'processing', processingStartedAt: AVANT });
  await remettreActionEnAttente(pool, org, z, { comptee: false });
  check('12b. attempts ne passe jamais sous zero', (await q('select attempts from linkedin_action_queue where id = $1', [z])).rows[0].attempts === 0);
  // Tentative comptee : sous le plafond -> pending ; au plafond -> failed / trop_de_tentatives.
  const b = await ligne('serveur', { status: 'processing', processingStartedAt: AVANT });
  await q('update linkedin_action_queue set attempts = 2 where id = $1', [b]);
  await remettreActionEnAttente(pool, org, b, { comptee: true, maxTentatives: 3 });
  const c = await ligne('serveur', { status: 'processing', processingStartedAt: AVANT });
  await q('update linkedin_action_queue set attempts = 3 where id = $1', [c]);
  await remettreActionEnAttente(pool, org, c, { comptee: true, maxTentatives: 3 });
  const lc = (await q('select status, error_code, error_message from linkedin_action_queue where id = $1', [c])).rows[0];
  check('12c. comptee true : sous le plafond pending, au plafond failed', (await statut(b)) === 'pending' && lc.status === 'failed' && lc.error_code === 'trop_de_tentatives' && lc.error_message !== null, JSON.stringify(lc));
  // Une autre organisation ne peut pas remettre cette ligne.
  const org2 = (await q(`insert into organizations (name, slug) values ('Autre', 'autre-' || gen_random_uuid()) returning id`)).rows[0].id;
  const d = await ligne('serveur', { status: 'processing', processingStartedAt: AVANT });
  const rautre = await remettreActionEnAttente(pool, org2, d, { comptee: true });
  check('12d. une autre organisation ne peut pas remettre la ligne', !rautre && (await statut(d)) === 'processing');
  void ex;
}

async function sonde_file_vide() {
  console.log('\n[lkf] 14. sonde : y a-t-il une action serveur en attente');
  await remettreAZero();
  check('file vide : false', (await existeActionServeurEnAttente(pool, org)) === false);
  await ligne('extension_auto');
  await ligne('serveur', { status: 'processing', processingStartedAt: AVANT });
  await ligne('serveur', { status: 'sent' });
  check('ni extension, ni processing, ni sent : false', (await existeActionServeurEnAttente(pool, org)) === false);
  const autre = (await q(`insert into organizations (name, slug) values ('Autre', 'autre3-' || gen_random_uuid()) returning id`)).rows[0].id;
  check('une autre organisation ne voit pas cette file', (await existeActionServeurEnAttente(pool, autre)) === false);
  await ligne('serveur');
  check('une action serveur pending : true', (await existeActionServeurEnAttente(pool, org)) === true);
}

async function nettoyage_sans_reclamation() {
  console.log('\n[lkf] 15. nettoyage seul (file vide) : serveur terminal, extension_auto pending');
  await remettreAZero();
  const vieux = new Date(NOW.getTime() - 11 * 60_000).toISOString();
  const recent = new Date(NOW.getTime() - 5 * 60_000).toISOString();
  const srv = await ligne('serveur', { status: 'processing', processingStartedAt: vieux });
  const srvRecent = await ligne('serveur', { status: 'processing', processingStartedAt: recent });
  const ext = await ligne('extension_auto', { status: 'processing', processingStartedAt: vieux });
  check('AVANT nettoyage : la sonde seule dit file vide et la ligne serveur reste processing', (await existeActionServeurEnAttente(pool, org)) === false && (await statut(srv)) === 'processing');
  await reparerLignesCoincees(pool, org, NOW);
  const l = (await q('select status, error_code from linkedin_action_queue where id = $1', [srv])).rows[0];
  check('serveur coincee : failed / resultat_indetermine sans aucune reclamation', l.status === 'failed' && l.error_code === 'resultat_indetermine', JSON.stringify(l));
  check('serveur recente : intacte', (await statut(srvRecent)) === 'processing');
  check('extension_auto coincee : pending, jamais failed', (await statut(ext)) === 'pending');
  check('la file serveur est vide : la sonde le dit', (await existeActionServeurEnAttente(pool, org)) === false);
}

async function sonde_ne_juge_que_ce_qui_est_pret() {
  console.log('\n[lkf] 16. sonde : echeance, campagne active, pause du canal');
  await remettreAZero();
  const futur = new Date(Date.now() + 3_600_000).toISOString();
  await ligne('serveur', { scheduledFor: futur });
  check('16a. ligne pending a echeance future : false', (await existeActionServeurEnAttente(pool, org)) === false);
  await remettreAZero();
  const actPause = await campagneAvecAction('paused');
  await ligne('serveur', { actionId: actPause });
  check('16b. campagne en pause : false', (await existeActionServeurEnAttente(pool, org)) === false);
  const actOk = await campagneAvecAction('active');
  await ligne('serveur', { actionId: actOk });
  check('16b. campagne active : true', (await existeActionServeurEnAttente(pool, org)) === true);
  await q(`update linkedin_server_sessions set envoi_pause_jusqua = now() + interval '1 hour' where organization_id = $1`, [org]);
  check('16c. canal en pause : false meme avec une ligne prete', (await existeActionServeurEnAttente(pool, org)) === false);
  await q(`update linkedin_server_sessions set envoi_pause_jusqua = now() - interval '1 hour' where organization_id = $1`, [org]);
  check('16c. pause echue : true', (await existeActionServeurEnAttente(pool, org)) === true);
}

/** Un executeur dont le client loue echoue sur `mark_action_dispatched` : la deuxieme des trois ecritures. */
function executeurQuiEchoueSurLaDeuxiemeEcriture() {
  const journal = [];
  return {
    journal,
    ex: {
      query: (sql, v) => pool.query(sql, v),
      connect: async () => {
        const c = await pool.connect();
        return {
          query: (sql, v) => {
            journal.push(String(sql).trim().split(/\s+/).slice(0, 2).join(' '));
            if (/mark_action_dispatched/.test(sql)) return Promise.reject(new Error('interblocage simule'));
            return c.query(sql, v);
          },
          release: () => c.release(),
        };
      },
    },
  };
}

async function sonde_et_reclamation_d_accord_a_l_echeance_limite() {
  console.log('\n[lkf] 16bis. sonde et reclamation lisent la meme horloge, a la limite');
  await remettreAZero();
  await ligne('serveur', { scheduledFor: NOW.toISOString() });
  const avantLimite = new Date(NOW.getTime() - 1);
  check('16d. sonde a T-1ms : false', (await existeActionServeurEnAttente(pool, org, avantLimite)) === false);
  const refus = await reclamerProchaineAction(pool, org, avantLimite);
  check('16d. reclamation a T-1ms : refuse, d accord', refus.action === null && refus.motif === 'queue_empty', refus.motif ?? '');
  check('16e. sonde a T : true', (await existeActionServeurEnAttente(pool, org, NOW)) === true);
  const ok = await reclamerProchaineAction(pool, org, NOW);
  check('16e. reclamation a T : accepte, d accord', ok.action !== null, ok.motif ?? '');
  // Pause : la limite est la meme (strictement apres `maintenant`).
  await remettreAZero();
  await ligne('serveur');
  await q(`update linkedin_server_sessions set envoi_pause_jusqua = $2 where organization_id = $1`, [org, NOW.toISOString()]);
  check('16f. pause finissant exactement a T : sonde true', (await existeActionServeurEnAttente(pool, org, NOW)) === true);
  const r = await reclamerProchaineAction(pool, org, NOW);
  check('16f. pause finissant exactement a T : reclamation accepte aussi', r.action !== null, r.motif ?? '');
  await remettreAZero();
  await ligne('serveur');
  await q(`update linkedin_server_sessions set envoi_pause_jusqua = $2 where organization_id = $1`, [org, new Date(NOW.getTime() + 1).toISOString()]);
  check('16g. pause finissant a T+1ms : sonde false', (await existeActionServeurEnAttente(pool, org, NOW)) === false);
  const r2 = await reclamerProchaineAction(pool, org, NOW);
  check('16g. pause finissant a T+1ms : reclamation refuse aussi', r2.motif === 'canal_en_pause', r2.motif ?? '');
}

async function enregistrement_atomique() {
  console.log('\n[lkf] 17. enregistrerResultat : une transaction, tout ou rien');
  await remettreAZero();
  const act = await campagneAvecAction('active');
  const id = await ligne('serveur', { status: 'processing', processingStartedAt: AVANT, actionId: act });
  const { ex, journal } = executeurQuiEchoueSurLaDeuxiemeEcriture();
  let leve = false;
  try {
    await enregistrerResultat(ex, { organizationId: org, queueId: id, status: 'sent', now: NOW });
  } catch {
    leve = true;
  }
  const l = (await q('select status, sent_at from linkedin_action_queue where id = $1', [id])).rows[0];
  check('17a. la deuxieme ecriture leve : la ligne n est PAS sent, elle reste processing', leve && l.status === 'processing' && l.sent_at === null, JSON.stringify({ leve, ...l, journal }));
  check('17b. rollback joue, aucun commit', journal.includes('rollback') && !journal.includes('commit'), journal.join(','));
  const ok = await enregistrerResultat(pool, { organizationId: org, queueId: id, status: 'sent', now: NOW });
  const apres = (await q('select a.dispatched_at is not null as parti, l.status from actions a, linkedin_action_queue l where a.id = $1 and l.id = $2', [act, id])).rows[0];
  check('17c. la nouvelle tentative aboutit : sent ET action marquee partie', ok && apres.status === 'sent' && apres.parti === true, JSON.stringify(apres));
}

async function indetermine_compte_comme_actif() {
  console.log('\n[lkf] 18. resultat_indetermine : index unique et deduplications');
  await remettreAZero();
  const c = (await q(`insert into contacts (organization_id) values ($1) returning id`, [org])).rows[0].id;
  const insere = (statut, code, kind = 'invite') =>
    q(`insert into linkedin_action_queue (organization_id, contact_id, linkedin_url, kind, method, status, error_code)
       values ($1, $2, 'https://www.linkedin.com/in/fictif-idx', $3, 'serveur', $4, $5)`, [org, c, kind, statut, code]);
  await insere('failed', 'resultat_indetermine');
  let violation = null;
  try {
    await insere('pending', null);
  } catch (e) {
    violation = e.code;
  }
  check('18a. une action pending a cote d une indeterminee viole l index unique', violation === '23505', String(violation));
  let autre = null;
  try {
    await insere('failed', 'profile_not_found');
    await insere('pending', null, 'message');
  } catch (e) {
    autre = e.code;
  }
  check('18b. un autre echec et un autre type restent permis', autre === null, String(autre));
  const web = await enqueueAction(pool, { organizationId: org, contactId: c, linkedinUrl: 'https://www.linkedin.com/in/fictif-idx', kind: 'invite', method: 'extension_auto' });
  check('18c. enqueueAction (web) deduplique sur l indeterminee', web === null, String(web));
  const wk = await enqueueLinkedInAction(pool, { organizationId: org, contactId: c, linkedinUrl: 'https://www.linkedin.com/in/fictif-idx', kind: 'invite', method: 'extension_auto' });
  check('18d. enqueueLinkedInAction (worker) deduplique sur l indeterminee', wk === null, String(wk));
  const c2 = (await q(`insert into contacts (organization_id) values ($1) returning id`, [org])).rows[0].id;
  await q(`insert into linkedin_action_queue (organization_id, contact_id, linkedin_url, kind, method, status, error_code)
           values ($1, $2, 'https://www.linkedin.com/in/fictif-2', 'invite', 'serveur', 'failed', 'bad_request')`, [org, c2]);
  const libre = await enqueueLinkedInAction(pool, { organizationId: org, contactId: c2, linkedinUrl: 'https://www.linkedin.com/in/fictif-2', kind: 'invite', method: 'extension_auto' });
  check('18e. un echec ordinaire ne bloque pas un nouvel enfilement', typeof libre === 'string', String(libre));
}

async function trace_d_envoi_bornee_a_l_organisation() {
  await remettreAZero();
  const id = await ligne('serveur', { status: 'processing', processingStartedAt: AVANT });
  await tracerEnvoiLinkedIn({ ex: pool, organisationId: org }, id);
  const n = (await q('select count(*)::int as n from linkedin_requetes where action_queue_id = $1 and organization_id = $2 and source_run_id is null', [id, org])).rows[0].n;
  check('13a. la trace d envoi pose une ligne rattachee a l action, sans passage de collecte', n === 1, String(n));
  const org2 = (await q(`insert into organizations (name, slug) values ('Autre', 'autre2-' || gen_random_uuid()) returning id`)).rows[0].id;
  let leve = false;
  try {
    await tracerEnvoiLinkedIn({ ex: pool, organisationId: org2 }, id);
  } catch {
    leve = true;
  }
  const n2 = (await q('select count(*)::int as n from linkedin_requetes where action_queue_id = $1', [id])).rows[0].n;
  check('13b. une action d une autre organisation n est pas tracee et leve', leve && n2 === 1, `leve=${leve} n=${n2}`);
}

async function prochain_envoi_sur_vrai_sql() {
  console.log('\n[lkf] 19. prochainEnvoiLinkedIn : la date du job, jugee sur la vraie base');
  await remettreAZero();
  const idPret = await ligne('serveur');
  const r1 = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('19a. une action prete : maintenant', r1.motif === null && r1.quand?.getTime() === NOW.getTime(), JSON.stringify(r1));

  await q('update linkedin_action_queue set status = $2, processing_started_at = $3 where id = $1', [
    idPret,
    'processing',
    new Date(NOW.getTime() - 60_000).toISOString(),
  ]);
  const r2 = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('19b. une action serveur en vol (1 min) : aucun second job', r2.quand === null && r2.motif === 'action_en_cours', JSON.stringify(r2));

  // Une ligne extension en vol ne regarde pas la session du serveur.
  await q('delete from linkedin_action_queue where organization_id = $1', [org]);
  await ligne('extension_auto', { status: 'processing', processingStartedAt: new Date(NOW.getTime() - 60_000).toISOString() });
  await ligne('serveur');
  const r3 = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('19c. une ligne extension en vol ne retient pas un envoi serveur', r3.motif === null, JSON.stringify(r3));

  // Ligne serveur coincee depuis 11 min, rien d autre : un job doit partir pour la reparer.
  await q('delete from linkedin_action_queue where organization_id = $1', [org]);
  await ligne('serveur', { status: 'processing', processingStartedAt: new Date(NOW.getTime() - 11 * 60_000).toISOString() });
  const r4 = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('19d. une ligne coincee depuis 11 min appelle un job (reparation)', r4.motif === null && r4.quand?.getTime() === NOW.getTime(), JSON.stringify(r4));

  // Dernier envoi il y a 30 s : le job est date, jamais maintenant, et jamais plus de 20 min apres.
  await q('delete from linkedin_action_queue where organization_id = $1', [org]);
  await ligne('serveur', { status: 'sent' });
  await q(`update linkedin_action_queue set sent_at = $2 where organization_id = $1 and status = 'sent'`, [
    org,
    new Date(NOW.getTime() - 30_000).toISOString(),
  ]);
  await ligne('serveur');
  const r5 = await prochainEnvoiLinkedIn(pool, org, NOW);
  const delaiMs = r5.quand ? r5.quand.getTime() - NOW.getTime() : -1;
  check('19e. apres un envoi recent : date dans le futur, sous 20 min', r5.motif === null && delaiMs > 0 && delaiMs <= 20 * 60_000, JSON.stringify(r5));

  // La reclamation, rejouee a la date posee, doit etre d accord (sinon le job s ouvrirait pour rien).
  const r6 = await reclamerProchaineAction(pool, org, r5.quand);
  check('19f. la reclamation a la date posee reussit', r6.action !== null, r6.motif ?? '');

  // 19g. LE defaut du 07/10 : `pg` rend `sent_at` en Date, `seededRandom` ne bouclait pas et rendait une
  // constante, donc le meme intervalle (3 min 35 s) a chaque envoi. Une borne [0, 20] min le satisfait
  // parfaitement ; seule la dependance a la date du dernier envoi le trahit. Vrai pilote, vraies dates.
  const ecarts = [];
  let exact = true;
  for (const secondes of [15, 25, 35, 45, 55, 65, 75]) {
    await q('delete from linkedin_action_queue where organization_id = $1', [org]);
    const dernier = new Date(NOW.getTime() - secondes * 1000);
    await ligne('serveur', { status: 'sent' });
    await q(`update linkedin_action_queue set sent_at = $2 where organization_id = $1 and status = 'sent'`, [org, dernier.toISOString()]);
    await ligne('serveur');
    // Meme temps ecoule (30 s) pour chaque date : seul ce que la graine tire peut alors differer.
    const maintenant = new Date(dernier.getTime() + 30_000);
    const r = await prochainEnvoiLinkedIn(pool, org, maintenant);
    const cible = dernier.getTime() + (1 + seededRandom(dernier.toISOString()) * 19) * 60_000;
    const d = r.quand ? r.quand.getTime() : NaN;
    if (!(d >= cible && d - cible < 60_000)) exact = false;
    ecarts.push(d - dernier.getTime());
  }
  check('19g. l intervalle suit la graine de la date du dernier envoi (sept dates)', exact, JSON.stringify(ecarts));
  check('19h. a temps ecoule egal, sept dates de depart donnent des intervalles differents', new Set(ecarts).size > 1, JSON.stringify(ecarts));
  await remettreAZero();
}

/** `n` actions envoyees de ce type, il y a `joursAvant` jours (loin du jour courant : seul le compteur 7 j les voit). */
async function envoyees(kind, n, joursAvant = 2) {
  await q(
    `insert into linkedin_action_queue (organization_id, linkedin_url, kind, method, status, scheduled_for, sent_at)
     select $1, 'https://www.linkedin.com/in/envoye-' || $2 || '-' || g || '-' || gen_random_uuid(), $2, 'serveur', 'sent', $3, $3
       from generate_series(1, $4::int) g`,
    [org, kind, new Date(NOW.getTime() - joursAvant * 24 * 3_600_000).toISOString(), n],
  );
}
const poserReglage = (cle, valeur) =>
  q(`insert into organization_settings (organization_id, key, value) values ($1, $2, to_jsonb($3::int))
     on conflict (organization_id, key) do update set value = excluded.value`, [org, cle, valeur]);

async function plafonds_par_type_sur_vrai_sql() {
  console.log('\n[lkf] 20. plafonds hebdomadaires PAR TYPE, lus dans organization_settings, sur la vraie base');
  await remettreAZero();
  await envoyees('invite', 100);
  await envoyees('message', 3);
  const msg = await ligne('serveur', { kind: 'message', scheduledFor: new Date(NOW.getTime() - 3 * 3_600_000).toISOString() });
  const inv = await ligne('serveur', { kind: 'invite' });

  // Tete de file : le message (le plus ancien). 100 invitations envoyees n'arretent pas un message.
  const r1 = await reclamerProchaineAction(pool, org, NOW);
  check('20a. 100 invitations envoyees (plafond 100) n arretent pas un message en tete de file', r1.action?.id === msg, r1.motif ?? '');
  // Le message est pris : la tete devient l'invitation, refusee par SON plafond.
  const r2 = await reclamerProchaineAction(pool, org, new Date(NOW.getTime() + 21 * 60_000));
  check('20b. l invitation en tete est refusee par le plafond des invitations', r2.action === null && r2.motif === 'weekly_cap_reached', r2.motif ?? '');
  check('20c. et reste pending', (await statut(inv)) === 'pending');

  await poserReglage('linkedin_invitations_par_semaine', 150);
  const r3 = await reclamerProchaineAction(pool, org, new Date(NOW.getTime() + 21 * 60_000));
  check('20d. relever le plafond des invitations dans organization_settings libere l invitation', r3.action?.id === inv, r3.motif ?? '');

  // Messages : leur compteur et leur plafond a eux.
  await remettreAZero();
  await envoyees('message', 150);
  await envoyees('invite', 60); // somme 210 > 200 : chaque compteur separement reste sous son plafond
  await ligne('serveur', { kind: 'message' });
  const r4 = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('20d2. 150 messages sous un plafond de 200 : pret', r4.motif === null, JSON.stringify(r4));
  await poserReglage('linkedin_messages_par_semaine', 150);
  const r5 = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('20d3. plafond des messages abaisse a 150 : weekly_cap_reached', r5.motif === 'weekly_cap_reached', JSON.stringify(r5));

  // Une invitation n'est pas consommee par les messages : 60 + 80 = 140 au compteur commun, > 100.
  await remettreAZero();
  await envoyees('invite', 60);
  await envoyees('message', 80);
  await ligne('serveur', { kind: 'invite' });
  const r4b = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('20d4. 60 invitations + 80 messages : l invitation est jugee sur les invitations seules', r4b.motif === null, JSON.stringify(r4b));

  // L'ancienne colonne ne regle plus rien.
  await remettreAZero();
  await envoyees('invite', 10);
  await ligne('serveur', { kind: 'invite' });
  await q(`insert into linkedin_settings (organization_id, weekly_cap, daily_cap) values ($1, 5, 1)`, [org]);
  const r6 = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('20e. linkedin_settings.weekly_cap = 5 et daily_cap = 1 ne bornent plus rien', r6.motif === null, JSON.stringify(r6));
}

async function fenetre_par_defaut_sur_instance_neuve() {
  console.log('\n[lkf] 20f. fenetre d envoi par defaut, sans ligne linkedin_settings');
  await remettreAZero();
  // Echeance la veille : sinon l'action n'est pas encore prete avant 11 h et masque la fenetre.
  await ligne('serveur', { scheduledFor: new Date(NOW.getTime() - 24 * 3_600_000).toISOString() });
  const heures = [];
  for (let h = 0; h < 24; h++) {
    // 15/09/2026 : Paris = UTC + 2.
    const r = await prochainEnvoiLinkedIn(pool, org, new Date(Date.UTC(2026, 8, 15, h - 2, 0, 0)));
    if (r.motif === null) heures.push(h);
  }
  check('20f. sans ligne, le moteur envoie de 9 h a 17 h inclus (fenetre 9 h - 18 h annoncee)', heures[0] === 9 && heures[heures.length - 1] === 17 && heures.length === 9, JSON.stringify(heures));
  const defauts = (await q(`select column_default from information_schema.columns where table_name = 'linkedin_settings' and column_name in ('send_from_hour', 'send_to_hour') order by column_name`)).rows.map((r) => r.column_default);
  check('20g. les colonnes de la table ont les memes defauts (9 et 18)', defauts.join(',') === '9,18', defauts.join(','));
}

async function plafond_horaire_dans_le_prochain_envoi() {
  console.log('\n[lkf] 21. plafond horaire de requetes : annonce par prochainEnvoiLinkedIn, meme regle que le handler');
  await remettreAZero();
  const id = await ligne('serveur', { status: 'processing', processingStartedAt: AVANT });
  await ligne('serveur');
  await q('update linkedin_action_queue set status = $2 where id = $1', [id, 'sent']);
  await q(`update linkedin_action_queue set sent_at = $2 where id = $1`, [id, new Date(NOW.getTime() - 2 * 24 * 3_600_000).toISOString()]);
  const requete = (minutes) =>
    q(`insert into linkedin_requetes (organization_id, action_queue_id, requested_at) values ($1, $2, $3)`, [org, id, new Date(NOW.getTime() - minutes * 60_000).toISOString()]);

  // Regle du handler (apps/worker/src/handlers/envoi-linkedin.ts) : refuse quand plafond - deLHeure < 4.
  const handlerRefuse = async (maintenant) => {
    const plafond = 60;
    const deLHeure = await compterRequetesLinkedIn({ ex: pool, organisationId: org }, new Date(maintenant.getTime() - 3_600_000));
    return plafond - deLHeure < 4;
  };

  for (let i = 0; i < 55; i++) await requete(10);
  const a = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('21a. 55 requetes sur 60 : reste 5 >= 4, pret', a.motif === null && !(await handlerRefuse(NOW)), JSON.stringify(a));
  await requete(50); // la plus ancienne, 50 min : 56 sur 60 -> reste 4, encore pret
  const b = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('21b. 56 requetes sur 60 : reste 4 = cout d un envoi, encore pret', b.motif === null && !(await handlerRefuse(NOW)), JSON.stringify(b));
  await requete(10);
  const c = await prochainEnvoiLinkedIn(pool, org, NOW);
  const libere = new Date(NOW.getTime() - 50 * 60_000 + 3_600_000 + 1);
  check('21c. 57 requetes sur 60 : plafond_horaire_atteint, avec la date ou la plus ancienne sort de la fenetre', c.quand === null && c.motif === 'plafond_horaire_atteint' && c.disponibleA?.getTime() === libere.getTime() && (await handlerRefuse(NOW)), JSON.stringify(c));

  // La date est juste : le handler refuse juste avant, accepte a l instant annonce.
  const avant = new Date(libere.getTime() - 1);
  check('21d. le handler refuse encore 1 ms avant la date annoncee', (await handlerRefuse(avant)) === true && (await prochainEnvoiLinkedIn(pool, org, avant)).motif === 'plafond_horaire_atteint');
  const apres = await prochainEnvoiLinkedIn(pool, org, libere);
  check('21e. a la date annoncee, le handler accepte et prochainEnvoi rend pret', (await handlerRefuse(libere)) === false && apres.motif === null, JSON.stringify(apres));

  // Le plafond se regle : relever a 100 libere tout de suite.
  await poserReglage('linkedin_requetes_par_heure', 100);
  const d = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('21f. plafond horaire releve a 100 : pret', d.motif === null, JSON.stringify(d));
  await poserReglage('linkedin_requetes_par_heure', 3);
  const e = await prochainEnvoiLinkedIn(pool, org, NOW);
  check('21g. plafond sous le cout d un envoi : refus sans date inventee', e.motif === 'plafond_horaire_atteint' && e.disponibleA === undefined, JSON.stringify(e));
}

async function migration_de_report_des_plafonds() {
  console.log('\n[lkf] 22. migration de report de weekly_cap vers linkedin_invitations_par_semaine');
  const chemin = fileURLToPath(new URL('../../supabase/migrations/20261008100000_linkedin_plafonds_envoi_report.sql', import.meta.url));
  const sql = readFileSync(chemin, 'utf8');
  await remettreAZero();
  const org2 = (await q(`insert into organizations (name, slug) values ('Report', 'report-' || gen_random_uuid()) returning id`)).rows[0].id;
  const org3 = (await q(`insert into organizations (name, slug) values ('Report3', 'report3-' || gen_random_uuid()) returning id`)).rows[0].id;
  await q(`insert into linkedin_settings (organization_id, weekly_cap) values ($1, 150), ($2, 120)`, [org, org2]);
  // org2 a deja choisi sa valeur dans le nouvel endroit : elle ne doit jamais etre ecrasee.
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'linkedin_invitations_par_semaine', '80'::jsonb)`, [org2]);
  const lire = async (o) => (await q(`select value from organization_settings where organization_id = $1 and key = 'linkedin_invitations_par_semaine'`, [o])).rows[0]?.value ?? null;

  // 22e d'abord : une version qui fausse la valeur reportee doit LEVER, et ne rien laisser.
  const fausse = sql.replace('to_jsonb(ls.weekly_cap)', 'to_jsonb(1)');
  let leve = null;
  try {
    await q('begin');
    await q(fausse);
    await q('commit');
  } catch (e) {
    leve = e.message;
    await q('rollback');
  }
  check('22e. un report fausse fait lever la verification interne de la migration', leve !== null && /different|différent/.test(leve), String(leve));
  check('22e2. et rien n est ecrit (transaction annulee)', (await lire(org)) === null);

  await q(sql);
  check('22a. weekly_cap = 150 reporte tel quel', (await lire(org)) === 150, String(await lire(org)));
  check('22b. une valeur deja posee n est jamais ecrasee (80 reste 80, pas 120)', (await lire(org2)) === 80, String(await lire(org2)));
  check('22c. une organisation sans ligne linkedin_settings n en recoit pas', (await lire(org3)) === null);
  await q(sql);
  check('22d. idempotente : une seconde execution ne change rien', (await lire(org)) === 150 && (await lire(org2)) === 80);
  await q('delete from organization_settings where organization_id = any($1)', [[org2, org3]]);
  await q('delete from linkedin_settings where organization_id = $1', [org2]);
}

async function jouer(...sections) {
  for (const section of sections) {
    try {
      await section();
    } catch (e) {
      failures += 1;
      console.log(`  FAIL section ${section.name} a levé : ${e.message}`);
    }
  }
}

async function main() {
  org = (await q(`insert into organizations (name, slug) values ('Fichier', 'fichier-' || gen_random_uuid()) returning id`)).rows[0].id;
  await remettreAZero();

  await jouer(
    serveur_reclamee_et_passee_en_processing,
    extension_auto_jamais_reclamee,
    campagne_non_active_non_reclamee,
    pause_active_refuse_la_reclamation,
    pause_echue_laisse_passer,
    ligne_coincee_requeue_apres_dix_minutes,
    resultat_seulement_depuis_processing,
    pause_ne_se_raccourcit_pas_et_dit_quand_rien_n_est_pose,
    session_non_active_refuse_la_reclamation,
    requeue_passe_avant_les_refus_de_session,
    remise_en_attente_ne_rouvre_que_processing_et_borne_les_tentatives,
    trace_d_envoi_bornee_a_l_organisation,
    sonde_file_vide,
    nettoyage_sans_reclamation,
    sonde_ne_juge_que_ce_qui_est_pret,
    sonde_et_reclamation_d_accord_a_l_echeance_limite,
    enregistrement_atomique,
    indetermine_compte_comme_actif,
    prochain_envoi_sur_vrai_sql,
    plafonds_par_type_sur_vrai_sql,
    fenetre_par_defaut_sur_instance_neuve,
    plafond_horaire_dans_le_prochain_envoi,
    migration_de_report_des_plafonds,
  );
  await remettreAZero();
  await pool.end();
  console.log(failures === 0 ? '\n[lkf] TOUT VERT' : `\n[lkf] ${failures} ECHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error('[lkf] ERREUR', e.message);
  process.exit(2);
});
