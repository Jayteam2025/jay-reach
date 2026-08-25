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

  console.log('[score] exécution runScore…\n');
  const summary = await runScore({ pool, organizationId: ORG, scorer });

  const agency = await statusOf(idAgency);
  const stale = await statusOf(idStale);
  const good = await statusOf(idGood);
  const mid = await statusOf(idMid);
  const cabinet = await statusOf(idCabinet);
  const noPrompt = await statusOf(idNoPrompt);

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

  // Nettoyage.
  await q(`delete from signals where organization_id=$1 and external_id like 'VERIF-%'`, [ORG]);
  await q(`delete from sources where organization_id=$1 and name like 'VERIF %'`, [ORG]);
  await q(`delete from recruitment_agencies_blacklist where organization_id=$1 and source='auto_score'`, [ORG]);

  await pool.end();
  console.log(`\n[score] ${failures === 0 ? 'OK — tout est vert' : `ÉCHEC — ${failures} assertion(s) rouge(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[score] erreur:', e);
  process.exit(2);
});
