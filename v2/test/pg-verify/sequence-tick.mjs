// Vérif hermétique de la chaîne séquenceur → file LinkedIn (T22 / séquenceur) :
// inscription → tick → action idempotente → job de dispatch → linkedin_action_queue.
// Données fictives ; aucun envoi réel (les lignes restent en pending dans la file).
import pg from 'pg';
import { enrollContact, tickDueEnrollments } from './_seq.mjs';
import { runLinkedInDispatch } from './_lkd.mjs';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = process.env.TEST_ORG;
const SOURCE = process.env.TEST_SOURCE;

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}
const q = (sql, params) => pool.query(sql, params);

async function seedCampaign(name, steps) {
  const camp = (
    await q(
      `insert into campaigns (organization_id, name, source_id, status) values ($1,$2,$3,'active') returning id`,
      [ORG, name, SOURCE],
    )
  ).rows[0].id;
  let tplParent = null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    let tpl = null;
    if (s.body) {
      tplParent = (
        await q(
          `insert into message_templates (organization_id, name, channel, locale, body) values ($1,$2,$3,'fr',$4) returning id`,
          [ORG, `${name}-tpl-${i}`, s.channel, s.body],
        )
      ).rows[0].id;
      tpl = tplParent;
    }
    await q(
      `insert into sequence_steps (campaign_id, position, channel, delay_hours, template_parent_id) values ($1,$2,$3,$4,$5)`,
      [camp, i, s.channel, s.delay_hours ?? 0, tpl],
    );
  }
  return camp;
}

async function newContact(vanity) {
  return (
    await q(`insert into contacts (organization_id, linkedin_url, email) values ($1,$2,$3) returning id`, [
      ORG,
      `https://www.linkedin.com/in/${vanity}`,
      `${vanity}@example.test`,
    ])
  ).rows[0].id;
}

async function main() {
  console.log('[seq] nettoyage + préparation…');
  await q(`delete from actions where organization_id=$1`, [ORG]);
  await q(`delete from enrollments where organization_id=$1`, [ORG]);
  await q(`delete from sequence_steps where campaign_id in (select id from campaigns where organization_id=$1)`, [ORG]);
  await q(`delete from linkedin_action_queue where organization_id=$1`, [ORG]);
  await q(`delete from suppressions where organization_id=$1`, [ORG]);
  await q(`delete from message_templates where organization_id=$1`, [ORG]);
  await q(`delete from campaigns where organization_id=$1`, [ORG]);

  const camp = await seedCampaign('LK fictive', [
    { channel: 'linkedin_invite', delay_hours: 0 },
    { channel: 'linkedin_message', delay_hours: 0, body: 'Bonjour, ravi de vous connecter.' },
  ]);
  const c1 = await newContact('alice-seq');

  console.log('\n[seq] 1. Inscription + dédup');
  const enr = await enrollContact(pool, { organizationId: ORG, campaignId: camp, contactId: c1 });
  check('inscription créée', typeof enr === 'string', enr ?? 'null');
  const dup = await enrollContact(pool, { organizationId: ORG, campaignId: camp, contactId: c1 });
  check('2e inscription du même contact refusée', dup === null);

  console.log('\n[seq] 2. Tick 1 → étape invitation');
  const jobs1 = await tickDueEnrollments(pool, new Date());
  check('1 job de dispatch (invite)', jobs1.length === 1 && jobs1[0].channel === 'linkedin_invite', JSON.stringify(jobs1.map((j) => j.channel)));
  const a1 = (await q(`select channel, status from actions where enrollment_id=$1 order by created_at`, [enr])).rows;
  check('action invite enregistrée (scheduled)', a1.length === 1 && a1[0].channel === 'linkedin_invite' && a1[0].status === 'scheduled');
  const e1 = (await q(`select current_step, status from enrollments where id=$1`, [enr])).rows[0];
  check('inscription avancée à l’étape 1', e1.current_step === 1 && e1.status === 'active', `step=${e1.current_step} ${e1.status}`);

  console.log('\n[seq] 3. Dispatch du job → file LinkedIn');
  const qid = await runLinkedInDispatch(pool, jobs1[0]);
  check('invitation enfilée dans linkedin_action_queue', typeof qid === 'string');
  const lk = (await q(`select kind, status from linkedin_action_queue where id=$1`, [qid])).rows[0];
  check('kind=invite, status=pending (aucun envoi)', lk.kind === 'invite' && lk.status === 'pending');

  console.log('\n[seq] 4. Tick 2 → étape message (corps du template)');
  const jobs2 = await tickDueEnrollments(pool, new Date(Date.now() + 1000));
  check('1 job de dispatch (message + corps)', jobs2.length === 1 && jobs2[0].channel === 'linkedin_message' && jobs2[0].linkedin.messageBody === 'Bonjour, ravi de vous connecter.', JSON.stringify(jobs2[0]?.linkedin));
  const e2 = (await q(`select current_step, status, next_action_at from enrollments where id=$1`, [enr])).rows[0];
  check('inscription terminée (completed)', e2.status === 'completed' && e2.next_action_at === null, e2.status);

  console.log('\n[seq] 5. Idempotence : tick rejoué → aucune nouvelle action');
  const before = (await q(`select count(*)::int n from actions where organization_id=$1`, [ORG])).rows[0].n;
  await tickDueEnrollments(pool, new Date(Date.now() + 2000));
  const after = (await q(`select count(*)::int n from actions where organization_id=$1`, [ORG])).rows[0].n;
  check('nombre d’actions inchangé', before === after, `${before}→${after}`);

  console.log('\n[seq] 6. Suppression → action bloquée + arrêt');
  const c2 = await newContact('bob-seq');
  await q(`insert into suppressions (organization_id, scope, value, origin) values ($1,'linkedin',$2,'manual')`, [
    ORG,
    'https://www.linkedin.com/in/bob-seq',
  ]);
  const enr2 = await enrollContact(pool, { organizationId: ORG, campaignId: camp, contactId: c2 });
  const jobs3 = await tickDueEnrollments(pool, new Date(Date.now() + 3000));
  const blocked = (await q(`select status, block_reason from actions where enrollment_id=$1`, [enr2])).rows[0];
  check('aucun job de dispatch pour le contact supprimé', jobs3.every((j) => j.linkedin?.contactId !== c2));
  check('action bloquée (suppression)', blocked?.status === 'blocked' && blocked?.block_reason === 'suppression');
  const e3 = (await q(`select status, stop_reason from enrollments where id=$1`, [enr2])).rows[0];
  check('inscription arrêtée', e3.status === 'stopped' && e3.stop_reason === 'suppression');

  console.log(`\n[seq] ${failures === 0 ? '✅ TOUT VERT' : `❌ ${failures} échec(s)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[seq] ERREUR', e);
  process.exit(2);
});
