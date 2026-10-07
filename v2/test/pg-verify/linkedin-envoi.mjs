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
//   5. migration 20261007130000 : retirer le `set default` — la migration echoue (controle), et 1e rougit.
import pg from 'pg';
import { regler } from './_linkedin-envoi-bundle.mjs';

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
  file: (await q(`select status, error_code from linkedin_action_queue where id = $1`, [queueId])).rows[0],
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

async function main() {
  await jouer(preexistant, methode, defaut, trace, suppressions, suppressionAction, pause, refusDefinitif, sansActionLiee);
  console.log(`\n[linkedin-envoi] ${failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[linkedin-envoi] ERREUR', e);
  process.exit(2);
});
