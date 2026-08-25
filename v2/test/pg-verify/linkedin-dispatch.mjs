// Vérif hermétique du routage LinkedIn du dispatch (T22, Phase 4) : un job
// `actions.dispatch` de canal LinkedIn n'appelle AUCUNE API — il enfile l'action
// dans linkedin_action_queue (consommée ensuite par l'extension). Données
// fictives, aucun envoi réel.
import pg from 'pg';
import { runLinkedInDispatch } from './_lkd.mjs';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = process.env.TEST_ORG;

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  console.log('[lkd] préparation…');
  await pool.query(`delete from linkedin_action_queue where organization_id = $1`, [ORG]);
  const c1 = (
    await pool.query(
      `insert into contacts (organization_id, linkedin_url) values ($1, 'https://www.linkedin.com/in/carla-fictif') returning id`,
      [ORG],
    )
  ).rows[0].id;

  console.log('\n[lkd] 1. Canal invitation → ligne enfilée (kind=invite)');
  const id1 = await runLinkedInDispatch(pool, {
    organizationId: ORG,
    channel: 'linkedin_invite',
    linkedin: { linkedinUrl: 'https://www.linkedin.com/in/carla-fictif', contactId: c1 },
  });
  check('invitation enfilée', typeof id1 === 'string', id1 ?? 'null');
  const row1 = (await pool.query(`select kind, status, message_body from linkedin_action_queue where id = $1`, [id1])).rows[0];
  check('kind=invite, status=pending, sans corps', row1?.kind === 'invite' && row1?.status === 'pending' && row1?.message_body === null);

  console.log('\n[lkd] 2. Dédup : même contact + invite → null');
  const dup = await runLinkedInDispatch(pool, {
    organizationId: ORG,
    channel: 'linkedin_invite',
    linkedin: { linkedinUrl: 'https://www.linkedin.com/in/carla-fictif', contactId: c1 },
  });
  check('doublon refusé', dup === null);

  console.log('\n[lkd] 3. Canal message → ligne enfilée (kind=message + corps)');
  const id2 = await runLinkedInDispatch(pool, {
    organizationId: ORG,
    channel: 'linkedin_message',
    linkedin: { linkedinUrl: 'https://www.linkedin.com/in/carla-fictif', contactId: c1, messageBody: 'Bonjour Carla.' },
  });
  check('message enfilé', typeof id2 === 'string', id2 ?? 'null');
  const row2 = (await pool.query(`select kind, message_body from linkedin_action_queue where id = $1`, [id2])).rows[0];
  check('kind=message + corps conservé', row2?.kind === 'message' && row2?.message_body === 'Bonjour Carla.');

  console.log('\n[lkd] 4. Aucun envoi : tout reste en pending');
  const pending = (await pool.query(`select count(*)::int n from linkedin_action_queue where organization_id = $1 and status = 'pending'`, [ORG])).rows[0].n;
  check('2 actions en attente (rien d’envoyé)', pending === 2, `pending=${pending}`);

  console.log(`\n[lkd] ${failures === 0 ? '✅ TOUT VERT' : `❌ ${failures} échec(s)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[lkd] ERREUR', e);
  process.exit(2);
});
