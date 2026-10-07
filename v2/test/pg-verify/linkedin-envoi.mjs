// Lot 4b, tâche 2 : exécution RÉELLE, sur Postgres, de ce que la base accepte
// pour un envoi LinkedIn exécuté par le serveur. Tout est du SQL brut : la tâche
// ne touche que le schéma.
//
// Mutations qui font rougir :
//   1. migration : retirer 'serveur' du check sur `method` — contrôle 1 rougit.
//   2. migration : retirer `alter column source_run_id drop not null` — 2 rougit.
//   3. migration : retirer la contrainte `linkedin_requetes_une_origine` — 4 et 5 rougissent.
//   4. migration : retirer la colonne `envoi_pause_jusqua` — 7 rougit.
import pg from 'pg';

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
    return e.code ?? String(e.message);
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
  check('1c. une méthode inconnue est refusée (23514)', (await refus(() => action(m.org, 'robot', 'https://www.linkedin.com/in/w'))) === '23514');
  check('1d. une ligne extension_auto déjà sent reste valide',
    (await refus(() => q(`insert into linkedin_action_queue (organization_id, linkedin_url, kind, method, status, sent_at) values ($1, 'https://www.linkedin.com/in/h', 'invite', 'extension_auto', 'sent', now())`, [m.org]))) === null);
}

async function trace() {
  console.log('\n2. la trace par requête : une origine, et une seule');
  const m = await monde();
  const a = (await action(m.org, 'serveur')).rows[0].id;
  const ins = (cols, vals) => q(`insert into linkedin_requetes (organization_id, ${cols}) values ($1, ${vals}) returning id`, [m.org, ...(cols === 'source_run_id' ? [m.run] : cols === 'action_queue_id' ? [a] : cols ? [m.run, a] : [])]);
  check('2. une ligne de collecte (source_run_id seul) passe', (await refus(() => ins('source_run_id', '$2'))) === null);
  check('3. une ligne d\'envoi (action_queue_id seul, source_run_id nul) passe', (await refus(() => ins('action_queue_id', '$2'))) === null);
  check('4. les deux renseignés : refusé (23514)', (await refus(() => ins('source_run_id, action_queue_id', '$2, $3'))) === '23514');
  check('5. aucun des deux : refusé (23514)',
    (await refus(() => q(`insert into linkedin_requetes (organization_id) values ($1)`, [m.org]))) === '23514');
  check('5b. une action inexistante est refusée (23503)',
    (await refus(() => q(`insert into linkedin_requetes (organization_id, action_queue_id) values ($1, gen_random_uuid())`, [m.org]))) === '23503');
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

async function main() {
  await jouer(methode, trace, suppressions, suppressionAction, pause);
  console.log(`\n[linkedin-envoi] ${failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[linkedin-envoi] ERREUR', e);
  process.exit(2);
});
