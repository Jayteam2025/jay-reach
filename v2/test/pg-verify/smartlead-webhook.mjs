// Vérif hermétique du traitement des webhooks Smartlead (T27) : réponse humaine,
// auto-absence, bounce, désinscription, et contact inconnu → rien stocké.
// Aucune API : on appelle processSmartleadEvent avec des événements fictifs.
import pg from 'pg';
import { processSmartleadEvent } from './_wh.mjs';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = process.env.TEST_ORG;

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}
const q = (sql, params) => pool.query(sql, params);

const ev = (type, email, extra = {}) => ({
  type,
  email,
  campaignId: null,
  replyText: null,
  headers: null,
  messageId: null,
  raw: { fixture: true },
  ...extra,
});

async function main() {
  // Nettoyage.
  await q(`delete from notifications where organization_id=$1 and event='contact.replied' and payload->>'title' in ('Nouvelle réponse')`, [ORG]);
  await q(`delete from thread_messages where thread_id in (select id from threads where organization_id=$1 and contact_id in (select id from contacts where organization_id=$1 and email like 'wh-%@example.test'))`, [ORG]);
  await q(`delete from threads where organization_id=$1 and contact_id in (select id from contacts where organization_id=$1 and email like 'wh-%@example.test')`, [ORG]);
  await q(`delete from enrollments where organization_id=$1 and contact_id in (select id from contacts where organization_id=$1 and email like 'wh-%@example.test')`, [ORG]);
  await q(`delete from suppressions where organization_id=$1 and value like 'wh-%@example.test'`, [ORG]);
  await q(`delete from contacts where organization_id=$1 and email like 'wh-%@example.test'`, [ORG]);
  await q(`delete from campaigns where organization_id=$1 and name='WHVERIF'`, [ORG]);

  const src = (await q(`select id from sources where organization_id=$1 limit 1`, [ORG])).rows[0].id;
  const camp = (await q(`insert into campaigns (organization_id, name, status, source_id) values ($1,'WHVERIF','active',$2) returning id`, [ORG, src])).rows[0].id;

  const seed = async (slug) => {
    const email = `wh-${slug}@example.test`;
    const c = (await q(`insert into contacts (organization_id, email, first_name) values ($1,$2,'Test') returning id`, [ORG, email])).rows[0].id;
    await q(`insert into enrollments (organization_id, campaign_id, contact_id, status, current_step, started_at) values ($1,$2,$3,'active',0,now())`, [ORG, camp, c]);
    return { email, id: c };
  };

  console.log('[wh] 1. Réponse humaine → arrêt + fil + message + notification');
  const reply = await seed('reply');
  const r1 = await processSmartleadEvent(pool, ORG, ev('replied', reply.email, { replyText: 'Merci, rappelez-moi la semaine prochaine.', messageId: 'm-1' }));
  check('résultat = reply (human)', r1.stored === true && r1.effect === 'reply' && r1.classification === 'human_reply', JSON.stringify(r1));
  check('inscription arrêtée (replied)', (await q(`select status from enrollments where contact_id=$1`, [reply.id])).rows[0].status === 'replied');
  const thr = (await q(`select id, classification, is_read from threads where organization_id=$1 and contact_id=$2`, [ORG, reply.id])).rows[0];
  check('fil créé (human_reply, non lu)', thr && thr.classification === 'human_reply' && thr.is_read === false);
  check('message entrant stocké', (await q(`select count(*)::int n from thread_messages where thread_id=$1 and direction='in'`, [thr.id])).rows[0].n === 1);
  const notifs = (await q(`select count(*)::int n from notifications where organization_id=$1 and event='contact.replied'`, [ORG])).rows[0].n;
  check('notification créée (règle #9)', notifs >= 1, `n=${notifs}`);

  console.log('\n[wh] 2. Auto-absence → paused_absence + resume_at');
  const abs = await seed('absence');
  await processSmartleadEvent(pool, ORG, ev('replied', abs.email, { replyText: 'Bonjour, je suis absent du bureau jusqu’au 30 août. Réponse automatique.' }));
  const e2 = (await q(`select status, resume_at from enrollments where contact_id=$1`, [abs.id])).rows[0];
  check('inscription en pause absence', e2.status === 'paused_absence' && e2.resume_at !== null, e2.status);

  console.log('\n[wh] 3. Bounce → suppression + inscription bounced');
  const bnc = await seed('bounce');
  const r3 = await processSmartleadEvent(pool, ORG, ev('bounced', bnc.email));
  check('résultat = bounce', r3.stored === true && r3.effect === 'bounce');
  check('suppression email/bounce créée', (await q(`select origin from suppressions where organization_id=$1 and value=$2`, [ORG, bnc.email])).rows[0]?.origin === 'bounce');
  check('inscription bounced', (await q(`select status from enrollments where contact_id=$1`, [bnc.id])).rows[0].status === 'bounced');

  console.log('\n[wh] 4. Désinscription → suppression + inscription stopped');
  const uns = await seed('unsub');
  await processSmartleadEvent(pool, ORG, ev('unsubscribed', uns.email));
  check('suppression email/unsubscribe créée', (await q(`select origin from suppressions where organization_id=$1 and value=$2`, [ORG, uns.email])).rows[0]?.origin === 'unsubscribe');
  check('inscription stopped', (await q(`select status from enrollments where contact_id=$1`, [uns.id])).rows[0].status === 'stopped');

  console.log('\n[wh] 5. Contact inconnu → RIEN stocké');
  const before = (await q(`select
      (select count(*)::int from threads where organization_id=$1) as t,
      (select count(*)::int from suppressions where organization_id=$1) as s,
      (select count(*)::int from notifications where organization_id=$1) as n`, [ORG])).rows[0];
  const r5 = await processSmartleadEvent(pool, ORG, ev('replied', 'wh-nobody@example.test', { replyText: 'coucou' }));
  const after = (await q(`select
      (select count(*)::int from threads where organization_id=$1) as t,
      (select count(*)::int from suppressions where organization_id=$1) as s,
      (select count(*)::int from notifications where organization_id=$1) as n`, [ORG])).rows[0];
  check('résultat = non stocké (unknown_contact)', r5.stored === false && r5.reason === 'unknown_contact');
  check('aucune écriture (thread/suppression/notif inchangés)', before.t === after.t && before.s === after.s && before.n === after.n);

  // Nettoyage.
  await q(`delete from suppressions where organization_id=$1 and value like 'wh-%@example.test'`, [ORG]);
  await q(`delete from campaigns where organization_id=$1 and name='WHVERIF'`, [ORG]);
  await q(`delete from contacts where organization_id=$1 and email like 'wh-%@example.test'`, [ORG]);

  await pool.end();
  console.log(`\n[wh] ${failures === 0 ? 'OK — tout est vert' : `ÉCHEC — ${failures} rouge(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[wh] erreur:', e);
  process.exit(2);
});
