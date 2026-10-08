// Lot 4b, tâche 2 : exécution RÉELLE, sur Postgres, de ce que la base accepte
// pour un envoi LinkedIn exécuté par le serveur. Tout est du SQL brut : la tâche
// ne touche que le schéma.
//
// Mutations qui font rougir :
//   1. migration : retirer 'serveur' du check sur `method` — contrôle 1 rougit.
//   2. migration : retirer `alter column source_run_id drop not null` — 2 rougit.
//   3. migration : retirer la contrainte `linkedin_requetes_une_origine` — 4 et 5 rougissent.
//   4. migration : retirer la colonne `envoi_pause_jusqua` — 7 rougit.
//   6. envoi-linkedin.ts, `arreterSequence` : retirer `set status = 'failed'`, la jointure
//      `a.id = q.action_id` ou le filtre `a.status in (...)` — la section 5 rougit.
//   7. rang : `arreterSequenceDeLaLigne` relit `s.position` au lieu du rang — 32 rougit (et 29 reste vert).
//   8. reprise : retirer l'update `jr:reprendre_marque_file` — 34, 35 et 36 rougissent.
//   9. balayage : retirer `q.reprise_le is not null` — 33 rougit ; retirer `q.reprise_le is null` du
//      balayage des orphelines — 37 rougit ; retirer le `not exists` (lignes vivantes/indéterminées) — 38 rougit.
//  10. reprise : retirer l'exists `linkedin_action_queue` de `deja_envoyee` — 39 et 40 rougissent.
//  12. rejeu : retirer la branche « refus de l'enfilage » (`deja_en_attente`) de rejouerActionsLinkedInReprises — 50, 51 et 52 rougissent.
//  13. rejeu : reprendre `message_body` de la ligne refusée au lieu de `rendreCorpsDeLEtape` — 53 et 54 rougissent ;
//      retirer le blocage `missing_variable` / `missing_locale` — 55 et 56 rougissent.
//  14. rejeu des actions jamais enfilées (rejouerActionsLinkedInEnAttente) : retirer `camp.status = 'active'` — 58 rougit ;
//      `a.dispatched_at is null` — 59 ; la comparaison de suppression `lower(sup.value) = lower(c.linkedin_url)` — 60 ; `org.sending_paused_at is null` — 61 ;
//      `a.created_at < now() - interval '2 minutes'` — 62 ; `e.status in ('active', 'completed')` réduit à 'active' — 57 ;
//      le `not exists` sur linkedin_action_queue — 63 ; le filtre de statut d'inscription retiré en entier — 64.
//  11. migration 20261008110000 : retirer `add column reprise_le` — la migration échoue (contrôle).
//   5. migration 20261007130000 : retirer le `set default` — la migration echoue (controle), et 1e rougit.
import pg from 'pg';
import { regler, mettreEnPauseActionsLinkedInOrphelines, rejouerActionsLinkedInReprises, rejouerActionsLinkedInEnAttente, reprendreInscription, actionIdempotencyKey, envoyerEmailSalesBlink, rangDeLEtape, ErreurSalesBlink, remettreActionEnAttente, reparerLignesCoincees } from './_linkedin-envoi-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
/** Exécute `fn` et dit si la base l'a refusé (code de la violation) ou accepté. */
async function refus(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.constraint ? `${e.code}:${e.constraint}` : (e.code ?? String(e.message));
  }
}

let seq = 0;
async function monde() {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const org = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
  const source = (await q(`insert into sources (organization_id, provider_id, name) values ($1, 'linkedin_post_engagers', 'S') returning id`, [org])).rows[0].id;
  const run = (await q(`insert into source_runs (source_id) values ($1) returning id`, [source])).rows[0].id;
  return { org, run };
}
const action = (org, method, linkedinUrl = 'https://www.linkedin.com/in/x') =>
  q(`insert into linkedin_action_queue (organization_id, linkedin_url, kind, method) values ($1, $2, 'invite', $3) returning id`, [org, linkedinUrl, method]);

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

async function methode() {
  console.log('\n1. la méthode d\'exécution');
  const m = await monde();
  check('1. method = serveur est accepté', (await refus(() => action(m.org, 'serveur'))) === null);
  check('1b. extension_auto et manual restent acceptés',
    (await refus(() => action(m.org, 'extension_auto', 'https://www.linkedin.com/in/y'))) === null &&
    (await refus(() => action(m.org, 'manual', 'https://www.linkedin.com/in/z'))) === null);
  check('1c. une méthode inconnue est refusée (23514)', (await refus(() => action(m.org, 'robot', 'https://www.linkedin.com/in/w'))) === '23514:linkedin_action_queue_method_check');
  check('1d. une ligne extension_auto déjà sent reste valide',
    (await refus(() => q(`insert into linkedin_action_queue (organization_id, linkedin_url, kind, method, status, sent_at) values ($1, 'https://www.linkedin.com/in/h', 'invite', 'extension_auto', 'sent', now())`, [m.org]))) === null);
}

async function defaut() {
  console.log('\n1bis. la methode par defaut');
  const m = await monde();
  const r = await q(`insert into linkedin_action_queue (organization_id, linkedin_url, kind) values ($1, 'https://www.linkedin.com/in/defaut', 'invite') returning method`, [m.org]);
  check('1e. une ligne creee sans method est une ligne serveur', r.rows[0].method === 'serveur', r.rows[0].method);
  const h = await q(`select count(*)::int n from linkedin_action_queue where method = 'extension_auto' and status = 'sent'`);
  check('1f. les lignes historiques extension_auto n ont pas bouge', h.rows[0].n >= 1, String(h.rows[0].n));
}

async function trace() {
  console.log('\n2. la trace par requête : une origine, et une seule');
  const m = await monde();
  const a = (await action(m.org, 'serveur')).rows[0].id;
  const ins = (cols, vals) => q(`insert into linkedin_requetes (organization_id, ${cols}) values ($1, ${vals}) returning id`, [m.org, ...(cols === 'source_run_id' ? [m.run] : cols === 'action_queue_id' ? [a] : cols ? [m.run, a] : [])]);
  check('2. une ligne de collecte (source_run_id seul) passe', (await refus(() => ins('source_run_id', '$2'))) === null);
  check('3. une ligne d\'envoi (action_queue_id seul, source_run_id nul) passe', (await refus(() => ins('action_queue_id', '$2'))) === null);
  check('4. les deux renseignés : refusé par linkedin_requetes_une_origine', (await refus(() => ins('source_run_id, action_queue_id', '$2, $3'))) === '23514:linkedin_requetes_une_origine');
  check('5. aucun des deux : refusé par linkedin_requetes_une_origine',
    (await refus(() => q(`insert into linkedin_requetes (organization_id) values ($1)`, [m.org]))) === '23514:linkedin_requetes_une_origine');
  check('5b. une action inexistante est refusée (23503)',
    (await refus(() => q(`insert into linkedin_requetes (organization_id, action_queue_id) values ($1, gen_random_uuid())`, [m.org]))) === '23503:linkedin_requetes_action_queue_id_fkey');
  const n = (await q(`select count(*)::int n from linkedin_requetes where organization_id = $1`, [m.org])).rows[0].n;
  check('5c. exactement deux lignes ont été écrites', n === 2, String(n));
}

async function suppressions() {
  console.log('\n3. les suppressions en cascade ne se bloquent pas sur la contrainte');
  const m = await monde();
  const a = (await action(m.org, 'serveur')).rows[0].id;
  await q(`insert into linkedin_requetes (organization_id, action_queue_id) values ($1, $2)`, [m.org, a]);
  await q(`insert into linkedin_requetes (organization_id, source_run_id) values ($1, $2)`, [m.org, m.run]);
  check('6. supprimer l\'organisation (action + trace d\'envoi) réussit',
    (await refus(() => q(`delete from organizations where id = $1`, [m.org]))) === null);
  const n = (await q(`select count(*)::int n from linkedin_requetes where organization_id = $1`, [m.org])).rows[0].n;
  check('6b. et la trace a disparu avec elle', n === 0, String(n));
}

async function suppressionAction() {
  console.log('\n3b. supprimer une action emporte sa trace');
  const m = await monde();
  const a = (await action(m.org, 'serveur')).rows[0].id;
  await q(`insert into linkedin_requetes (organization_id, action_queue_id) values ($1, $2)`, [m.org, a]);
  check('6c. supprimer l\'action seule réussit', (await refus(() => q(`delete from linkedin_action_queue where id = $1`, [a]))) === null);
  const n = (await q(`select count(*)::int n from linkedin_requetes where organization_id = $1`, [m.org])).rows[0].n;
  check('6d. et sa trace a disparu', n === 0, String(n));
}

async function preexistant() {
  console.log('\n0. les lignes posées AVANT la migration sont intactes');
  const o = (await q(`select id from organizations where slug = 'preexistant'`)).rows[0]?.id;
  check('0. la base préexistante est là', !!o);
  const r = (await q(`select source_run_id is not null as run, action_queue_id is null as sans_action from linkedin_requetes where organization_id = $1`, [o])).rows;
  check('0b. la ligne de collecte garde son source_run_id, sans action', r.length === 1 && r[0].run && r[0].sans_action, JSON.stringify(r));
  const a = (await q(`select method, status from linkedin_action_queue where organization_id = $1`, [o])).rows;
  check('0c. l\'action sent en extension_auto est inchangée', a.length === 1 && a[0].method === 'extension_auto' && a[0].status === 'sent', JSON.stringify(a));
}

async function pause() {
  console.log('\n4. la pause d\'envoi de la session');
  const m = await monde();
  await q(`insert into linkedin_server_sessions (organization_id) values ($1)`, [m.org]);
  const col = (await q(`select is_nullable, data_type from information_schema.columns where table_name = 'linkedin_server_sessions' and column_name = 'envoi_pause_jusqua'`)).rows[0];
  check('7. envoi_pause_jusqua existe, timestamptz, nullable', col?.is_nullable === 'YES' && col?.data_type === 'timestamp with time zone', JSON.stringify(col));
  const v = (await q(`select envoi_pause_jusqua from linkedin_server_sessions where organization_id = $1`, [m.org])).rows[0];
  check('8. nulle par défaut (aucune pause)', v?.envoi_pause_jusqua === null);
  await q(`update linkedin_server_sessions set envoi_pause_jusqua = now() + interval '1 day' where organization_id = $1`, [m.org]);
  const w = (await q(`select envoi_pause_jusqua > now() as futur from linkedin_server_sessions where organization_id = $1`, [m.org])).rows[0];
  check('9. accepte une date, relue dans le futur', w?.futur === true);
}

// ---------------------------------------------------------------- refus définitif
// Le vrai `regler` (celui du handler), sur une vraie base : file, action et inscription.
async function mondeSequence() {
  const m = await monde();
  const contact = (await q(`insert into contacts (organization_id) values ($1) returning id`, [m.org])).rows[0].id;
  const camp = (await q(`insert into campaigns (organization_id, name, status) values ($1, 'C', 'active') returning id`, [m.org])).rows[0].id;
  const etapes = [];
  for (const position of [0, 1, 2]) {
    etapes.push((await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, $2, 'linkedin_invite') returning id`, [camp, position])).rows[0].id);
  }
  // Le tick a déjà avancé l'inscription à l'étape 2 et vidé l'échéance : l'état réel après émission de l'étape 1.
  const insc = (await q(`insert into enrollments (organization_id, campaign_id, contact_id, current_step, next_action_at) values ($1, $2, $3, 2, null) returning id`, [m.org, camp, contact])).rows[0].id;
  const act = (await q(`insert into actions (organization_id, enrollment_id, step_id, channel, status, idempotency_key) values ($1, $2, $3, 'linkedin_invite', 'scheduled', $4) returning id`, [m.org, insc, etapes[1], `cle-${Date.now()}-${Math.random()}`])).rows[0].id;
  return { ...m, contact, insc, act };
}
const file = (m, actionId, url) =>
  q(`insert into linkedin_action_queue (organization_id, contact_id, action_id, linkedin_url, kind, method, status, processing_started_at)
     values ($1, $2, $3, $4, 'invite', 'serveur', 'processing', now()) returning id`, [m.org, m.contact, actionId, url]).then((r) => r.rows[0].id);
const deps = () => ({ pool, env: {}, pause: async () => undefined });
const ctxDe = (m) => ({ ex: pool, organisationId: m.org, utilisateurId: null, role: null });
const lire = async (m, queueId) => ({
  file: queueId ? (await q(`select status, error_code from linkedin_action_queue where id = $1`, [queueId])).rows[0] : null,
  action: (await q(`select status::text, error from actions where id = $1`, [m.act])).rows[0],
  insc: (await q(`select status::text, stop_reason, current_step, next_action_at from enrollments where id = $1`, [m.insc])).rows[0],
});

async function refusDefinitif() {
  console.log('\n5. un refus définitif arrête la séquence (revue finale, C2)');
  const m = await mondeSequence();
  const queue = await file(m, m.act, 'https://www.linkedin.com/in/refus');
  await regler(deps(), ctxDe(m), { id: queue, kind: 'invite', linkedinUrl: 'https://www.linkedin.com/in/refus', messageBody: 'note' }, { type: 'refus', code: 'note_non_supportee' });
  const r = await lire(m, queue);
  check('10. la ligne de file est en échec avec son code', r.file.status === 'failed' && r.file.error_code === 'note_non_supportee', JSON.stringify(r.file));
  check('11. l\'action est failed avec son error', r.action.status === 'failed' && !!r.action.error, JSON.stringify(r.action));
  check('12. l\'inscription est en pause, motif nommé, rembobinée sur l\'étape en échec (position 1)',
    r.insc.status === 'paused' && r.insc.stop_reason === 'linkedin_refus:note_non_supportee' && r.insc.current_step === 1 && r.insc.next_action_at === null, JSON.stringify(r.insc));

  const m2 = await mondeSequence();
  const q2 = await file(m2, m2.act, 'https://www.linkedin.com/in/indet');
  await regler(deps(), ctxDe(m2), { id: q2, kind: 'invite', linkedinUrl: 'https://www.linkedin.com/in/indet', messageBody: null }, { type: 'indetermine' });
  const r2 = await lire(m2, q2);
  check('13. un résultat indéterminé arrête aussi la séquence',
    r2.file.status === 'failed' && r2.action.status === 'failed' && r2.insc.stop_reason === 'linkedin_refus:resultat_indetermine', JSON.stringify(r2));

  const m3 = await mondeSequence();
  await q(`update actions set status = 'dispatched' where id = $1`, [m3.act]);
  const q3 = await file(m3, m3.act, 'https://www.linkedin.com/in/partie');
  await regler(deps(), ctxDe(m3), { id: q3, kind: 'invite', linkedinUrl: 'https://www.linkedin.com/in/partie', messageBody: null }, { type: 'refus', code: 'cannot_invite' });
  const r3 = await lire(m3, q3);
  check('14. une action déjà partie n\'est jamais repassée en échec, son inscription reste active',
    r3.action.status === 'dispatched' && r3.insc.status === 'active', JSON.stringify(r3));
}

async function sansActionLiee() {
  console.log('\n6. une ligne de file sans action liée ne touche ni action ni inscription');
  const m = await mondeSequence();
  const queue = await file(m, null, 'https://www.linkedin.com/in/extension');
  await regler(deps(), ctxDe(m), { id: queue, kind: 'invite', linkedinUrl: 'https://www.linkedin.com/in/extension', messageBody: null }, { type: 'refus', code: 'profile_not_found' });
  const r = await lire(m, queue);
  check('15. la file est en échec', r.file.status === 'failed' && r.file.error_code === 'profile_not_found', JSON.stringify(r.file));
  check('16. l\'action voisine reste scheduled, sans error', r.action.status === 'scheduled' && r.action.error === null, JSON.stringify(r.action));
  check('17. l\'inscription voisine reste active, étape 2, sans motif', r.insc.status === 'active' && r.insc.stop_reason === null && r.insc.current_step === 2, JSON.stringify(r.insc));
}

// ---------------------------------------------------------------- sorties terminales hors `regler`
// Trois chemins rendent une ligne de file terminale sans passer par l'arrêt de séquence. Le balayage
// du tick (`mettreEnPauseActionsLinkedInOrphelines`) les rattrape : il MET EN PAUSE, il ne réenfile
// jamais. Chaque section compte les lignes de file avant/après : un réenfilement ferait bouger le compte
// ou le statut.
const etatFile = async (m) => (await q(`select id, status, error_code from linkedin_action_queue where organization_id = $1 order by created_at, id`, [m.org])).rows;
const tick = () => mettreEnPauseActionsLinkedInOrphelines({ pool });

async function lignesCoinceesRattrapees() {
  console.log('\n7. une ligne coincée (resultat_indetermine) est rattrapée par le balayage, sans jamais rejouer');
  const m = await mondeSequence();
  const queue = await file(m, m.act, 'https://www.linkedin.com/in/coincee');
  await q(`update linkedin_action_queue set processing_started_at = now() - interval '2 hours' where id = $1`, [queue]);
  await reparerLignesCoincees(pool, m.org);
  const avant = await lire(m, queue);
  check('18. avant le balayage : la file est terminale mais l\'inscription reste active sans échéance (le défaut)',
    avant.file.status === 'failed' && avant.file.error_code === 'resultat_indetermine' && avant.action.status === 'scheduled' && avant.insc.status === 'active' && avant.insc.next_action_at === null,
    JSON.stringify(avant));
  const file0 = await etatFile(m);
  await tick();
  const r = await lire(m, queue);
  check('19. le balayage met l\'action en échec et l\'inscription en pause, motif nommé, rembobinée sur l\'étape (1)',
    r.action.status === 'failed' && r.insc.status === 'paused' && r.insc.stop_reason === 'linkedin_refus:resultat_indetermine' && r.insc.current_step === 1 && r.insc.next_action_at === null,
    JSON.stringify(r));
  const file1 = await etatFile(m);
  check('20. INVARIANT : la file n\'a pas bougé (même lignes, toujours failed, rien en pending, aucun insert)',
    JSON.stringify(file0) === JSON.stringify(file1) && file1.length === 1 && file1[0].status === 'failed', JSON.stringify(file1));
  await tick();
  const r2 = await lire(m, queue);
  check('21. un second balayage ne change rien (idempotent)', JSON.stringify(r2) === JSON.stringify(r), JSON.stringify(r2));
}

async function balayageGardes() {
  console.log('\n8. le balayage ne touche que ce qu\'il doit');
  const parti = await mondeSequence();
  await q(`update actions set status = 'dispatched' where id = $1`, [parti.act]);
  const qp = await file(parti, parti.act, 'https://www.linkedin.com/in/b-parti');
  await q(`update linkedin_action_queue set status = 'failed', error_code = 'cannot_invite' where id = $1`, [qp]);
  const doublon = await mondeSequence();
  const qd1 = await file(doublon, doublon.act, 'https://www.linkedin.com/in/b-doublon');
  await q(`update linkedin_action_queue set status = 'failed', error_code = 'cannot_invite' where id = $1`, [qd1]);
  await q(`insert into linkedin_action_queue (organization_id, contact_id, action_id, linkedin_url, kind, method, status) values ($1,$2,$3,'https://www.linkedin.com/in/b-doublon','invite','serveur','pending')`, [doublon.org, doublon.contact, doublon.act]);
  const sans = await mondeSequence();
  const qs = await file(sans, null, 'https://www.linkedin.com/in/b-ext');
  await q(`update linkedin_action_queue set status = 'failed', error_code = 'cannot_invite' where id = $1`, [qs]);
  await tick();
  const rp = await lire(parti, qp);
  check('22. une action déjà partie n\'est jamais repassée en échec, son inscription reste active', rp.action.status === 'dispatched' && rp.insc.status === 'active', JSON.stringify(rp));
  const rd = await lire(doublon, qd1);
  check('23. une action qui a encore une ligne de file vivante n\'est pas arrêtée', rd.action.status === 'scheduled' && rd.insc.status === 'active', JSON.stringify(rd));
  const rs = await lire(sans, qs);
  check('24. une ligne de file sans action liée ne touche rien', rs.action.status === 'scheduled' && rs.insc.status === 'active', JSON.stringify(rs));
}

async function epuisementDesTentatives() {
  console.log('\n9. l\'épuisement des tentatives de lecture arrête la séquence');
  const m = await mondeSequence();
  const queue = await file(m, m.act, 'https://www.linkedin.com/in/lecture');
  await q(`update linkedin_action_queue set attempts = 3 where id = $1`, [queue]);
  await regler(deps(), ctxDe(m), { id: queue, kind: 'invite', linkedinUrl: 'https://www.linkedin.com/in/lecture', messageBody: null }, { type: 'rien_parti' });
  const r = await lire(m, queue);
  check('25. la file est en échec trop_de_tentatives, l\'action en échec, l\'inscription en pause avec le motif',
    r.file.status === 'failed' && r.file.error_code === 'trop_de_tentatives' && r.action.status === 'failed' && r.insc.status === 'paused' && r.insc.stop_reason === 'linkedin_refus:trop_de_tentatives' && r.insc.current_step === 1,
    JSON.stringify(r));

  const m2 = await mondeSequence();
  const q2 = await file(m2, m2.act, 'https://www.linkedin.com/in/lecture2');
  await regler(deps(), ctxDe(m2), { id: q2, kind: 'invite', linkedinUrl: 'https://www.linkedin.com/in/lecture2', messageBody: null }, { type: 'rien_parti' });
  const r2 = await lire(m2, q2);
  check('26. une lecture qui échoue AVANT l\'épuisement remet en pending sans toucher la séquence',
    r2.file.status === 'pending' && r2.action.status === 'scheduled' && r2.insc.status === 'active', JSON.stringify(r2));

  const m3 = await mondeSequence();
  const q3 = await file(m3, m3.act, 'https://www.linkedin.com/in/lecture3');
  await q(`update linkedin_action_queue set attempts = 3 where id = $1`, [q3]);
  const statut = await remettreActionEnAttente(pool, m3.org, q3, { comptee: true, maxTentatives: 3 });
  const statutAbsent = await remettreActionEnAttente(pool, m3.org, q3, { comptee: true, maxTentatives: 3 });
  check('27. remettreActionEnAttente rend le statut écrit (failed), puis null quand la ligne n\'a pas bougé', statut === 'failed' && statutAbsent === null, `${statut}/${statutAbsent}`);
}

async function etapeSupprimee() {
  console.log('\n10. une étape supprimée pendant que l\'action est en file n\'abandonne pas l\'inscription');
  const m = await mondeSequence();
  const queue = await file(m, m.act, 'https://www.linkedin.com/in/etape');
  const etape = (await q(`select step_id from actions where id = $1`, [m.act])).rows[0].step_id;
  await q(`delete from sequence_steps where id = $1`, [etape]);
  const sansEtape = (await q(`select step_id from actions where id = $1`, [m.act])).rows[0].step_id;
  await regler(deps(), ctxDe(m), { id: queue, kind: 'invite', linkedinUrl: 'https://www.linkedin.com/in/etape', messageBody: null }, { type: 'refus', code: 'cannot_invite' });
  const r = await lire(m, queue);
  check('28. step_id est bien devenu null (clé étrangère on delete set null)', sansEtape === null);
  check('29. l\'inscription est en pause quand même, son current_step courant (2) conservé, l\'action en échec',
    r.insc.status === 'paused' && r.insc.stop_reason === 'linkedin_refus:cannot_invite' && r.insc.current_step === 2 && r.action.status === 'failed', JSON.stringify(r));
}

async function panneEntreLesDeuxEcritures() {
  console.log('\n11. une panne de l\'arrêt de séquence est rattrapée par le balayage');
  const m = await mondeSequence();
  const queue = await file(m, m.act, 'https://www.linkedin.com/in/panne');
  await q(`update linkedin_action_queue set status = 'failed', error_code = 'resultat_indetermine' where id = $1`, [queue]);
  // Pool dont l'écriture de l'ACTION échoue : l'inscription est déjà en pause à ce moment (ordre voulu).
  const panne = { query: (sql, params) => (String(sql).includes('jr:linkedin_action_echec') ? Promise.reject(new Error('base indisponible')) : pool.query(sql, params)) };
  await mettreEnPauseActionsLinkedInOrphelines({ pool: panne });
  const mi = await lire(m, queue);
  check('30. la panne laisse l\'action scheduled (le témoin du balayage) et l\'inscription déjà en pause',
    mi.action.status === 'scheduled' && mi.insc.status === 'paused', JSON.stringify(mi));
  await tick();
  const r = await lire(m, queue);
  check('31. le balayage suivant termine : action en échec, inscription toujours en pause avec son motif',
    r.action.status === 'failed' && r.insc.status === 'paused' && r.insc.stop_reason === 'linkedin_refus:resultat_indetermine', JSON.stringify(r));
}

// ---------------------------------------------------------------- rang contre position, et reprise
// Positions NON contiguës (0, 3, 7) : l'état réel après deux suppressions. Avec 0, 1, 2 le rang et la
// position coïncident et le défaut reste invisible. L'inscription est au rang 2 (le tick a émis l'étape
// de rang 1, position 3).
async function mondeNonContigu() {
  const m = await monde();
  const contact = (await q(`insert into contacts (organization_id, linkedin_url) values ($1, 'https://www.linkedin.com/in/ancienne') returning id`, [m.org])).rows[0].id;
  const camp = (await q(`insert into campaigns (organization_id, name, status) values ($1, 'C', 'active') returning id`, [m.org])).rows[0].id;
  const etapes = [];
  for (const position of [0, 3, 7]) {
    etapes.push((await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, $2, 'linkedin_invite') returning id`, [camp, position])).rows[0].id);
  }
  const insc = (await q(`insert into enrollments (organization_id, campaign_id, contact_id, current_step, next_action_at) values ($1, $2, $3, 2, null) returning id`, [m.org, camp, contact])).rows[0].id;
  const act = (await q(`insert into actions (organization_id, enrollment_id, step_id, channel, status, idempotency_key) values ($1, $2, $3, 'linkedin_invite', 'scheduled', $4) returning id`, [m.org, insc, etapes[1], actionIdempotencyKey(insc, etapes[1])])).rows[0].id;
  return { ...m, contact, insc, act, camp };
}
const ctxOperateur = (m) => ({ ...ctxDe(m), role: 'operator' });
const lignesFile = async (m) => (await q(`select id, status, error_code, reprise_le, linkedin_url from linkedin_action_queue where organization_id = $1 order by created_at, id`, [m.org])).rows;

async function rangContrePosition() {
  console.log('\n12. le current_step posé par la pause est un RANG, pas une position (positions 0, 3, 7)');
  const m = await mondeNonContigu();
  const queue = await file(m, m.act, 'https://www.linkedin.com/in/rang');
  await regler(deps(), ctxDe(m), { id: queue, kind: 'invite', linkedinUrl: 'https://www.linkedin.com/in/rang', messageBody: null }, { type: 'refus', code: 'cannot_invite' });
  const r = await lire(m, queue);
  check('32. l\'inscription est rembobinée au rang 1 (l\'étape de position 3), pas à la position 3',
    r.insc.status === 'paused' && r.insc.current_step === 1, JSON.stringify(r.insc));
}

async function reprise() {
  console.log('\n13. « Reprendre » après un refus : marque la ligne, puis le balayage réenfile UNE fois');
  const m = await mondeNonContigu();
  const queue = await file(m, m.act, 'https://www.linkedin.com/in/ancienne');
  await regler(deps(), ctxDe(m), { id: queue, kind: 'invite', linkedinUrl: 'https://www.linkedin.com/in/ancienne', messageBody: 'bonjour' }, { type: 'refus', code: 'profile_not_found' });

  await rejouerActionsLinkedInReprises({ pool });
  check('33. un refus NON repris par un humain ne repart jamais seul (aucune ligne de plus)',
    (await lignesFile(m)).length === 1, JSON.stringify(await lignesFile(m)));

  await q(`update contacts set linkedin_url = 'https://www.linkedin.com/in/corrigee' where id = $1`, [m.contact]);
  await reprendreInscription(ctxOperateur(m), { inscriptionId: m.insc });
  const apres = await lignesFile(m);
  const ra = await lire(m, queue);
  check('34. la reprise marque la ligne refusée sans l\'effacer (toujours failed, même code, reprise_le posé)',
    apres.length === 1 && apres[0].status === 'failed' && apres[0].error_code === 'profile_not_found' && apres[0].reprise_le !== null, JSON.stringify(apres));
  check('35. la reprise rend l\'inscription active et l\'action scheduled, sans échéance (rang 1 retrouvé malgré les positions 0, 3, 7)',
    ra.insc.status === 'active' && ra.insc.next_action_at === null && ra.action.status === 'scheduled', JSON.stringify(ra));

  await tick();
  const sansRepause = await lire(m, queue);
  check('37. le balayage des orphelines ne remet PAS l\'inscription reprise en pause', sansRepause.insc.status === 'active' && sansRepause.action.status === 'scheduled', JSON.stringify(sansRepause));

  const n = await rejouerActionsLinkedInReprises({ pool });
  const lignes = await lignesFile(m);
  const neuve = lignes.find((l) => l.id !== queue);
  check('36. le balayage réenfile exactement une ligne pending, avec l\'adresse CORRIGÉE, liée à la même action',
    n === 1 && lignes.length === 2 && neuve?.status === 'pending' && neuve.linkedin_url === 'https://www.linkedin.com/in/corrigee', JSON.stringify(lignes));
  const lie = (await q(`select action_id from linkedin_action_queue where id = $1`, [neuve.id])).rows[0];
  check('36b. la nouvelle ligne porte l\'action reprise', lie.action_id === m.act);

  await rejouerActionsLinkedInReprises({ pool });
  check('36c. un second balayage ne réenfile rien (une ligne par reprise)', (await lignesFile(m)).length === 2);

  // La nouvelle ligne échoue à son tour : la ligne la plus récente n'est pas marquée, rien ne repart seul.
  await q(`update linkedin_action_queue set status = 'processing', processing_started_at = now() where id = $1`, [neuve.id]);
  await regler(deps(), ctxDe(m), { id: neuve.id, kind: 'invite', linkedinUrl: neuve.linkedin_url, messageBody: 'bonjour' }, { type: 'refus', code: 'profile_not_found' });
  await rejouerActionsLinkedInReprises({ pool });
  const fin = await lire(m, neuve.id);
  check('36d. un second refus remet l\'inscription en pause au rang 1 et rien n\'est réenfilé tout seul',
    fin.insc.status === 'paused' && fin.insc.current_step === 1 && (await lignesFile(m)).length === 2, JSON.stringify(fin));
}

async function resultatIndetermineJamaisRejoue() {
  console.log('\n14. resultat_indetermine n\'est JAMAIS levé : jamais deux envois pour une même action');
  const m = await mondeNonContigu();
  const queue = await file(m, m.act, 'https://www.linkedin.com/in/indet');
  await regler(deps(), ctxDe(m), { id: queue, kind: 'invite', linkedinUrl: 'https://www.linkedin.com/in/indet', messageBody: null }, { type: 'indetermine' });
  await reprendreInscription(ctxOperateur(m), { inscriptionId: m.insc });
  await rejouerActionsLinkedInReprises({ pool });
  const lignes = await lignesFile(m);
  const r = await lire(m, queue);
  check('39. la ligne indéterminée n\'est pas marquée, et rien n\'est réenfilé',
    lignes.length === 1 && lignes[0].reprise_le === null && lignes[0].status === 'failed', JSON.stringify(lignes));
  check('40. l\'inscription est réactivée avec son échéance normale, l\'action RESTE failed',
    r.insc.status === 'active' && r.insc.next_action_at !== null && r.action.status === 'failed', JSON.stringify(r));
  const j = (await q(`select diff->>'libelle' as libelle from audit_events where organization_id = $1 and action = 'enrollment_resumed'`, [m.org])).rows;
  check('41. le journal dit que rien n\'a été rejoué', j.length === 1 && j[0].libelle === 'Inscription reprise sans rejouer un envoi déjà parti.', JSON.stringify(j));

  // Panne entre les deux écritures : ligne refusée NON reprise, action restée scheduled, inscription active.
  const m3 = await mondeNonContigu();
  const q3 = await file(m3, m3.act, 'https://www.linkedin.com/in/orpheline');
  await q(`update linkedin_action_queue set status = 'failed', error_code = 'cannot_invite' where id = $1`, [q3]);
  await rejouerActionsLinkedInReprises({ pool });
  check('38b. une ligne refusée NON reprise, sur une action restée scheduled, n\'est jamais réenfilée',
    (await lignesFile(m3)).length === 1, JSON.stringify(await lignesFile(m3)));

  // Même sans passer par la reprise : une ligne marquée À LA MAIN sur une action qui a une ligne indéterminée.
  const m2 = await mondeNonContigu();
  const q1 = await file(m2, m2.act, 'https://www.linkedin.com/in/indet2');
  await q(`update linkedin_action_queue set status = 'failed', error_code = 'resultat_indetermine' where id = $1`, [q1]);
  await q(`insert into linkedin_action_queue (organization_id, contact_id, action_id, linkedin_url, kind, method, status, error_code, reprise_le) values ($1,$2,$3,'https://www.linkedin.com/in/indet2','invite','serveur','failed','cannot_invite', now())`, [m2.org, m2.contact, m2.act]);
  await rejouerActionsLinkedInReprises({ pool });
  check('38. le balayage ne réenfile pas une action qui porte une ligne indéterminée, même si sa dernière ligne est marquée',
    (await lignesFile(m2)).length === 2);
}

async function cheminEmail() {
  console.log('\n15. le chemin email pose le même rang (positions 0, 3, 7), et le helper partagé lit un rang');
  process.env.SALESBLINK_API_KEY = 'cle-de-test';
  const m = await mondeNonContigu();
  const etapes = (await q(`select id from sequence_steps where campaign_id = $1 order by position`, [m.camp])).rows.map((r) => r.id);
  check('42. le helper rend 0, 1, 2 pour les positions 0, 3, 7',
    JSON.stringify(await Promise.all(etapes.map((id) => rangDeLEtape(pool, id)))) === '[0,1,2]');
  const autre = await mondeNonContigu();
  check('42b. les étapes d\'une AUTRE campagne ne comptent pas, et une étape supprimée n\'a pas de rang',
    (await rangDeLEtape(pool, (await q(`select id from sequence_steps where campaign_id = $1 and position = 7`, [autre.camp])).rows[0].id)) === 2
    && (await rangDeLEtape(pool, '00000000-0000-0000-0000-000000000000')) === undefined);

  // Site 1 : porte de délivrabilité (adresse invalide à l'envoi).
  const sender = (await q(
    `insert into senders (organization_id, kind, provider_id, identity, provider_ref, provider_state, is_active)
     values ($1, 'email', 'salesblink', 'exp@exemple.fr', 'sb-1', '{"sending_enabled": true}'::jsonb, true) returning id`, [m.org])).rows[0].id;
  await q(`update actions set channel = 'email', sender_id = $2 where id = $1`, [m.act, sender]);
  await q(`update contacts set email = 'invalide@exemple.fr', email_status = 'invalid', first_name = 'M' where id = $1`, [m.contact]);
  const client = { creerGabaritNeutre: async () => 'g', creerListe: async () => 'l', creerSequenceEtape: async () => 's', activerEtPlanifier: async () => undefined, pousserLeads: async () => undefined, repondreDansLeFil: async () => ({ idTache: 't' }) };
  const stepId = etapes[1];
  await envoyerEmailSalesBlink({ pool }, { organizationId: m.org, channel: 'email', actionId: m.act, email: { enrollmentId: m.insc, contactId: m.contact, stepId, campaignId: m.camp, templateParentId: null, senderId: sender, locale: 'fr' } }, client);
  const r = await lire(m, null);
  check('43. porte email : l\'inscription est en pause au RANG 1 (pas à la position 3), motif email_gate',
    r.insc.status === 'paused' && r.insc.current_step === 1 && String(r.insc.stop_reason).startsWith('email_gate:'), JSON.stringify(r.insc));

  // Site 2 : échec définitif (erreur client du transport).
  const m2 = await mondeNonContigu();
  const etapes2 = (await q(`select id from sequence_steps where campaign_id = $1 order by position`, [m2.camp])).rows.map((r2) => r2.id);
  const sender2 = (await q(
    `insert into senders (organization_id, kind, provider_id, identity, provider_ref, provider_state, is_active)
     values ($1, 'email', 'salesblink', 'exp2@exemple.fr', 'sb-2', '{"sending_enabled": true}'::jsonb, true) returning id`, [m2.org])).rows[0].id;
  const famille = (await q(`insert into message_templates (organization_id, name, channel, locale, subject, body) values ($1, 'G', 'email', 'fr', 'Objet', 'Bonjour') returning id`, [m2.org])).rows[0].id;
  await q(`update actions set channel = 'email', sender_id = $2 where id = $1`, [m2.act, sender2]);
  await q(`update contacts set email = 'valide@exemple.fr', email_status = 'valid', first_name = 'Marie', last_name = 'Durand', locale = 'fr' where id = $1`, [m2.contact]);
  const clientKo = { ...client, pousserLeads: async () => { throw new ErreurSalesBlink('client', 400, 'refus'); } };
  await envoyerEmailSalesBlink({ pool }, { organizationId: m2.org, channel: 'email', actionId: m2.act, email: { enrollmentId: m2.insc, contactId: m2.contact, stepId: etapes2[1], campaignId: m2.camp, templateParentId: famille, senderId: sender2, locale: 'fr' } }, clientKo);
  const r2 = await lire(m2, null);
  check('44. échec définitif du transport : l\'inscription est en pause au RANG 1, motif salesblink_client_error',
    r2.insc.status === 'paused' && r2.insc.current_step === 1 && r2.insc.stop_reason === 'salesblink_client_error', JSON.stringify(r2));
  delete process.env.SALESBLINK_API_KEY;
}

// ---------------------------------------------------------------- rejeu : refus de l'enfilage et corps périmé
const sansLigneDeFile = async (m) => (await q(`select count(*)::int n from linkedin_action_queue where organization_id = $1`, [m.org])).rows[0].n;

async function refusDeLEnfilage() {
  console.log('\n16. une reprise que l\'enfilage refuse (même contact, même type déjà parti) ne disparaît pas en silence');
  const m = await monde();
  const contact = (await q(`insert into contacts (organization_id, linkedin_url) values ($1, 'https://www.linkedin.com/in/doublon') returning id`, [m.org])).rows[0].id;
  const inscrire = async (nom, statutAction, statutInsc) => {
    const camp = (await q(`insert into campaigns (organization_id, name, status) values ($1, $2, 'active') returning id`, [m.org, nom])).rows[0].id;
    const etape = (await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, 0, 'linkedin_invite') returning id`, [camp])).rows[0].id;
    const insc = (await q(`insert into enrollments (organization_id, campaign_id, contact_id, current_step, next_action_at, status) values ($1, $2, $3, 1, null, $4) returning id`, [m.org, camp, contact, statutInsc])).rows[0].id;
    const act = (await q(`insert into actions (organization_id, enrollment_id, step_id, channel, status, idempotency_key) values ($1, $2, $3, 'linkedin_invite', $4, $5) returning id`, [m.org, insc, etape, statutAction, actionIdempotencyKey(insc, etape)])).rows[0].id;
    return { insc, act };
  };
  const partie = await inscrire('Partie', 'dispatched', 'completed');
  const reprise = await inscrire('Reprise', 'scheduled', 'active');
  await q(`insert into linkedin_action_queue (organization_id, contact_id, action_id, linkedin_url, kind, method, status, sent_at) values ($1,$2,$3,'https://www.linkedin.com/in/doublon','invite','serveur','sent', now())`, [m.org, contact, partie.act]);
  const refusee = (await q(`insert into linkedin_action_queue (organization_id, contact_id, action_id, linkedin_url, kind, method, status, error_code, reprise_le) values ($1,$2,$3,'https://www.linkedin.com/in/doublon','invite','serveur','failed','already_invited', now()) returning id`, [m.org, contact, reprise.act])).rows[0].id;

  const n = await rejouerActionsLinkedInReprises({ pool });
  const ligne = (await q(`select status, reprise_le from linkedin_action_queue where id = $1`, [refusee])).rows[0];
  const a = (await q(`select status::text from actions where id = $1`, [reprise.act])).rows[0];
  const e = (await q(`select status::text, stop_reason from enrollments where id = $1`, [reprise.insc])).rows[0];
  check('50. rien n\'est réenfilé et le compte reste exact (0 réenfilée, aucune ligne de plus)', n === 0 && (await sansLigneDeFile(m)) === 2, `${n} ${await sansLigneDeFile(m)}`);
  check('51. la marque de reprise est levée (le balayage de pause peut reprendre la main)', ligne.reprise_le === null && ligne.status === 'failed', JSON.stringify(ligne));
  check('52. l\'action est en échec et l\'inscription en pause avec le motif deja_en_attente (l\'écran dit la vérité)',
    a.status === 'failed' && e.status === 'paused' && e.stop_reason === 'linkedin_refus:deja_en_attente', JSON.stringify({ a, e }));
  const encore = await rejouerActionsLinkedInReprises({ pool });
  check('52b. un second balayage ne refait rien (idempotent)', encore === 0 && (await sansLigneDeFile(m)) === 2);
  const intacte = (await q(`select status::text from actions where id = $1`, [partie.act])).rows[0];
  check('52c. l\'inscription qui a déjà envoyé n\'est pas touchée', intacte.status === 'dispatched');
}

async function corpsReRendu() {
  console.log('\n17. le corps réenfilé est RE-RENDU depuis le modèle : un message périmé ne part pas');
  const monter = async ({ corpsModele, locale = null, entreprise = false }) => {
    const m = await monde();
    const compte = entreprise ? (await q(`insert into accounts (organization_id, name) values ($1, 'Acme') returning id`, [m.org])).rows[0].id : null;
    const contact = (await q(`insert into contacts (organization_id, linkedin_url, first_name, locale, account_id) values ($1, 'https://www.linkedin.com/in/jeanne', 'Jeanne', $2, $3) returning id`, [m.org, locale, compte])).rows[0].id;
    const modele = (await q(`insert into message_templates (organization_id, name, channel, locale, body) values ($1, 'Relance', 'linkedin_message', 'fr', $2) returning id`, [m.org, corpsModele])).rows[0].id;
    const camp = (await q(`insert into campaigns (organization_id, name, status) values ($1, 'C', 'active') returning id`, [m.org])).rows[0].id;
    const etape = (await q(`insert into sequence_steps (campaign_id, position, channel, template_parent_id) values ($1, 0, 'linkedin_message', $2) returning id`, [camp, modele])).rows[0].id;
    const insc = (await q(`insert into enrollments (organization_id, campaign_id, contact_id, current_step, next_action_at) values ($1, $2, $3, 1, null) returning id`, [m.org, camp, contact])).rows[0].id;
    const act = (await q(`insert into actions (organization_id, enrollment_id, step_id, channel, status, idempotency_key, payload) values ($1, $2, $3, 'linkedin_message', 'scheduled', $4, '{"messageBody":"Bonjour Jeanne, ancienne offre"}'::jsonb) returning id`, [m.org, insc, etape, actionIdempotencyKey(insc, etape)])).rows[0].id;
    await q(`insert into linkedin_action_queue (organization_id, contact_id, action_id, linkedin_url, kind, method, status, error_code, reprise_le, message_body) values ($1,$2,$3,'https://www.linkedin.com/in/jeanne','message','serveur','failed','cannot_message', now(), 'Bonjour Jeanne, ancienne offre')`, [m.org, contact, act]);
    return { m, modele, act };
  };

  // Le modèle est corrigé APRÈS le rendu d'origine : c'est la version corrigée qui doit partir.
  const a = await monter({ corpsModele: 'Bonjour {{prenom}}, ancienne offre' });
  await q(`update message_templates set body = 'Bonjour {{prenom}}, nouvelle offre' where id = $1`, [a.modele]);
  const n = await rejouerActionsLinkedInReprises({ pool });
  const neuve = (await q(`select message_body, status from linkedin_action_queue where action_id = $1 and status = 'pending'`, [a.act])).rows;
  check('53. la ligne réenfilée porte le texte du modèle CORRIGÉ, jamais l\'ancien',
    n === 1 && neuve.length === 1 && neuve[0].message_body === 'Bonjour Jeanne, nouvelle offre', JSON.stringify(neuve));
  const payload = (await q(`select payload->>'messageBody' as corps from actions where id = $1`, [a.act])).rows[0];
  check('54. l\'action montre le corps qui part', payload.corps === 'Bonjour Jeanne, nouvelle offre', JSON.stringify(payload));

  // Variable non résolue : l'action est bloquée comme le tick la bloque, rien n'est enfilé.
  const b = await monter({ corpsModele: 'Bonjour {{prenom}} de {{entreprise}}' });
  const nb = await rejouerActionsLinkedInReprises({ pool });
  const ab = (await q(`select status::text, block_reason::text, payload->'missingVariables' as manquantes from actions where id = $1`, [b.act])).rows[0];
  check('55. une variable non résolue bloque l\'action (missing_variable) et n\'enfile rien',
    nb === 0 && ab.status === 'blocked' && ab.block_reason === 'missing_variable' && JSON.stringify(ab.manquantes) === '["entreprise"]' && (await sansLigneDeFile(b.m)) === 1, JSON.stringify(ab));

  // Langue sans variante : même blocage que le tick (missing_locale).
  const c = await monter({ corpsModele: 'Bonjour {{prenom}}', locale: 'de' });
  await rejouerActionsLinkedInReprises({ pool });
  const ac = (await q(`select status::text, block_reason::text from actions where id = $1`, [c.act])).rows[0];
  check('56. une langue du contact sans variante bloque l\'action (missing_locale) et n\'enfile rien',
    ac.status === 'blocked' && ac.block_reason === 'missing_locale' && (await sansLigneDeFile(c.m)) === 1, JSON.stringify(ac));
}

async function rejeuActionsEnAttente() {
  console.log('\n18. rejeu des actions LinkedIn JAMAIS enfilées (dernière étape, inscription completed)');
  const monter = async (opts = {}) => {
    const m = await monde();
    const contact = (await q(`insert into contacts (organization_id, linkedin_url, first_name) values ($1, 'https://www.linkedin.com/in/Rejeu', 'Jeanne') returning id`, [m.org])).rows[0].id;
    const camp = (await q(`insert into campaigns (organization_id, name, status) values ($1, 'C', $2) returning id`, [m.org, opts.campagne ?? 'active'])).rows[0].id;
    const etape = (await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, 0, 'linkedin_message') returning id`, [camp])).rows[0].id;
    const insc = (await q(`insert into enrollments (organization_id, campaign_id, contact_id, current_step, status, next_action_at) values ($1, $2, $3, 1, $4, null) returning id`, [m.org, camp, contact, opts.inscription ?? 'completed'])).rows[0].id;
    const act = (await q(`insert into actions (organization_id, enrollment_id, step_id, channel, status, idempotency_key, payload, created_at, dispatched_at) values ($1, $2, $3, 'linkedin_message', 'scheduled', $4, '{}'::jsonb, now() - $5::interval, $6) returning id`,
      [m.org, insc, etape, actionIdempotencyKey(insc, etape), opts.age ?? '10 minutes', opts.dispatchee ? new Date() : null])).rows[0].id;
    if (opts.suppression) await q(`insert into suppressions (organization_id, scope, value) values ($1, 'linkedin', 'HTTPS://www.linkedin.com/in/rejeu')`, [m.org]);
    if (opts.pause) await q(`update organizations set sending_paused_at = now() where id = $1`, [m.org]);
    if (opts.ligne) await q(`insert into linkedin_action_queue (organization_id, contact_id, action_id, linkedin_url, kind, method, status) values ($1, $2, $3, 'https://www.linkedin.com/in/rejeu', 'message', 'serveur', 'pending')`, [m.org, contact, act]);
    return { m, act, contact };
  };
  // Un seul balayage vu depuis l'organisation du cas : les autres cas de la base ne comptent pas.
  const balayer = async (cas) => {
    const jobs = [];
    const boss = { insert: async (lot) => { jobs.push(...lot); } };
    await rejouerActionsLinkedInEnAttente({ pool, boss });
    return jobs.filter((j) => j.data.organizationId === cas.m.org);
  };

  const a = await monter();
  const ja = await balayer(a);
  check('57. une action jamais enfilée, inscription completed, campagne active, est réenfilée avec le job du tick',
    ja.length === 1 && ja[0].name === 'actions.dispatch' && ja[0].data.channel === 'linkedin_message' && ja[0].data.actionId === a.act &&
    ja[0].data.linkedin.linkedinUrl === 'https://www.linkedin.com/in/Rejeu' && ja[0].data.linkedin.contactId === a.contact &&
    ja[0].data.linkedin.actionId === a.act && ja[0].data.linkedin.messageBody === null, JSON.stringify(ja));
  const b = await monter({ campagne: 'paused' });
  check('58. la même, campagne non active : PAS réenfilée', (await balayer(b)).length === 0);
  const c = await monter({ dispatchee: true });
  check('59. la même, dispatched_at renseigné : PAS réenfilée', (await balayer(c)).length === 0);
  const d = await monter({ suppression: true });
  check('60. la même, suppression linkedin active sur le contact (casse différente) : PAS réenfilée', (await balayer(d)).length === 0);
  const e = await monter({ pause: true });
  check('61. la même, organisation en pause d\'envoi : PAS réenfilée', (await balayer(e)).length === 0);
  const f = await monter({ age: '30 seconds' });
  check('62. la même, vieille de moins de 2 minutes : PAS réenfilée', (await balayer(f)).length === 0);
  const g = await monter({ ligne: true });
  check('63. la même, avec déjà une ligne de file : PAS réenfilée (jamais deux envois)', (await balayer(g)).length === 0);
  const h = await monter({ inscription: 'replied' });
  check('64. la même, inscription replied : PAS réenfilée', (await balayer(h)).length === 0);
}

async function main() {
  await jouer(preexistant, methode, defaut, trace, suppressions, suppressionAction, pause, refusDefinitif, sansActionLiee, lignesCoinceesRattrapees, balayageGardes, epuisementDesTentatives, etapeSupprimee, panneEntreLesDeuxEcritures, rangContrePosition, reprise, resultatIndetermineJamaisRejoue, cheminEmail, refusDeLEnfilage, corpsReRendu, rejeuActionsEnAttente);
  console.log(`\n[linkedin-envoi] ${failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[linkedin-envoi] ERREUR', e);
  process.exit(2);
});
