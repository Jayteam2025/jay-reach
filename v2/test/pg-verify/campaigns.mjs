// Vérif hermétique de l'éditeur de campagne (T24) : contrainte source XOR liste,
// entry_rules jsonb, ajout/mise à jour d'étapes, réordonnancement atomique (RPC
// move_sequence_step) sous contrainte unique (campaign_id, position). Zéro envoi.
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = process.env.TEST_ORG;
const OWNER = process.env.TEST_USER;

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  const c = await pool.connect();
  const q = (sql, params) => c.query(sql, params);

  await q(`reset role`);
  await q(`delete from campaigns where organization_id=$1 and name like 'CAMPVERIF%'`, [ORG]);
  const src = (await q(`select id from sources where organization_id=$1 limit 1`, [ORG])).rows[0].id;

  console.log('[camp] 1. Contrainte source XOR liste');
  let bothRejected = false;
  try {
    await q(
      `insert into campaigns (organization_id, name, status, source_id, list_id) values ($1,'CAMPVERIF both','draft',$2,$2)`,
      [ORG, src],
    );
  } catch (e) {
    bothRejected = e.code === '23514'; // check_violation
  }
  check('source ET liste → rejeté (campaigns_one_source)', bothRejected);

  let noneRejected = false;
  try {
    await q(`insert into campaigns (organization_id, name, status) values ($1,'CAMPVERIF none','draft')`, [ORG]);
  } catch (e) {
    noneRejected = e.code === '23514';
  }
  check('ni source ni liste → rejeté', noneRejected);

  console.log('\n[camp] 2. Création + entry_rules jsonb');
  const camp = (
    await q(
      `insert into campaigns (organization_id, name, status, source_id, entry_rules, daily_cap)
       values ($1,'CAMPVERIF Relance','draft',$2,$3::jsonb,50) returning id`,
      [ORG, src, JSON.stringify({ min_score: 60, personas: ['11111111-1111-1111-1111-111111111111'] })],
    )
  ).rows[0].id;
  const er = (await q(`select entry_rules from campaigns where id=$1`, [camp])).rows[0].entry_rules;
  check('entry_rules persistées (min_score + personas)', er.min_score === 60 && Array.isArray(er.personas));

  console.log('\n[camp] 3. Étapes : ajout, positions, conditions');
  const addStep = async (pos, channel, delay, cond) =>
    (
      await q(
        `insert into sequence_steps (campaign_id, position, channel, delay_hours, conditions)
         values ($1,$2,$3,$4,$5::jsonb) returning id`,
        [camp, pos, channel, delay, JSON.stringify(cond ? { requires: cond } : {})],
      )
    ).rows[0].id;
  const s0 = await addStep(0, 'email', 0, null);
  const s1 = await addStep(1, 'linkedin_invite', 48, null);
  const s2 = await addStep(2, 'linkedin_message', 24, 'no_reply');
  let dupRejected = false;
  try {
    await addStep(0, 'email', 0, null);
  } catch (e) {
    dupRejected = e.code === '23505';
  }
  check('position dupliquée → rejetée (unique campaign_id,position)', dupRejected);
  const cond = (await q(`select conditions from sequence_steps where id=$1`, [s2])).rows[0].conditions;
  check('condition persistée (requires=no_reply)', cond.requires === 'no_reply');

  console.log('\n[camp] 4. Réordonnancement atomique (RPC swap sous contrainte unique)');
  await q(`set role authenticated`);
  await q(`select set_config('test.user_id', $1, false)`, [OWNER]);
  await q(`select app.move_sequence_step($1, false)`, [s0]); // descend s0 (0 -> 1)
  await q(`reset role`);
  const order = (
    await q(`select id, position from sequence_steps where campaign_id=$1 order by position`, [camp])
  ).rows;
  const posOf = (id) => order.find((r) => r.id === id)?.position;
  check('swap effectué : s0 et s1 échangés', posOf(s0) === 1 && posOf(s1) === 0, JSON.stringify(order.map((r) => r.position)));
  check('aucune position dupliquée après swap', new Set(order.map((r) => r.position)).size === order.length);

  console.log('\n[camp] 5. Mise à jour + suppression');
  await q(`update sequence_steps set delay_hours=72 where id=$1`, [s1]);
  check('délai mis à jour', (await q(`select delay_hours from sequence_steps where id=$1`, [s1])).rows[0].delay_hours === 72);
  await q(`delete from sequence_steps where id=$1`, [s2]);
  check('étape supprimée', (await q(`select count(*)::int n from sequence_steps where campaign_id=$1`, [camp])).rows[0].n === 2);

  await q(`delete from campaigns where organization_id=$1 and name like 'CAMPVERIF%'`, [ORG]);
  c.release();
  await pool.end();
  console.log(`\n[camp] ${failures === 0 ? 'OK — tout est vert' : `ÉCHEC — ${failures} rouge(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[camp] erreur:', e);
  process.exit(2);
});
