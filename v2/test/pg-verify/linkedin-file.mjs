// Lot 4b, tâche 3 : exécution RÉELLE, sur Postgres, du SQL de la file d'actions
// LinkedIn portée dans le cœur (reclamerProchaineAction, enregistrerResultat,
// mettreEnPauseEnvoiLinkedIn). Aucun appel LinkedIn.
//
// Mutations qui font rougir :
//   1. file.ts : `q.method = 'serveur'` -> `'extension_auto'` : 1 et 2 rougissent.
//   2. file.ts : retirer `camp.status = 'active'` : 3 rougit.
//   3. file.ts : renommer `envoi_pause_jusqua` : 4 et 5 rougissent (colonne inconnue).
//   4. file.ts : retirer `and status = 'processing'` de la mise a jour de resultat : 7 rougit.
//   6. file.ts : retirer `greatest` de la mise en pause : 8 rougit.
//   5. file.ts : retirer le requeue : 6 rougit.
import pg from 'pg';
import { reclamerProchaineAction, enregistrerResultat, mettreEnPauseEnvoiLinkedIn } from './_lkf.mjs';

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

async function remettreAZero() {
  await q('delete from linkedin_action_queue where organization_id = $1', [org]);
  await q('delete from linkedin_server_sessions where organization_id = $1', [org]);
  await q('delete from linkedin_settings where organization_id = $1', [org]);
}
async function ligne(method, extra = {}) {
  seq += 1;
  const r = await q(
    `insert into linkedin_action_queue (organization_id, linkedin_url, kind, method, status, scheduled_for, processing_started_at, action_id)
     values ($1, $2, 'invite', $3, $4, $5, $6, $7) returning id`,
    [
      org,
      `https://www.linkedin.com/in/fictif-${seq}`,
      method,
      extra.status ?? 'pending',
      extra.scheduledFor ?? AVANT,
      extra.processingStartedAt ?? null,
      extra.actionId ?? null,
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
  await q(`insert into linkedin_server_sessions (organization_id, status) values ($1, 'active')`, [org]);
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
  await q(`insert into linkedin_server_sessions (organization_id, status) values ($1, 'active')`, [org]);
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
  check('coincee depuis 5 min : pas reclamable', r6a.action === null && r6a.motif === 'queue_empty', r6a.motif ?? '');
  check('reste en processing', (await statut(idRecent)) === 'processing');
  await q(`update linkedin_action_queue set processing_started_at = $2 where id = $1`, [idRecent, new Date(NOW.getTime() - 11 * 60_000).toISOString()]);
  const r6b = await reclamerProchaineAction(pool, org, NOW);
  check('coincee depuis 11 min : reclamee a nouveau', r6b.action?.id === idRecent, r6b.motif ?? '');
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
  await remettreAZero();
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
