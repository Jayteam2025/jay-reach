// Lot 4a, tâche 5 : exécution RÉELLE, sur Postgres, de la règle « un post, une
// campagne ». Aucune requête de production n'est recopiée ici : seules les
// fixtures (organisations, campagnes) sont écrites en SQL.
//
// Mutation qui fait rougir (voir le rapport de la tâche 5) :
//   normalisation : dans `normaliserUrlPost` (sources.ts), remplacer le corps du
//   `try` par `return brut;` — les adresses équivalentes ne sont plus reconnues.
import pg from 'pg';
import { creerCampagne, creerSource, ErreurEntree, modifierSource } from './_post-une-campagne-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
let seq = 0;
async function orgNeuve() {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  return (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
}
async function campagne(orgId, nom, personas = []) {
  return (await q(
    `insert into campaigns (organization_id, name, status, entry_rules) values ($1, $2, 'draft', $3::jsonb) returning id`,
    [orgId, nom, JSON.stringify({ personas })],
  )).rows[0].id;
}
const ctxDe = (orgId) => ({ ex: pool, organisationId: orgId, utilisateurId: null, role: 'operator' });
const refus = async (promesse) => {
  try {
    await promesse;
    return null;
  } catch (e) {
    return e;
  }
};
const lierPost = (ctx, campagneId, url, extra = {}) =>
  creerSource(ctx, { campagneId, providerId: 'linkedin_post_engagers', nom: 'Engageurs', config: { urlPost: url, garder: ['commente'], ...extra } });
const nbLiens = async (campagneId) =>
  (await q(`select count(*)::int n from campaign_sources where campaign_id = $1`, [campagneId])).rows[0].n;

const POST = 'https://www.linkedin.com/posts/jean-dupont_cold-email-activity-123-abcd';

async function regle() {
  console.log('un post, une campagne');
  const org = await orgNeuve();
  const ctx = ctxDe(org);
  const c1 = await campagne(org, 'Campagne 1');
  const c2 = await campagne(org, 'Campagne 2');

  await lierPost(ctx, c1, POST);
  check('1. premier rattachement accepté', (await nbLiens(c1)) === 1);

  const e2 = await refus(lierPost(ctx, c2, POST));
  check('2. même post sur une seconde campagne : refusé', e2 instanceof ErreurEntree, String(e2));
  check('3. aucun lien ni source écrits par le refus', (await nbLiens(c2)) === 0 &&
    (await q(`select count(*)::int n from sources where organization_id = $1`, [org])).rows[0].n === 1);

  const variantes = [
    `${POST}/`,
    `${POST}?utm_source=share&utm_medium=member_desktop`,
    `${POST}#commentaires`,
    'HTTPS://WWW.LINKEDIN.COM/posts/jean-dupont_cold-email-activity-123-abcd',
    `  ${POST}?rcm=ACoAA  `,
  ];
  for (const [i, v] of variantes.entries()) {
    const e = await refus(lierPost(ctx, c2, v));
    check(`4.${i + 1} écriture différente du même post reconnue : refusée`, e instanceof ErreurEntree, v.trim());
  }

  await lierPost(ctx, c2, `${POST}-autre`);
  check('5. un post différent passe', (await nbLiens(c2)) === 1);

  // Autre organisation : jamais comparée.
  const orgB = await orgNeuve();
  const cB = await campagne(orgB, 'Campagne B');
  await lierPost(ctxDe(orgB), cB, POST);
  check('6. même post dans une autre organisation : accepté', (await nbLiens(cB)) === 1);

  // Un autre type de source n'est pas un post.
  const c3 = await campagne(org, 'Campagne 3');
  await creerSource(ctx, { campagneId: c3, providerId: 'linkedin_keywords', nom: 'Mots', config: { sujets: ['crm'], compteId: 'c1' } });
  check('7. une source d\'un autre type ne bloque rien', (await nbLiens(c3)) === 1);
}

async function modification() {
  console.log('modifierSource');
  const org = await orgNeuve();
  const ctx = ctxDe(org);
  const c1 = await campagne(org, 'M1');
  const c2 = await campagne(org, 'M2');
  await lierPost(ctx, c1, POST);
  const { id } = await lierPost(ctx, c2, `${POST}-b`);
  const e = await refus(modifierSource(ctx, {
    sourceId: id, nom: 'Engageurs', schedule: 'every 24h',
    config: { urlPost: `${POST}?utm_source=share`, garder: ['commente'] },
  }));
  check('8. modifier vers un post déjà pris : refusé', e instanceof ErreurEntree, String(e));
  await modifierSource(ctx, { sourceId: id, nom: 'Renommée', schedule: 'every 24h', config: { urlPost: `${POST}-b/`, garder: ['reagi'] } });
  check('9. se re-enregistrer sur son propre post : accepté', (await q(`select name from sources where id = $1`, [id])).rows[0].name === 'Renommée');
}

async function personas() {
  console.log('personas');
  const org = await orgNeuve();
  const ctx = ctxDe(org);
  const p1 = (await q(`insert into personas (organization_id, name) values ($1, 'P1') returning id`, [org])).rows[0].id;
  const p2 = (await q(`insert into personas (organization_id, name) values ($1, 'P2') returning id`, [org])).rows[0].id;
  const c = await campagne(org, 'Deux personas', [p1, p2]);
  const e = await refus(lierPost(ctx, c, POST));
  check('10. deux personas sans personaId : refusé', e instanceof ErreurEntree);
  const { id } = await lierPost(ctx, c, POST, { personaId: p2 });
  check('11. avec personaId de la campagne : accepté', (await nbLiens(c)) === 1);
  const e2 = await refus(modifierSource(ctx, { sourceId: id, nom: 'E', schedule: 'every 24h', config: { urlPost: POST, garder: ['commente'] } }));
  check('12. modification sans personaId : refusée', e2 instanceof ErreurEntree);
}

async function creationDeCampagne() {
  console.log('creerCampagne');
  const org = await orgNeuve();
  const ctx = ctxDe(org);
  const c1 = await campagne(org, 'Source');
  const { id } = await lierPost(ctx, c1, POST);
  const e = await refus(creerCampagne(ctx, { name: 'Seconde', entryKind: 'source', entryId: id, sourceIds: [id] }));
  check('13. rattacher la source existante à une nouvelle campagne : refusé', e instanceof ErreurEntree, String(e));
  check('14. aucune campagne créée par le refus', (await q(`select count(*)::int n from campaigns where organization_id = $1 and name = 'Seconde'`, [org])).rows[0].n === 0);
}

try {
  await q('truncate organizations cascade');
  await regle();
  await modification();
  await personas();
  await creationDeCampagne();
} finally {
  await pool.end();
}
if (failures > 0) {
  console.log(`\n=== POST-UNE-CAMPAGNE FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('\n=== POST-UNE-CAMPAGNE OK ===');
