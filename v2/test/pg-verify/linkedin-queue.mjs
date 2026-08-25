// Vérif hermétique de la file d'actions LinkedIn (T22, Phase 1) : enfile des
// actions FICTIVES (invitation + message), simule les appels de l'extension
// (claimNext / recordResult) à des instants injectés, et ASSERT le pacing.
// Aucun appel LinkedIn : on ne teste que la file + les garde-fous serveur.
import pg from 'pg';
import { validateToken, enqueueAction, claimNext, recordResult } from './_lkq.mjs';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = process.env.TEST_ORG;
const USER = process.env.TEST_USER;

let failures = 0;
function check(label, cond, extra = '') {
  const mark = cond ? '✅' : '❌';
  console.log(`  ${mark} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

// Un instant Paris « dans la fenêtre » (10 h) et « hors fenêtre » (03 h),
// exprimés en UTC (Paris = UTC+2 en août).
const inWindow = new Date('2026-08-20T08:00:00.000Z'); // 10 h Paris
const outWindow = new Date('2026-08-20T01:00:00.000Z'); // 03 h Paris

async function main() {
  console.log('[lkq] préparation des données fictives…');
  // Nettoyage idempotent d'un run précédent.
  await pool.query(`delete from linkedin_action_queue where organization_id = $1`, [ORG]);
  await pool.query(`delete from extension_tokens where organization_id = $1`, [ORG]);
  await pool.query(`delete from linkedin_settings where organization_id = $1`, [ORG]);

  // Réglages : mode auto, plafond quotidien 25.
  await pool.query(
    `insert into linkedin_settings (organization_id, mode, daily_cap) values ($1, 'auto', 25)`,
    [ORG],
  );
  // Jeton d'extension.
  const token = 'tok_fictif_lkq_0001';
  await pool.query(
    `insert into extension_tokens (token, organization_id, user_id, label) values ($1, $2, $3, 'test')`,
    [token, ORG, USER],
  );
  // Deux contacts fictifs.
  const c1 = (
    await pool.query(
      `insert into contacts (organization_id, linkedin_url) values ($1, 'https://www.linkedin.com/in/alice-fictif') returning id`,
      [ORG],
    )
  ).rows[0].id;
  const c2 = (
    await pool.query(
      `insert into contacts (organization_id, linkedin_url) values ($1, 'https://www.linkedin.com/in/bob-fictif') returning id`,
      [ORG],
    )
  ).rows[0].id;

  console.log('\n[lkq] 1. Validation du jeton');
  const org = await validateToken(pool, token);
  check('jeton valide → organization_id', org === ORG, org ?? 'null');
  const bad = await validateToken(pool, 'tok_inexistant');
  check('jeton inconnu → null', bad === null);

  console.log('\n[lkq] 2. Enfilement + déduplication');
  const inv1 = await enqueueAction(pool, {
    organizationId: ORG,
    linkedinUrl: 'https://www.linkedin.com/in/alice-fictif',
    kind: 'invite',
    contactId: c1,
  });
  check('invitation enfilée', typeof inv1 === 'string');
  const invDup = await enqueueAction(pool, {
    organizationId: ORG,
    linkedinUrl: 'https://www.linkedin.com/in/alice-fictif',
    kind: 'invite',
    contactId: c1,
  });
  check('doublon (même contact+invite) refusé', invDup === null);
  const msg1 = await enqueueAction(pool, {
    organizationId: ORG,
    linkedinUrl: 'https://www.linkedin.com/in/alice-fictif',
    kind: 'message',
    contactId: c1,
    messageBody: 'Bonjour Alice, ravi de vous connecter.',
  });
  check('message (même contact, autre kind) accepté', typeof msg1 === 'string');
  await enqueueAction(pool, {
    organizationId: ORG,
    linkedinUrl: 'https://www.linkedin.com/in/bob-fictif',
    kind: 'invite',
    contactId: c2,
  });
  // Antidatage : la timeline simulée démarre à `inWindow` ; on planifie les
  // lignes juste avant, pour qu'elles soient éligibles au claim.
  await pool.query(
    `update linkedin_action_queue set scheduled_for = $2 where organization_id = $1 and status = 'pending'`,
    [ORG, new Date(inWindow.getTime() - 5 * 60_000).toISOString()],
  );

  console.log('\n[lkq] 3. Pacing : fenêtre horaire');
  const outside = await claimNext(pool, ORG, outWindow);
  check('hors fenêtre → aucune action', outside.action === null && outside.reason === 'outside_window', outside.reason);

  console.log('\n[lkq] 4. Claim dans la fenêtre + résultat');
  const claim1 = await claimNext(pool, ORG, inWindow);
  check('claim → une action', claim1.action !== null, claim1.reason ?? 'ok');
  const firstId = claim1.action?.id;
  // La ligne est passée en processing (pas re-claimée par un poll concurrent).
  const claimRace = await claimNext(pool, ORG, inWindow);
  check(
    'poll concurrent immédiat → pas la même action',
    claimRace.action?.id !== firstId,
    claimRace.action ? claimRace.action.id : claimRace.reason,
  );
  // Enregistre l'envoi.
  const rec = await recordResult(pool, { organizationId: ORG, queueId: firstId, status: 'sent', now: inWindow });
  check('recordResult(sent) depuis processing → ok', rec === true);
  // Re-record → refus (plus en processing).
  const recAgain = await recordResult(pool, { organizationId: ORG, queueId: firstId, status: 'sent', now: inWindow });
  check('recordResult répété → refusé (409)', recAgain === false);

  console.log('\n[lkq] 5. Pacing : intervalle entre deux envois');
  // Juste après un envoi (même instant) → trop tôt.
  const tooSoon = await claimNext(pool, ORG, inWindow);
  check('juste après envoi → too_soon', tooSoon.action === null && tooSoon.reason === 'too_soon', tooSoon.reason);
  // 25 min plus tard → l'intervalle (1–20 min) est dépassé → claim OK.
  const later = new Date(inWindow.getTime() + 25 * 60_000);
  const claim2 = await claimNext(pool, ORG, later);
  check('après l’intervalle → nouveau claim', claim2.action !== null, claim2.reason ?? 'ok');

  console.log('\n[lkq] 6. Pacing : plafond quotidien (curseur)');
  await pool.query(`update linkedin_settings set daily_cap = 1 where organization_id = $1`, [ORG]);
  // 1 déjà envoyé aujourd'hui, cap = 1 → refus même hors intervalle.
  const capped = await claimNext(pool, ORG, new Date(inWindow.getTime() + 60 * 60_000));
  check('plafond quotidien atteint → daily_cap_reached', capped.reason === 'daily_cap_reached', capped.reason);

  console.log('\n[lkq] 7. Mode manuel');
  await pool.query(`update linkedin_settings set mode = 'manual', daily_cap = 25 where organization_id = $1`, [ORG]);
  const manual = await claimNext(pool, ORG, new Date(inWindow.getTime() + 2 * 60 * 60_000));
  check('mode manuel → manual_mode', manual.reason === 'manual_mode', manual.reason);

  console.log('\n[lkq] 8. Requeue des lignes bloquées en processing');
  await pool.query(`update linkedin_settings set mode = 'auto' where organization_id = $1`, [ORG]);
  // Solde la ligne encore en processing depuis le poll concurrent (étape 4),
  // pour que la ligne bloquée testée ci-dessous soit la seule candidate.
  if (claimRace.action) {
    await pool.query(`update linkedin_action_queue set status = 'failed' where id = $1`, [claimRace.action.id]);
  }
  // Force la 2e action claimée en processing « ancien » (>10 min).
  const stuckId = claim2.action?.id;
  await pool.query(
    `update linkedin_action_queue set status = 'processing', processing_started_at = $2 where id = $1`,
    [stuckId, new Date(inWindow.getTime() - 60 * 60_000).toISOString()],
  );
  // Un nouveau claim, bien plus tard, doit d'abord requeue puis re-servir cette ligne.
  const afterRequeue = await claimNext(pool, ORG, new Date(inWindow.getTime() + 3 * 60 * 60_000));
  check('ligne bloquée requeue puis re-servie', afterRequeue.action?.id === stuckId, afterRequeue.reason ?? afterRequeue.action?.id);

  console.log(`\n[lkq] ${failures === 0 ? '✅ TOUT VERT' : `❌ ${failures} échec(s)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[lkq] ERREUR', e);
  process.exit(2);
});
