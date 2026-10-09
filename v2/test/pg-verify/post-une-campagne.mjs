// Lot 4a, tâche 5 : exécution RÉELLE, sur Postgres, de la règle « un post, une
// campagne ». Aucune requête de production n'est recopiée ici : seules les
// fixtures (organisations, campagnes) sont écrites en SQL.
//
// Mutation qui fait rougir (voir le rapport de la tâche 5) :
//   normalisation : dans `normaliserUrlPost` (sources.ts), remplacer le corps du
//   `try` par `return brut;` — les adresses équivalentes ne sont plus reconnues.
import pg from 'pg';
import { creerCampagne, creerSource, ErreurEntree, modifierReglagesCampagne, modifierSource } from './_post-une-campagne-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

// Chaque section tourne dans son propre `try` : une exception dans l'une ne doit
// pas emporter les suivantes. Un harnais qui saute une preuve en silence est
// pire qu'un harnais rouge — on lit « 1 ÉCHEC » en croyant le reste prouvé.
async function jouer(...sections) {
  for (const section of sections) {
    try {
      await section();
    } catch (e) {
      check(`section ${section.name} : exception, ses contrôles n'ont PAS été joués`, false, String(e?.message ?? e));
    }
  }
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

const POST = 'https://www.linkedin.com/posts/jean-dupont_cold-email-abcd';

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
    'HTTPS://WWW.LINKEDIN.COM/posts/jean-dupont_cold-email-abcd',
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

const ACTIVITE = '7271234567890123456';
const FORME_POSTS = `https://www.linkedin.com/posts/marie-martin_prospection-activity-${ACTIVITE}-wxyz`;

async function identiteDuPost() {
  console.log('identité du post');
  const org = await orgNeuve();
  const ctx = ctxDe(org);
  const c1 = await campagne(org, 'I1');
  const c2 = await campagne(org, 'I2');
  await lierPost(ctx, c1, FORME_POSTS);
  const formes = [
    `https://fr.linkedin.com/posts/marie-martin_prospection-activity-${ACTIVITE}-wxyz`,
    `https://linkedin.com/feed/update/urn:li:activity:${ACTIVITE}`,
    `https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A${ACTIVITE}/?utm_source=share`,
    `https://www.linkedin.com/posts/autre-slug_titre-activity-${ACTIVITE}-qrst`,
  ];
  for (const [i, f] of formes.entries()) {
    const e = await refus(lierPost(ctx, c2, f));
    check(`15.${i + 1} même post sous une autre forme d'adresse : refusé`, e instanceof ErreurEntree, f);
  }
  // Dans l'autre sens : rien n'est confondu.
  await lierPost(ctx, c2, `https://www.linkedin.com/posts/marie-martin_prospection-activity-7271234567890123457-wxyz`);
  check('16. un identifiant d\'activité voisin est un autre post : accepté', (await nbLiens(c2)) === 1);
  const c3 = await campagne(org, 'I3');
  await lierPost(ctx, c3, 'https://exemple.fr/Page/Alpha');
  const c4 = await campagne(org, 'I4');
  await lierPost(ctx, c4, 'https://exemple.fr/Page/alpha');
  check('17. sans identifiant, la casse du chemin est respectée : deux posts distincts', (await nbLiens(c4)) === 1);
  const c5 = await campagne(org, 'I5');
  const e5 = await refus(lierPost(ctx, c5, 'https://www.exemple.fr/Page/Alpha/?utm=1'));
  check('18. sans identifiant, www., barre finale et paramètres sont ignorés : refusé', e5 instanceof ErreurEntree);
  const e6 = await refus(lierPost(ctx, c1, `https://linkedin.com/feed/update/urn:li:activity:${ACTIVITE}`));
  check('19. même post dans la MÊME campagne : refusé (règle alignée sur la modification)', e6 instanceof ErreurEntree);
}

async function personasTrous() {
  console.log('personas : les trous fermés');
  const org = await orgNeuve();
  const ctx = ctxDe(org);
  const mk = async (n) => (await q(`insert into personas (organization_id, name) values ($1, $2) returning id`, [org, n])).rows[0].id;
  const [p1, p2, p3] = [await mk('A'), await mk('B'), await mk('C')];
  // a. changer les personas d'une campagne revérifie ses sources.
  const ca = await campagne(org, 'Réglages', [p1]);
  const { id: sa } = await lierPost(ctx, ca, `${POST}-a`);
  const ea = await refus(modifierReglagesCampagne(ctx, { campagneId: ca, personaIds: [p1, p2] }));
  check('20. passer à deux personas avec une source sans personaId : refusé', ea instanceof ErreurEntree, String(ea));
  check('21. les personas de la campagne n\'ont pas bougé', (await q(`select entry_rules->'personas' p from campaigns where id = $1`, [ca])).rows[0].p.length === 1);
  const da = ea?.details;
  check('21b. le refus est une erreur de formulaire qui nomme la source (aucun champ)',
    da?.fieldErrors && Object.keys(da.fieldErrors).length === 0 &&
    da.formErrors?.[0]?.includes('« Engageurs »') &&
    JSON.stringify(da.sourcesSansPersona) === JSON.stringify([{ nom: 'Engageurs', cas: 'absent' }]), JSON.stringify(da));
  await modifierSource(ctx, { sourceId: sa, nom: 'E', schedule: 'every 24h', config: { urlPost: `${POST}-a`, garder: ['commente'] } });
  // a'. persona périmé : la source garde un persona qui sort de la campagne.
  const cp = await campagne(org, 'Périmé', [p1, p2]);
  await creerSource(ctx, { campagneId: cp, providerId: 'linkedin_post_engagers', nom: 'Engageurs de Dupont',
    config: { urlPost: `${POST}-p`, garder: ['commente'], personaId: p1 } });
  const ep = await refus(modifierReglagesCampagne(ctx, { campagneId: cp, personaIds: [p2] }));
  check('21c. persona périmé : refus nommant la source, cas « perime »',
    ep instanceof ErreurEntree && ep.details.formErrors?.[0]?.includes('« Engageurs de Dupont »') &&
    JSON.stringify(ep.details.sourcesSansPersona) === JSON.stringify([{ nom: 'Engageurs de Dupont', cas: 'perime' }]), JSON.stringify(ep?.details));
  // b. creerCampagne contrôle le persona de la source rattachée.
  const sOrpheline = (await q(`insert into sources (organization_id, name, config) values ($1, 'orph', $2::jsonb) returning id`,
    [org, JSON.stringify({ sourceType: 'linkedin_post_engagers', urlPost: `${POST}-orph`, garder: ['commente'] })])).rows[0].id;
  const eb = await refus(creerCampagne(ctx, { name: 'B1', entryKind: 'source', entryId: sOrpheline, sourceIds: [sOrpheline], personaIds: [p1, p2] }));
  check('22. source orpheline sans personaId vers une campagne à deux personas : refusé', eb instanceof ErreurEntree, String(eb));
  const sEtrangere = (await q(`insert into sources (organization_id, name, config) values ($1, 'etr', $2::jsonb) returning id`,
    [org, JSON.stringify({ sourceType: 'linkedin_post_engagers', urlPost: `${POST}-etr`, garder: ['commente'], personaId: p3 })])).rows[0].id;
  const ec = await refus(creerCampagne(ctx, { name: 'B2', entryKind: 'source', entryId: sEtrangere, sourceIds: [sEtrangere], personaIds: [p1, p2] }));
  check('23. personaId étranger à la liste de la nouvelle campagne : refusé', ec instanceof ErreurEntree, String(ec));
  const okc = await creerCampagne(ctx, { name: 'B3', entryKind: 'source', entryId: sEtrangere, sourceIds: [sEtrangere], personaIds: [p1, p3] });
  check('24. personaId présent dans la liste : accepté', typeof okc.id === 'string');
  // c. un personaId retiré du formulaire ne survit pas à la fusion.
  const cc = await campagne(org, 'Retrait', [p1, p2]);
  const { id: sc } = await lierPost(ctx, cc, `${POST}-c`, { personaId: p2 });
  await q(`update campaigns set entry_rules = '{"personas": []}'::jsonb || jsonb_build_object('personas', jsonb_build_array($2::text)) where id = $1`, [cc, p1]);
  await modifierSource(ctx, { sourceId: sc, nom: 'E', schedule: 'every 24h', config: { urlPost: `${POST}-c`, garder: ['commente'] } });
  const cfg = (await q(`select config from sources where id = $1`, [sc])).rows[0].config;
  check('25. personaId retiré du formulaire : retiré du stockage', !('personaId' in cfg), JSON.stringify(cfg));
  // Et la même règle pour les AUTRES types LinkedIn qui portent un persona. Elle était écrite
  // sur `linkedin_post_engagers` seul : un persona retiré de la source d'un créateur ou d'un
  // concurrent survivait en base, et la collecte continuait de lui attribuer les personnes.
  const { id: scr } = await creerSource(ctx, {
    campagneId: cc,
    providerId: 'linkedin_creator_posts',
    nom: 'Createur',
    config: { profilsCreateurs: ['https://www.linkedin.com/in/une-personne/'], garder: ['reagi'], personaId: p1 },
  });
  await modifierSource(ctx, {
    sourceId: scr,
    nom: 'Createur',
    schedule: 'every 24h',
    config: { profilsCreateurs: ['https://www.linkedin.com/in/une-personne/'], garder: ['reagi'] },
  });
  const cfgCr = (await q(`select config from sources where id = $1`, [scr])).rows[0].config;
  check('25b. posts d un createur : le personaId retiré ne survit pas non plus', !('personaId' in cfgCr), JSON.stringify(cfgCr));
  // d. un personaId étranger est refusé même avec un seul persona.
  const cd = await campagne(org, 'Un seul', [p1]);
  const ed = await refus(lierPost(ctx, cd, `${POST}-d`, { personaId: p3 }));
  check('26. personaId étranger, campagne à un persona : refusé', ed instanceof ErreurEntree);
}

try {
  await q('truncate organizations cascade');
  await jouer(regle, modification, personas, creationDeCampagne, identiteDuPost, personasTrous);
} finally {
  await pool.end();
}
if (failures > 0) {
  console.log(`\n=== POST-UNE-CAMPAGNE FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('\n=== POST-UNE-CAMPAGNE OK ===');
