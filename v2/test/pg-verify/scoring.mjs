// Vérif hermétique du scoring (T12) après arbitrage option A : le prompt ET le
// seuil viennent de la SOURCE du signal (`sources.config`), plus de la persona.
// Scorer déterministe injecté (zéro réseau, zéro appel LLM). On prouve :
//   1. pré-filtre cabinet (blacklist) avant tout appel modèle ;
//   2. pré-filtre fraîcheur ;
//   3. seuil PAR SOURCE honoré (65 passe à 60, échoue à 70) ;
//   4. auto-apprentissage (score 0 + verdict cabinet → blacklist + discarded) ;
//   5. une source SANS prompt exploitable ne score pas : signaux laissés « new ».
import pg from 'pg';
import { runScore } from './_score.mjs';
import { attachSignalsToAccount } from './_db.mjs';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = process.env.TEST_ORG;

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}
const q = (sql, params) => pool.query(sql, params);

// Prompt « exploitable » = ≥ 200 caractères (seuil du handler).
const PROMPT = 'Tu qualifies des signaux de recrutement pour une PME industrielle. '.repeat(4);

// Scorer déterministe : le score dépend du nom d'entreprise.
const scorer = async (prospects) =>
  prospects.map((p) => {
    const name = (p.company || '').toLowerCase();
    if (name.includes('cabinet louche'))
      return { id: p.id, score: 0, reason: 'cabinet de recrutement, recrute pour le compte d’un client' };
    if (name.includes('super pme')) return { id: p.id, score: 82, reason: 'PME industrielle en croissance' };
    if (name.includes('moyenne pme')) return { id: p.id, score: 65, reason: 'match correct' };
    return { id: p.id, score: 40, reason: 'hors cible' };
  });

async function mkSource(name, config) {
  return (
    await q(
      `insert into sources (organization_id, provider_id, name, config, is_active)
       values ($1,'francetravail',$2,$3::jsonb,true) returning id`,
      [ORG, name, JSON.stringify(config)],
    )
  ).rows[0].id;
}

async function mkSignal(sourceId, ext, company, { daysAgo = 1 } = {}) {
  return (
    await q(
      `insert into signals
         (organization_id, source_id, provider_id, external_id, kind, occurred_at,
          status, company_hint, title)
       values ($1,$2,'francetravail',$3,'job_posting', now() - ($4 || ' days')::interval,
          'new',$5,'Commercial itinérant')
       returning id`,
      [ORG, sourceId, ext, String(daysAgo), company],
    )
  ).rows[0].id;
}

const statusOf = async (id) =>
  (await q(`select status, discard_reason, score from signals where id=$1`, [id])).rows[0];

async function main() {
  console.log('[score] préparation (données fictives)…');
  // Nettoyage d'un run précédent.
  await q(`delete from signals where organization_id=$1 and external_id like 'VERIF-%'`, [ORG]);
  await q(`delete from sources where organization_id=$1 and name like 'VERIF %'`, [ORG]);
  await q(`delete from accounts where organization_id=$1 and name='VERIF Opposition SA'`, [ORG]);
  await q(`delete from recruitment_agencies_blacklist where organization_id=$1 and source='auto_score'`, [ORG]);

  // Source A : configurée pour le scoring (prompt + seuil 70).
  const srcA = await mkSource('VERIF Source A', { scoring_prompt: PROMPT, match_threshold: 70 });
  // Source B : AUCUN prompt → ses signaux ne doivent pas être scorés.
  const srcB = await mkSource('VERIF Source B', { note: 'pas de prompt' });

  const idAgency = await mkSignal(srcA, 'VERIF-agency', 'Adecco France'); // blacklist
  const idStale = await mkSignal(srcA, 'VERIF-stale', 'Vieux Signal SA', { daysAgo: 60 });
  const idGood = await mkSignal(srcA, 'VERIF-good', 'Super PME SAS'); // 82 ≥ 70
  const idMid = await mkSignal(srcA, 'VERIF-mid', 'Moyenne PME SARL'); // 65 < 70
  const idCabinet = await mkSignal(srcA, 'VERIF-cabinet', 'Cabinet Louche'); // 0 + verdict
  const idNoPrompt = await mkSignal(srcB, 'VERIF-noprompt', 'Sans Prompt SARL');

  // Opposition au démarchage : un signal rattaché à un compte dont
  // `prospecting_opposition = true` doit être écarté (filtre non désactivable).
  const oppAccount = (
    await q(
      `insert into accounts (organization_id, name, siren, prospecting_opposition, resolution_status)
       values ($1,'VERIF Opposition SA','999888777',true,'resolved') returning id`,
      [ORG],
    )
  ).rows[0].id;
  const idOpp = (
    await q(
      `insert into signals (organization_id, source_id, provider_id, external_id, kind, occurred_at, status, company_hint, title, account_id)
       values ($1,$2,'francetravail','VERIF-opp','job_posting', now(), 'new','VERIF Opposition SA','Commercial itinérant',$3) returning id`,
      [ORG, srcA, oppAccount],
    )
  ).rows[0].id;

  // Cas de la CHAÎNE RÉELLE : le scraper insère un signal SANS account_id, et
  // c'est la qualification qui doit le rattacher. Le harnais posait le lien
  // lui-même, ce qui masquait un chaînage manquant : le compte était résolu mais
  // jamais écrit sur le signal, donc le pré-filtre NAF et le filtre d'opposition
  // — qui lisent le compte à travers le signal — ne s'appliquaient à rien.
  const idDetache = (
    await q(
      `insert into signals (organization_id, source_id, provider_id, external_id, kind, occurred_at, status, company_hint, title)
       values ($1,$2,'francetravail','VERIF-detache','job_posting', now(), 'new','VERIF Opposition SA','Technicien de maintenance') returning id`,
      [ORG, srcA],
    )
  ).rows[0].id;
  const rattaches = await attachSignalsToAccount(pool, ORG, 'VERIF Opposition SA', oppAccount);
  check('la qualification rattache les signaux orphelins', rattaches >= 1, `${rattaches} rattaché(s)`);
  const lien = (await q(`select account_id from signals where id=$1`, [idDetache])).rows[0];
  check('le signal porte désormais son compte', lien?.account_id === oppAccount);

  console.log('[score] exécution runScore…\n');
  const summary = await runScore({ pool, organizationId: ORG, scorer });

  const agency = await statusOf(idAgency);
  const stale = await statusOf(idStale);
  const good = await statusOf(idGood);
  const mid = await statusOf(idMid);
  const cabinet = await statusOf(idCabinet);
  const detache = await statusOf(idDetache);
  const noPrompt = await statusOf(idNoPrompt);

  const opp = await statusOf(idOpp);
  check('opposition au démarchage → écarté (prospecting_opposition)', opp.status === 'discarded' && opp.discard_reason === 'prospecting_opposition', `${opp.status}/${opp.discard_reason}`);
  // Le signal rattaché par la qualification doit subir le même filtre : c'est ce
  // que la chaîne réelle produit, et c'était le cas non couvert.
  check(
    'signal rattaché par la qualification → opposition appliquée aussi',
    detache.status === 'discarded' && detache.discard_reason === 'prospecting_opposition',
    `${detache.status}/${detache.discard_reason}`,
  );
  check('cabinet blacklisté pré-filtré (Adecco)', agency.status === 'discarded' && agency.discard_reason === 'recruitment_agency', agency.status);
  check('signal périmé écarté (60 j)', stale.status === 'discarded' && stale.discard_reason === 'stale', stale.status);
  check('bonne PME qualifiée (82 ≥ seuil source 70)', good.status === 'qualified' && Number(good.score) === 82, `${good.status}/${good.score}`);
  check('PME moyenne écartée par le SEUIL DE LA SOURCE (65 < 70)', mid.status === 'discarded' && mid.discard_reason === 'low_score', `${mid.status}/${mid.score}`);
  check('cabinet auto-appris (score 0 + verdict)', cabinet.status === 'discarded' && cabinet.discard_reason === 'recruitment_agency', cabinet.status);
  check('signal d’une source SANS prompt laissé « new »', noPrompt.status === 'new' && noPrompt.score === null, noPrompt.status);

  const learned = (
    await q(
      `select 1 from recruitment_agencies_blacklist
        where organization_id=$1 and source='auto_score' and name_normalized like '%cabinetlouche%'`,
      [ORG],
    )
  ).rowCount;
  check('cabinet ajouté à la blacklist de l’org', learned === 1);

  console.log('\n[score] récapitulatif runScore :', JSON.stringify(summary));
  check('résumé : 2 qualifiés+écartés scorés attendus (3 scorés sur source A)', summary.scored === 3, `scored=${summary.scored}`);
  check('résumé : source sans prompt ne bloque pas (skippedNoPrompt=false)', summary.skippedNoPrompt === false);

  // --- Lot à taille réelle : le point bloquant #19 (max_tokens figé) n'apparaît
  //     qu'à partir d'une trentaine de signaux. On en score 45 d'un coup pour
  //     prouver que le pipeline traite un lot plein (le budget de sortie réel est
  //     garanti côté adaptateur par `scoringMaxTokens`, testé en unitaire).
  console.log('\n[score] lot plein (45 signaux) :');
  const srcC = await mkSource('VERIF Source C', { scoring_prompt: PROMPT, match_threshold: 60 });
  const N = 45;
  for (let i = 0; i < N; i++) await mkSignal(srcC, `VERIF-bulk-${i}`, `Super PME ${i}`);
  const bulk = await runScore({ pool, organizationId: ORG, scorer });
  check(`45 signaux scorés en un lot (scored=${bulk.scored})`, bulk.scored === N, `scored=${bulk.scored}`);
  check(`45 qualifiés (qualified=${bulk.qualified})`, bulk.qualified === N, `qualified=${bulk.qualified}`);
  const leftNew = (
    await q(`select count(*)::int n from signals where source_id=$1 and status='new'`, [srcC])
  ).rows[0].n;
  check('aucun signal du lot perdu / laissé new', leftNew === 0, `new=${leftNew}`);

  // Nettoyage.
  await q(`delete from signals where organization_id=$1 and external_id like 'VERIF-%'`, [ORG]);
  await q(`delete from sources where organization_id=$1 and name like 'VERIF %'`, [ORG]);
  await q(`delete from accounts where organization_id=$1 and name='VERIF Opposition SA'`, [ORG]);
  await q(`delete from recruitment_agencies_blacklist where organization_id=$1 and source='auto_score'`, [ORG]);

  await pool.end();
  console.log(`\n[score] ${failures === 0 ? 'OK — tout est vert' : `ÉCHEC — ${failures} assertion(s) rouge(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[score] erreur:', e);
  process.exit(2);
});
