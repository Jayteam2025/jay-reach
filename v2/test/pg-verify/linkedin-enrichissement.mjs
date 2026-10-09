// Lot 4a, tâche 8 : exécution RÉELLE, sur Postgres, de l'achat d'une adresse pour
// une personne déjà identifiée — la première dépense d'argent du lot. Aucune
// requête de production n'est recopiée ici : seules les fixtures sont en SQL, et
// l'état de départ est construit par les fonctions de production (collecte d'un
// engageur, scoring, enrichissement). Le SEUL faux est l'appel FullEnrich :
// il est injecté, donc aucun test ne peut dépenser un centime.
//
// Mutations qui font rougir, et l'état OBSERVÉ à chaque fois (rapport de la tâche 8) :
//   R0. migration : retirer le `revoke` -> MIGRATION_FAIL (le bloc de contrôle lève).
//   R1. migration : ne plus ajouter `credits_spent` -> MIGRATION_FAIL.
//  R1b. migration : retirer `check (credits_spent >= 0)` -> 7 rouge, « aucune erreur ».
//   R2. app.record_provider_cost : `insert ... on conflict` au lieu du `update` ->
//       5 rouge, « true lignes=1 » (un coût naît sans crédit consommé).
//   R3. handler : ne plus appeler `enregistrerCout` -> 16, 20 et 21 rouges,
//       `credits_spent: 0` partout.
//   R4. handler, `dependancesEnrichissementReelles` : `?? 0` sur le coût -> AUCUN
//       contrôle d'ici ne rougit (l'achat y est injecté) ; c'est le vitest
//       « rend `undefined`, et surtout PAS zéro » qui tombe (« expected +0 to be undefined »).
//   R5. handler : neutraliser la garde `raisonDeNePasAcheter` -> 23 rouge,
//       « appels=1 used 1->2 » : l'appel PAYANT part sur une adresse fabriquée.
//   R6. handler : ne plus poser `enriched_at` sans email -> 19, 19b et 25 rouges.
//       Le 28 (purge) reste vert : sans marque, la personne est purgée de toute façon.
//   R7. producer.ts : retirer `and c.enriched_at is null` -> 19b rouge (seul : une
//       personne qui a son email est déjà exclue par `c.email is null`).
//   R8. producer.ts : retirer la clause d'adresse fabriquée -> 10 rouge, « bob=1 ».
//   R9. producer.ts : retirer `ct.email is not null` de l'épargne de purge -> 28
//       rouge, la personne sans adresse survit.
//  R10. handler : relancer le 23505 au lieu de le capturer -> la section
//       `conflitDAdresse` lève en entier (« duplicate key value violates unique
//       constraint contacts_org_email_uidx ») : le passage tombe, précisément ce
//       que le contrôle 24 interdit.
import pg from 'pg';
import {
  MSG,
  createRuntime,
  ecarterSignauxTropAnciens,
  ecrireReglage,
  enqueueEnrichmentContactsConnus,
  enregistrerEngageur,
  enrichirContactConnu,
  persistEnrichedContact,
  raisonDeNePasAcheter,
  registerQueues,
  runScore,
  normaliserUrlPost,
} from './_linkedin-enrichissement-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

// Le VRAI runtime pg-boss, créé par le code de production (`createRuntime` +
// `registerQueues`). Il pose le schéma `pgboss`, que le producteur interroge pour
// savoir si l'identifiant du jour existe déjà — en file ou en archive. Les
// sections de SÉLECTION gardent un faux `boss` (jobs en mémoire) : ce qu'elles
// prouvent est le SQL de sélection, et un vrai dépôt y rendrait les contrôles
// suivants ininterprétables (un contact non réenfilé parce qu'il est déjà en
// file ressemblerait à un contact correctement exclu). La section `fileReelle`,
// elle, prouve le dépôt sur le vrai runtime.
const boss = createRuntime(process.env.DATABASE_URL);
await boss.start();
await registerQueues(boss);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

// Chaque section tourne dans son propre `try` : une exception dans l'une ne doit
// pas emporter les suivantes. Un harnais qui saute une preuve en silence est
// pire qu'un harnais rouge.
async function jouer(...sections) {
  for (const section of sections) {
    try {
      await section();
    } catch (e) {
      check(`section ${section.name} : exception, ses contrôles n'ont PAS été joués`, false, String(e?.message ?? e));
    }
  }
}
const erreur = async (promesse) => {
  try {
    await promesse;
    return null;
  } catch (e) {
    return e;
  }
};

/**
 * Capture ce que l'OPÉRATEUR LIT. Un contrôle qui ne lit que l'état final laisse
 * passer un message qui nomme la mauvaise cause — et c'est la cause que
 * l'opérateur lit pour comprendre pourquoi une adresse n'a pas été achetée.
 */
async function enEcoutant(fn) {
  const lignes = [];
  const vraiWarn = console.warn;
  const vraiLog = console.log;
  console.warn = (...a) => lignes.push(a.join(' '));
  console.log = (...a) => lignes.push(a.join(' '));
  try {
    const valeur = await fn();
    return { valeur, lignes };
  } finally {
    console.warn = vraiWarn;
    console.log = vraiLog;
  }
}

let seq = 0;
async function userNeuf() {
  return (await q(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [`u${Date.now()}${(seq += 1)}@test.local`]))
    .rows[0].id;
}
const CONSIGNE = 'Tu juges si une personne est un directeur commercial a contacter pour une offre de formation. '.repeat(3);

/** Une organisation avec persona, source d'engageurs, campagne active et passage. */
async function monde() {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const org = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
  const admin = await userNeuf();
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [org, admin]);
  const persona = (await q(
    `insert into personas (organization_id, name, scoring_prompt) values ($1, 'Directeur commercial', $2) returning id`,
    [org, CONSIGNE],
  )).rows[0].id;
  const config = { sourceType: 'linkedin_post_engagers', urlPost: 'https://www.linkedin.com/posts/x_y-1', personaId: persona, garder: ['commente'] };
  const source = (await q(
    `insert into sources (organization_id, provider_id, name, config) values ($1, 'linkedin_post_engagers', 'Engageurs', $2::jsonb) returning id`,
    [org, JSON.stringify(config)],
  )).rows[0].id;
  const campagne = (await q(
    `insert into campaigns (organization_id, name, status, entry_rules) values ($1, 'C', 'active', $2::jsonb) returning id`,
    [org, JSON.stringify({ personas: [persona] })],
  )).rows[0].id;
  await q(`insert into campaign_sources (campaign_id, source_id) values ($1, $2)`, [campagne, source]);
  const run = (await q(`insert into source_runs (source_id) values ($1) returning id`, [source])).rows[0].id;
  return { org, admin, persona, source, campagne, run, ctx: { pool, organizationId: org, sourceId: source, sourceRunId: run } };
}

const POST = 'https://www.linkedin.com/posts/x_y-1';
// La mémoire d'écart stocke une EMPREINTE (sha256) de `<post>:<urn>`, jamais l'identifiant lisible.
const empreinteSql = (id) => `encode(sha256(convert_to('${normaliserUrlPost(POST)}:urn:li:fsd_profile:ACoAA${id}', 'UTF8')), 'hex')`;
const eng = (id, nom, intitule, urlProfil) => ({
  urn: `urn:li:fsd_profile:ACoAA${id}`,
  nom,
  intitule,
  ...(urlProfil ? { urlProfil } : {}),
});
const enregistrer = (m, e) => enregistrerEngageur(m.ctx, e, { id: m.campagne, personaId: m.persona }, POST);
const scorer = async (prospects) =>
  prospects.map((p) => ({ id: p.id, score: /directeur|directrice/i.test(p.title) ? 85 : 20, reason: 'jugé sur l’intitulé' }));

/**
 * Un engageur COLLECTÉ puis QUALIFIÉ par le scoring, avec l'adresse publique que
 * le collecteur a lue. Tout passe par les fonctions de production : un `insert`
 * direct dans `contacts` poserait l'hypothèse même qu'on cherche à tester (la
 * forme de l'adresse, la présence du signal, son statut).
 */
async function engageurQualifie(m, id, nom, intitule, urlProfil) {
  const issue = await enregistrer(m, eng(id, nom, intitule, urlProfil));
  await runScore({ pool, organizationId: m.org, scorer });
  const c = (await q(
    `select c.id, c.email, c.enriched_at, c.linkedin_url, s.status
       from contacts c join signals s on s.id = c.source_signal_id
      where c.organization_id = $1 and s.external_id like $2`,
    [m.org, `%ACoAA${id}`],
  )).rows[0];
  return { issue, ...c };
}

/** Le faux achat : la SEULE chose simulée de ce harnais. */
function achat({ email = 'achete@acme.fr', statut = 'DELIVERABLE', credits = 1.5, sansCout = false, leve = null } = {}) {
  const vus = [];
  return {
    vus,
    deps: (opts = {}) => ({
      pool,
      cleFullEnrich: async () => (opts.sansCle ? null : 'cle-de-test'),
      acheter: async (_k, entree) => {
        vus.push(entree);
        if (leve) throw leve;
        return {
          resultat: email ? { input: {}, contact_info: { most_probable_work_email: { email, status: statut } } } : { input: {} },
          // `sansCout` et non `credits: undefined` : un paramètre par défaut
          // retomberait sur 1.5, et la fixture ne produirait JAMAIS l'état
          // qu'elle prétend tester — le contrôle 21 a rougi là-dessus.
          credits: sansCout ? undefined : credits,
        };
      },
    }),
  };
}

/**
 * Un pool qui LÈVE sur une seule requête nommée, tout le reste du SQL restant
 * réel et exécuté sur Postgres. C'est la seule façon d'éprouver un échec
 * d'écriture POSTÉRIEUR à un achat : aucune donnée ne peut le provoquer, c'est
 * une panne de la base. `aPartirDe` laisse passer les N premiers essais, pour
 * distinguer « échoue une fois puis réussit » de « échoue toujours ».
 */
function poolQuiLeve(motif, { code } = {}) {
  return {
    query: async (sql, params) => {
      if (motif.test(sql)) throw Object.assign(new Error('panne injectée'), code ? { code } : {});
      return pool.query(sql, params);
    },
  };
}

const JOUR = () => new Date().toISOString().slice(0, 10);
const usage = async (org) =>
  (await q(`select used, credits_spent::float8 as credits_spent from provider_daily_usage where organization_id=$1 and provider_id='fullenrich' and usage_date=$2::date`, [org, JOUR()])).rows[0] ?? null;

// ------------------------------------------------------- 1. la colonne de coût

async function colonneDeCout() {
  console.log('la colonne de coût existe, et seule une consommation déjà décomptée peut la remplir');
  const m = await monde();

  const col = (await q(
    `select data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name='provider_daily_usage' and column_name='credits_spent'`,
  )).rows[0];
  check('1. provider_daily_usage.credits_spent existe, numeric, not null, défaut 0',
    col?.data_type === 'numeric' && col?.is_nullable === 'NO' && /0/.test(String(col?.column_default)), JSON.stringify(col));

  // Le crédit se prend par la fonction de production, jamais par un insert direct.
  await q(`select app.consume_provider_credit($1,'fullenrich',10,1,$2::date)`, [m.org, JOUR()]);
  check('2. une consommation sans coût laisse credits_spent à zéro', (await usage(m.org))?.credits_spent === 0);

  const r1 = (await q(`select app.record_provider_cost($1,'fullenrich',1.25::numeric,$2::date) as ok`, [m.org, JOUR()])).rows[0].ok;
  check('3. le coût réel est ajouté à la ligne du jour', r1 === true && (await usage(m.org))?.credits_spent === 1.25, JSON.stringify(await usage(m.org)));
  await q(`select app.record_provider_cost($1,'fullenrich',0.75::numeric,$2::date) as ok`, [m.org, JOUR()]);
  check('4. un second coût s’ajoute au premier (fractions comprises)', (await usage(m.org))?.credits_spent === 2, JSON.stringify(await usage(m.org)));

  // Aucun crédit consommé pour CE fournisseur : la fonction refuse et ne crée rien.
  const r2 = (await q(`select app.record_provider_cost($1,'autre_fournisseur',3::numeric,$2::date) as ok`, [m.org, JOUR()])).rows[0].ok;
  const cree = (await q(`select count(*)::int n from provider_daily_usage where organization_id=$1 and provider_id='autre_fournisseur'`, [m.org])).rows[0].n;
  check('5. un coût sans consommation décomptée rend false et ne crée aucune ligne', r2 === false && cree === 0, `${r2} lignes=${cree}`);

  const r3 = (await q(`select app.record_provider_cost($1,'fullenrich',0::numeric,$2::date) as ok`, [m.org, JOUR()])).rows[0].ok;
  const r4 = (await q(`select app.record_provider_cost($1,'fullenrich',-5::numeric,$2::date) as ok`, [m.org, JOUR()])).rows[0].ok;
  check('6. un coût nul ou négatif rend false et n’écrit rien', r3 === false && r4 === false && (await usage(m.org))?.credits_spent === 2);

  const neg = await erreur(q(`update provider_daily_usage set credits_spent = -1 where organization_id=$1 and provider_id='fullenrich'`, [m.org]));
  check('7. la contrainte interdit un coût négatif même en écriture directe', neg?.code === '23514', neg?.code ?? 'aucune erreur');

  // Le PRIVILÈGE ne se vérifie pas ici, et c'est délibéré : `grants.sql` tourne
  // APRÈS les migrations dans ce harnais et fait `grant execute on all routines in
  // schema app to authenticated`, ce qui rouvre toute fonction du schéma — le
  // fichier note déjà ce même effet pour `credentials_public`. Un contrôle lu ici
  // mesurerait donc grants.sql, pas la migration : un faux rouge, qu'on serait
  // tenté de « corriger » en ajoutant un revoke au harnais, et qui deviendrait
  // alors un faux vert. La révocation est prouvée par le bloc de contrôle de la
  // migration elle-même (`raise exception` si `authenticated` garde le droit),
  // qui s'exécute avant grants.sql : le retirer sort en MIGRATION_FAIL. Vérifié :
  // aucune migration n'accorde ce droit global, grants.sql est plus permissif que
  // la production.
  const def = (await q(
    `select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='app' and p.proname='record_provider_cost'`,
  )).rows[0];
  check('8. la fonction de coût est security definer avec un search_path figé',
    def?.prosecdef === true && (def?.proconfig ?? []).some((c) => c.startsWith('search_path=')), JSON.stringify(def));
}

// --------------------------------------------- 2. le producteur voit les bonnes personnes

async function producteur() {
  console.log('le producteur enfile les personnes qualifiées sans adresse email, et elles seules');
  const m = await monde();
  const jobs = [];
  // Faux `boss` pour les sections de SÉLECTION : voir le commentaire du runtime.
  const faux = { insert: async (lot) => { jobs.push(...lot); } };
  const pour = (id) => jobs.filter((j) => j.data.contactId === id);

  const ada = await engageurQualifie(m, 'ada', 'Ada Lovelace', 'Directrice commerciale chez Acme', 'https://www.linkedin.com/in/ada-lovelace');
  check('9. l’engageur est qualifié par le scoring, avec son adresse publique',
    ada.status === 'qualified' && ada.linkedin_url === 'https://www.linkedin.com/in/ada-lovelace', `${ada.status} ${ada.linkedin_url}`);

  // Sans `urlProfil`, le collecteur fabrique l'adresse depuis l'identifiant interne.
  const bob = await engageurQualifie(m, 'bob', 'Bob Martin', 'Directeur commercial chez Beta');
  check('9b. sans identifiant public, l’adresse du contact est bien celle fabriquée',
    bob.linkedin_url === 'https://www.linkedin.com/in/ACoAAbob', bob.linkedin_url);

  // Sans adresse publique, le scoring ne paie pas de jetons pour lui : il ne sera jamais enrichi (revue finale, 2.2).
  check('9a. une personne à adresse fabriquée reste `new` : le scoring ne la juge pas',
    bob.status === 'new', bob.status);

  // Jugé hors cible par le scoring : son signal ET son contact sont effacés, et
  // son écart est mémorisé. L'assertion porte sur les TROIS : « pas de contact »
  // seul passerait aussi si le scoring n'avait rien fait du tout.
  await engageurQualifie(m, 'carl', 'Carl Stagiaire', 'Stagiaire marketing', 'https://www.linkedin.com/in/carl-stagiaire');
  const carl = (await q(
    `select (select count(*)::int from contacts where organization_id=$1 and first_name='Carl') c,
            (select count(*)::int from signals where organization_id=$1 and external_id like '%ACoAAcarl') s,
            (select count(*)::int from linkedin_engageurs_ecartes where organization_id=$1 and external_id = ${empreinteSql('carl')}) e`,
    [m.org],
  )).rows[0];
  check('9c. l’engageur hors cible est effacé par le scoring, avec sa mémoire d’écart',
    carl.c === 0 && carl.s === 0 && carl.e === 1, JSON.stringify(carl));

  // État DÉLIBÉRÉMENT ARTIFICIEL : depuis la revue finale (2.2) le scoring ne juge plus une adresse fabriquée, donc plus
  // aucun chemin de production ne la qualifie. On la qualifie en SQL pour que le contrôle 10 continue de mesurer la
  // clause du producteur : c'est une défense en profondeur, la même condition (`sqlAdresseResolvable`) que le scoring.
  await q(`update signals set status = 'qualified' where organization_id = $1 and id = (select source_signal_id from contacts where id = $2)`, [m.org, bob.id]);
  const n = await enqueueEnrichmentContactsConnus(faux, pool);
  check('10. seule la personne à adresse publique est enfilée (l’adresse fabriquée est écartée)',
    pour(ada.id).length === 1 && pour(bob.id).length === 0, `ada=${pour(ada.id).length} bob=${pour(bob.id).length} total=${n}`);
  check('10b. le job vise la file enrichment.contact_connu, et porte l’organisation du contact',
    pour(ada.id)[0]?.name === 'enrichment.contact_connu' && pour(ada.id)[0]?.data.organizationId === m.org,
    JSON.stringify(pour(ada.id)[0] ?? null));

  // Une personne encore `new` : collectée, pas encore jugée.
  const dana = await enregistrer(m, eng('dana', 'Dana Neuve', 'Directrice commerciale', 'https://www.linkedin.com/in/dana-neuve'));
  const danaId = (await q(`select id from contacts where organization_id=$1 and first_name='Dana'`, [m.org])).rows[0].id;
  jobs.length = 0;
  await enqueueEnrichmentContactsConnus(faux, pool);
  check('11. une personne collectée mais pas encore qualifiée n’est pas enfilée', dana === 'nouveau' && pour(danaId).length === 0, dana);

  // Email posé par le CHEMIN RÉEL (rattachement de `persistEnrichedContact`).
  const compte = (await q(`insert into accounts (organization_id, name) values ($1,'Acme') returning id`, [m.org])).rows[0].id;
  await persistEnrichedContact(pool, m.org, compte, { email: 'ada@acme.fr', linkedinUrl: ada.linkedin_url, emailStatusRaw: 'VALID' });
  jobs.length = 0;
  await enqueueEnrichmentContactsConnus(faux, pool);
  check('12. une personne qui a déjà son email n’est plus enfilée', pour(ada.id).length === 0, String(pour(ada.id).length));
}


// --------------------------------- 2 bis. une organisation n'en affame pas une autre

async function famine() {
  console.log('le lot est par organisation : une organisation bloquée n’affame pas les autres');
  // Joué DEUX FOIS, une fois dans chaque ordre d'identifiant d'organisation.
  //
  // Le tri de repli d'un `order by` qui perdrait `rang` est l'identifiant de
  // l'organisation, et `gen_random_uuid` le rend imprévisible : un contrôle joué
  // dans un seul ordre rougissait une fois sur deux au retrait, selon que
  // l'organisation chargée tirait le plus petit ou le plus grand identifiant. Un
  // faux vert intermittent est pire qu'un faux vert franc — il passe chez soi et
  // rougit un jour ailleurs, sans raison apparente. En jouant les deux ordres,
  // c'est l'ENTRELACEMENT qui est prouvé, et plus seulement la partition.
  // Un `try` PAR SCÉNARIO, et pas seulement autour de la section : si le premier
  // lève, le second doit tourner quand même — sinon l'entrelacement redevient à
  // moitié prouvé le jour où l'un des deux casse, et le harnais n'annonce qu'un
  // seul échec. Même raison que le helper `jouer` au niveau des sections.
  for (const [plusPetite, libelle] of [[true, 'la plus petite'], [false, 'la plus grande']]) {
    try {
      await scenarioFamine(plusPetite, libelle);
    } catch (e) {
      check(`scénario famine (${libelle}) : exception, ses contrôles n'ont PAS été joués`, false, String(e?.message ?? e));
    }
  }
}

/** Deux organisations neuves, rendues dans l'ordre où Postgres trie leur identifiant. */
async function deuxOrganisationsOrdonnees() {
  const x = await monde();
  const y = await monde();
  return x.org < y.org ? [x, y] : [y, x];
}

async function scenarioFamine(chargeeEstLaPlusPetite, libelle) {
  const [petite, grande] = await deuxOrganisationsOrdonnees();
  // CHARGÉE : trois personnes, les PLUS RÉCENTES de la base, dans une
  // organisation qui n'a AUCUNE clé FullEnrich. LÉGÈRE : une personne, plus
  // ancienne. C'est le scénario réel : le producteur ne lit pas les clés (elles
  // se résolvent dans le coffre chiffré, pas en SQL), donc rien n'écarte la
  // chargée ; et le handler rend `sans_cle` SANS marquer, donc ses candidats
  // reviennent identiques à chaque tour, indéfiniment.
  const chargee = chargeeEstLaPlusPetite ? petite : grande;
  const legere = chargeeEstLaPlusPetite ? grande : petite;
  const n = chargeeEstLaPlusPetite ? 'p' : 'g';

  const ancienne = await engageurQualifie(legere, `${n}bruno`, 'Bruno Ancien', 'Directeur commercial', `https://www.linkedin.com/in/${n}-bruno-ancien`);
  // La légère est ANTÉRIEURE : son signal date d'hier, ceux de la chargée de
  // maintenant. Posé par l'horodatage du signal, que l'ordre de sélection lit.
  await q(`update signals set occurred_at = now() - interval '1 day' where organization_id = $1`, [legere.org]);
  const recents = [];
  for (const [id, nom] of [['ava', 'Ava Recente'], ['aya', 'Aya Recente'], ['ana', 'Ana Recente']]) {
    recents.push(await engageurQualifie(chargee, n + id, nom, 'Directrice commerciale', `https://www.linkedin.com/in/${n}-${id}-recente`));
  }

  // L'organisation chargée tourne réellement à vide : le handler ne marque rien.
  const sansCle = achat();
  for (const c of recents) {
    await enEcoutant(() => enrichirContactConnu(sansCle.deps({ sansCle: true }), { organizationId: chargee.org, contactId: c.id }));
  }
  const marques = (await q(`select count(*)::int n from contacts where organization_id=$1 and enriched_at is not null`, [chargee.org])).rows[0].n;
  check(`11a (${libelle}). une organisation sans clé laisse ses candidats intacts : ils reviendront à chaque tour`, marques === 0, String(marques));

  const jobs = [];
  const faux = { insert: async (lot) => { jobs.push(...lot); } };
  await enqueueEnrichmentContactsConnus(faux, pool, { limit: 2 });
  const deA = jobs.filter((j) => j.data.organizationId === chargee.org).length;
  check(`11b (${libelle}). l’organisation aux contacts les plus récents ne prend que SA part du lot`, deA === 2, String(deA));

  // LE scénario de famine. La borne globale est serrée à la taille d'un seul lot
  // d'organisation : c'est la situation réelle, où la chargée a plus de candidats
  // que le tour n'a de places. Un lot GLOBAL trié chronologiquement donnerait les
  // deux places à ses contacts, les plus récents, et l'autre n'en aurait jamais —
  // définitivement, puisque rien ne la fait avancer. Les organisations étant
  // servies à tour de rôle, le rang 1 de chacune passe avant le rang 2 de l'autre.
  jobs.length = 0;
  await enqueueEnrichmentContactsConnus(faux, pool, { limit: 2, limiteGlobale: 2 });
  const gA = jobs.filter((j) => j.data.organizationId === chargee.org).length;
  const gB = jobs.filter((j) => j.data.contactId === ancienne.id).length;
  check(`11c (${libelle}). sous une borne serrée, l’organisation aux contacts plus anciens est servie quand même`,
    jobs.length === 2 && gA === 1 && gB === 1, `total=${jobs.length} chargée=${gA} légère=${gB}`);

  // Ces quatre personnes sortent du jeu AVANT le scénario suivant, sans quoi
  // leurs candidats prendraient les places de la borne serrée d'après. Elles en
  // sortent par le chemin de production : un achat qui ne trouve aucune adresse
  // pose la marque.
  const vide = achat({ email: null });
  for (const c of [...recents, ancienne]) {
    const o = recents.includes(c) ? chargee.org : legere.org;
    await enEcoutant(() => enrichirContactConnu(vide.deps(), { organizationId: o, contactId: c.id }));
  }
}

// ------------------------------- 2 ter. la file réelle : dédoublonnage et comptage

async function fileReelle() {
  console.log('sur le vrai pg-boss : un job par contact et par jour, compté une seule fois');
  const m = await monde();
  const ada = await engageurQualifie(m, 'ada', 'Ada Lovelace', 'Directrice commerciale', 'https://www.linkedin.com/in/ada-lovelace');

  const file = (await q(`select retry_limit from pgboss.queue where name = 'enrichment.contact_connu'`)).rows[0];
  check('11e. la file d’achat est déclarée SANS reprise : un rejeu rachèterait l’adresse',
    file?.retry_limit === 0, JSON.stringify(file));

  // Les candidats des sections précédentes sont toujours là (elles déposaient
  // sur le faux `boss`), donc ce tour en dépose plus qu'un. Ce qui se vérifie
  // n'est pas leur nombre mais la CORRESPONDANCE : le compte rendu doit être
  // exactement ce que la file a reçu, et le contact de cette section y est.
  const enFile = async () =>
    (await q(`select count(*)::int n from pgboss.job where name='enrichment.contact_connu'`)).rows[0].n;
  const jobAda = async () =>
    (await q(`select count(*)::int n from pgboss.job where name='enrichment.contact_connu' and data->>'contactId' = $1`, [ada.id])).rows[0].n;
  const premier = await enqueueEnrichmentContactsConnus(boss, pool);
  const apres1 = await enFile();
  check('11f. le premier tour dépose, et le nombre annoncé est exactement ce que la file a reçu',
    premier === apres1 && premier > 0 && (await jobAda()) === 1, `annoncé=${premier} en file=${apres1}`);

  const second = await enqueueEnrichmentContactsConnus(boss, pool);
  const apres2 = await enFile();
  check('11g. le tour suivant du MÊME jour ne crée rien, et n’annonce rien (le compte n’est pas celui des contacts examinés)',
    second === 0 && apres2 === apres1, `annoncé=${second} en file ${apres1}->${apres2}`);

  // Le job termine, puis pg-boss l'ARCHIVE — ce qu'il fait au bout de douze
  // heures (ARCHIVE_DEFAULT, pg-boss 10.4.2), soit dans la même journée. Le SQL
  // ci-dessous est celui de sa maintenance (`INSERT INTO archive … SELECT … FROM
  // job`, src/plans.js), rejoué ici parce qu'on ne peut pas attendre douze heures.
  await q(`insert into pgboss.archive select j.*, now() from pgboss.job j where j.name='enrichment.contact_connu'`);
  await q(`delete from pgboss.job where name='enrichment.contact_connu'`);
  const troisieme = await enqueueEnrichmentContactsConnus(boss, pool);
  check('11h. un job ARCHIVÉ dans la journée ne fait pas renaître l’achat (sinon : seconde dépense)',
    troisieme === 0, String(troisieme));
  check('11i. et le contact est toujours candidat, donc il repartira demain sous un id neuf',
    (await q(`select enriched_at, email from contacts where id=$1`, [ada.id])).rows[0].enriched_at === null);

  // La file EXISTE DÉJÀ avec cinq reprises. C'est l'état qu'aurait laissé un
  // déploiement intermédiaire : `8027a43` déclarait cette file en DEFAULT_RETRY,
  // et ce commit est sur la branche. Lire `retry_limit` sur une file NEUVE (11e)
  // ne peut pas voir ce cas.
  await q(`update pgboss.queue set retry_limit = 5 where name = 'enrichment.contact_connu'`);
  try {
    await registerQueues(boss);
    const apres = (await q(`select retry_limit from pgboss.queue where name='enrichment.contact_connu'`)).rows[0];
    check('11j. une file déjà créée n’est JAMAIS réalignée par la déclaration (createQueue est un on conflict do nothing)',
      apres?.retry_limit === 5, JSON.stringify(apres));

    const bea = await engageurQualifie(m, 'bea', 'Bea Reprise', 'Directrice commerciale', 'https://www.linkedin.com/in/bea-reprise');
    await enqueueEnrichmentContactsConnus(boss, pool);
    const dep = (await q(
      `select retry_limit from pgboss.job where name='enrichment.contact_connu' and data->>'contactId' = $1`,
      [bea.id],
    )).rows[0];
    check('11k. le job déposé porte quand même ZÉRO reprise : la politique voyage avec lui, pas avec la file',
      dep?.retry_limit === 0, JSON.stringify(dep));
  } finally {
    // Dans un `finally` : une exception avant la remise laisserait la file à cinq
    // reprises pour TOUT le reste du harnais. Une fixture ne laisse pas
    // l'environnement sale derrière elle.
    await q(`update pgboss.queue set retry_limit = 0 where name = 'enrichment.contact_connu'`);
  }
}

// ------------------------------ 3 quater. on ne paie pas la même panne tous les jours

async function tentativesPayees() {
  console.log('un enrichissement qui échoue toujours cesse de coûter un crédit par jour');
  const m = await monde();
  const kim = await engageurQualifie(m, 'kim', 'Kim Panne', 'Directrice commerciale', 'https://www.linkedin.com/in/kim-panne');
  const a = achat({ leve: new TypeError('fournisseur injoignable') });

  const etat = async () =>
    (await q(`select enrichment_attempts, enriched_at from contacts where id=$1`, [kim.id])).rows[0];

  const r1 = await enEcoutant(() => enrichirContactConnu(a.deps(), { organizationId: m.org, contactId: kim.id }));
  const e1 = await etat();
  check('38. une première panne compte une tentative PAYÉE, et ne marque pas',
    r1.valeur === 'panne_fournisseur' && e1.enrichment_attempts === 1 && e1.enriched_at === null, JSON.stringify(e1));

  await enEcoutant(() => enrichirContactConnu(a.deps(), { organizationId: m.org, contactId: kim.id }));
  const e2 = await etat();
  check('38b. la deuxième non plus : une panne passagère ne doit pas condamner la personne',
    e2.enrichment_attempts === 2 && e2.enriched_at === null, JSON.stringify(e2));

  const r3 = await enEcoutant(() => enrichirContactConnu(a.deps(), { organizationId: m.org, contactId: kim.id }));
  const e3 = await etat();
  check('39. à la troisième tentative payée, le contact est abandonné et le journal dit comment le reprendre',
    e3.enrichment_attempts === 3 && e3.enriched_at !== null &&
      r3.lignes.includes(`${MSG.prefixe} ${MSG.tropDeTentatives(kim.id, 3)}`),
    `${JSON.stringify(e3)} / ${r3.lignes.join(' | ')}`);

  const u = await usage(m.org);
  check('39b. trois crédits ont été consommés — et plus un seul ensuite', u?.used === 3, JSON.stringify(u));

  const jobs = [];
  await enqueueEnrichmentContactsConnus({ insert: async (l) => { jobs.push(...l); } }, pool);
  check('39c. le producteur ne le reprend plus : il ne coûtera plus un crédit par jour',
    jobs.filter((j) => j.data.contactId === kim.id).length === 0);

  // La marque est LEVABLE : c'est ce que le message annonce à l'opérateur.
  await q(`update contacts set enrichment_attempts = 0, enriched_at = null where id=$1`, [kim.id]);
  jobs.length = 0;
  await enqueueEnrichmentContactsConnus({ insert: async (l) => { jobs.push(...l); } }, pool);
  check('39d. remettre le compteur à zéro le rend de nouveau candidat, comme le message le promet',
    jobs.filter((j) => j.data.contactId === kim.id).length === 1);
}

// --------------------------------------------- 3. le handler, sur un vrai Postgres

async function handler() {
  console.log('l’achat écrit l’adresse, le statut, la marque et le coût');
  const m = await monde();
  const a = achat({ credits: 2.25 });
  const ada = await engageurQualifie(m, 'ada', 'Ada Lovelace', 'Directrice commerciale chez Acme', 'https://www.linkedin.com/in/ada-lovelace');

  const { valeur: issue } = await enEcoutant(() =>
    enrichirContactConnu(a.deps(), { organizationId: m.org, contactId: ada.id }));
  check('13. l’achat aboutit', issue === 'achete', String(issue));
  check('14. l’entrée envoyée au fournisseur porte l’adresse CANONIQUE, le prénom et le nom',
    a.vus.length === 1 &&
      a.vus[0].linkedin_url === 'https://www.linkedin.com/in/ada-lovelace' &&
      a.vus[0].first_name === 'Ada' && a.vus[0].last_name === 'Lovelace',
    JSON.stringify(a.vus));
  const c = (await q(`select email, email_status, email_confidence::float8 as conf, enriched_at from contacts where id=$1`, [ada.id])).rows[0];
  check('15. le contact reçoit son adresse, son statut de délivrabilité et sa marque d’achat',
    c.email === 'achete@acme.fr' && c.email_status === 'valid' && c.conf > 0 && c.enriched_at !== null, JSON.stringify(c));
  const u = await usage(m.org);
  check('16. un crédit est décompté et le COÛT RÉEL est enregistré', u?.used === 1 && u?.credits_spent === 2.25, JSON.stringify(u));

  // Le producteur ne le reprend plus.
  const jobs = [];
  await enqueueEnrichmentContactsConnus({ insert: async (l) => { jobs.push(...l); } }, pool);
  check('17. le producteur ne reprend pas une personne déjà enrichie', jobs.filter((j) => j.data.contactId === ada.id).length === 0);
}

async function sansResultat() {
  console.log('un achat qui ne trouve rien, et un achat dont le coût est absent');
  const m = await monde();
  const bred = await engageurQualifie(m, 'bred', 'Bred Vide', 'Directeur commercial', 'https://www.linkedin.com/in/bred-vide');
  const a = achat({ email: null, credits: 0.5 });
  const { valeur, lignes } = await enEcoutant(() => enrichirContactConnu(a.deps(), { organizationId: m.org, contactId: bred.id }));
  check('18. aucune adresse trouvée : le passage ne tombe pas, et le dit', valeur === 'sans_email' && lignes.includes(`${MSG.prefixe} ${MSG.sansEmail(bred.id)}`), `${valeur} / ${lignes.join(' | ')}`);
  const c = (await q(`select email, enriched_at from contacts where id=$1`, [bred.id])).rows[0];
  check('19. la personne est marquée traitée SANS email : elle ne sera pas rachetée demain',
    c.email === null && c.enriched_at !== null, JSON.stringify(c));
  const jobs = [];
  await enqueueEnrichmentContactsConnus({ insert: async (l) => { jobs.push(...l); } }, pool);
  check('19b. et le producteur ne la reprend effectivement pas', jobs.filter((j) => j.data.contactId === bred.id).length === 0);
  check('20. le coût réel d’un achat infructueux est quand même enregistré', (await usage(m.org))?.credits_spent === 0.5, JSON.stringify(await usage(m.org)));

  // Coût ABSENT de la réponse : ce n'est pas zéro, et ça doit se voir.
  const cora = await engageurQualifie(m, 'cora', 'Cora Muette', 'Directrice commerciale', 'https://www.linkedin.com/in/cora-muette');
  const b = achat({ sansCout: true });
  const r = await enEcoutant(() => enrichirContactConnu(b.deps(), { organizationId: m.org, contactId: cora.id }));
  check('21. un coût absent de la réponse est SIGNALÉ, et n’est pas compté pour zéro',
    r.lignes.includes(`${MSG.prefixe} ${MSG.coutAbsent(cora.id)}`) && (await usage(m.org))?.credits_spent === 0.5,
    `${r.lignes.join(' | ')} / ${JSON.stringify(await usage(m.org))}`);
}

async function plafondEtRefus() {
  console.log('le plafond de l’opérateur arrête l’achat, et une adresse fabriquée ne coûte rien');
  const m = await monde();
  // Le plafond est posé par l'écran Réglages › Plafonds, pas par un insert direct.
  await ecrireReglage({ ex: pool, organisationId: m.org, utilisateurId: m.admin, role: 'admin' },
    { cle: 'enrichissements_par_jour', valeur: 1 });

  const ada = await engageurQualifie(m, 'ada', 'Ada Lovelace', 'Directrice commerciale', 'https://www.linkedin.com/in/ada-lovelace');
  const bea = await engageurQualifie(m, 'bea', 'Bea Seconde', 'Directrice commerciale', 'https://www.linkedin.com/in/bea-seconde');
  const a = achat();
  await enEcoutant(() => enrichirContactConnu(a.deps(), { organizationId: m.org, contactId: ada.id }));
  const r = await enEcoutant(() => enrichirContactConnu(a.deps(), { organizationId: m.org, contactId: bea.id }));
  check('22. le second achat est refusé par le plafond saisi à l’écran, et le dit',
    r.valeur === 'plafond' && r.lignes.includes(`${MSG.prefixe} ${MSG.plafond(m.org)}`), `${r.valeur} / ${r.lignes.join(' | ')}`);
  check('22b. aucun appel n’est parti pour la seconde personne', a.vus.length === 1, String(a.vus.length));
  const c = (await q(`select email, enriched_at from contacts where id=$1`, [bea.id])).rows[0];
  check('22c. la personne reportée n’est PAS marquée : elle repartira demain', c.email === null && c.enriched_at === null, JSON.stringify(c));
  const jobs = [];
  await enqueueEnrichmentContactsConnus({ insert: async (l) => { jobs.push(...l); } }, pool);
  check('22d. et le producteur la reprend bien', jobs.filter((j) => j.data.contactId === bea.id).length === 1);

  // Adresse FABRIQUÉE : le handler refuse avant toute dépense.
  //
  // Le plafond est RELEVÉ d'abord, et c'est tout l'intérêt du contrôle : laissé à
  // 1, il serait déjà épuisé et arrêterait l'achat de lui-même. Le retrait de la
  // garde ferait alors rougir le contrôle pour la MAUVAISE cause ('plafond' au
  // lieu d'un achat parti), et on ne verrait jamais ce que la garde économise.
  // Mesuré : sans ce relèvement, le retrait R5 rend « plafond appels=0 ».
  await ecrireReglage({ ex: pool, organisationId: m.org, utilisateurId: m.admin, role: 'admin' },
    { cle: 'enrichissements_par_jour', valeur: 50 });
  const dan = await engageurQualifie(m, 'dan', 'Dan Interne', 'Directeur commercial');
  const uAvant = await usage(m.org);
  const b = achat();
  const rd = await enEcoutant(() => enrichirContactConnu(b.deps(), { organizationId: m.org, contactId: dan.id }));
  const uApres = await usage(m.org);
  check('23. une adresse fabriquée à partir de l’identifiant interne ne consomme AUCUN crédit',
    rd.valeur === 'refuse' && b.vus.length === 0 && uApres.used === uAvant.used,
    `${rd.valeur} appels=${b.vus.length} used ${uAvant.used}->${uApres.used}`);
  check('23b. et le refus nomme sa cause à l’opérateur',
    rd.lignes.includes(`${MSG.prefixe} ${MSG.refus(dan.id, 'adresse_deduite')}`), rd.lignes.join(' | '));
  check('23c. la règle de refus est la même des deux côtés (producteur et handler)',
    raisonDeNePasAcheter({ linkedinUrl: 'https://www.linkedin.com/in/ACoAAdan', linkedinProviderId: 'ACoAAdan', firstName: 'Dan', lastName: 'Interne' }) === 'adresse_deduite');
}

async function conflitDAdresse() {
  console.log('une adresse déjà portée par une autre fiche n’interrompt rien');
  const m = await monde();
  // La fiche qui porte déjà l'adresse naît du CHEMIN ENTREPRISE.
  const compte = (await q(`insert into accounts (organization_id, name) values ($1,'Acme') returning id`, [m.org])).rows[0].id;
  await persistEnrichedContact(pool, m.org, compte, {
    email: 'deja@acme.fr', firstName: 'Dejà', lastName: 'Connue',
    linkedinUrl: 'https://www.linkedin.com/in/deja-connue', emailStatusRaw: 'VALID',
  });
  // Une AUTRE personne, collectée sur un post, pour qui FullEnrich rend la même adresse.
  const eve = await engageurQualifie(m, 'eve', 'Eve Homonyme', 'Directrice commerciale', 'https://www.linkedin.com/in/eve-homonyme');
  const a = achat({ email: 'deja@acme.fr' });
  const r = await enEcoutant(() => enrichirContactConnu(a.deps(), { organizationId: m.org, contactId: eve.id }));
  check('24. le conflit d’unicité ne fait pas tomber le passage, et il est consigné',
    r.valeur === 'email_deja_pris' && r.lignes.includes(`${MSG.prefixe} ${MSG.emailDejaPris(eve.id)}`), `${r.valeur} / ${r.lignes.join(' | ')}`);
  const c = (await q(`select email, enriched_at from contacts where id=$1`, [eve.id])).rows[0];
  check('25. la personne reste SANS email, et marquée traitée', c.email === null && c.enriched_at !== null, JSON.stringify(c));
  const autres = (await q(`select count(*)::int n from contacts where organization_id=$1 and lower(email)='deja@acme.fr'`, [m.org])).rows[0].n;
  check('25b. aucune fiche n’a été dupliquée ni fusionnée', autres === 1, String(autres));
}


// ------------------------- 3 ter. ce qui se passe APRÈS que l'adresse est payée

async function apresLAchat() {
  console.log('une adresse payée n’est jamais rachetée, quoi qu’il arrive ensuite');
  const m = await monde();

  // 1) La base refuse l'écriture. Deux fois : le réessai ne sauve pas.
  const ida = await engageurQualifie(m, 'ida', 'Ida Base', 'Directrice commerciale', 'https://www.linkedin.com/in/ida-base');
  const a = achat();
  const sourd = poolQuiLeve(/update contacts set\s+email = \$3/, { code: '40P01' });
  const r = await enEcoutant(() =>
    enrichirContactConnu({ ...a.deps(), pool: sourd }, { organizationId: m.org, contactId: ida.id }));
  check('32. une adresse PAYÉE que la base refuse d’écrire n’est pas étiquetée « panne fournisseur »',
    r.valeur === 'ecriture_echouee' && r.lignes.includes(`${MSG.prefixe} ${MSG.ecritureEchouee(ida.id, 'Error')}`),
    `${r.valeur} / ${r.lignes.join(' | ')}`);
  const ci = (await q(`select email, enriched_at from contacts where id=$1`, [ida.id])).rows[0];
  check('32b. et le contact est MARQUÉ : sans cela il serait racheté demain, puis chaque jour',
    ci.email === null && ci.enriched_at !== null, JSON.stringify(ci));
  const jobs = [];
  await enqueueEnrichmentContactsConnus({ insert: async (l) => { jobs.push(...l); } }, pool);
  check('32c. le producteur ne le reprend effectivement plus', jobs.filter((j) => j.data.contactId === ida.id).length === 0);

  // 2) Une panne passagère : le second essai écrit, et l'adresse n'est achetée qu'une fois.
  const ivo = await engageurQualifie(m, 'ivo', 'Ivo Passager', 'Directeur commercial', 'https://www.linkedin.com/in/ivo-passager');
  const b = achat({ email: 'ivo@acme.fr' });
  // Le premier essai lève, le second passe : la panne ne dure pas.
  let leve = 0;
  const unePanne = {
    query: async (sql, params) => {
      if (/update contacts set\s+email = \$3/.test(sql) && leve === 0) {
        leve = 1;
        throw Object.assign(new Error('panne injectée'), { code: '40P01' });
      }
      return pool.query(sql, params);
    },
  };
  const r2 = await enEcoutant(() =>
    enrichirContactConnu({ ...b.deps(), pool: unePanne }, { organizationId: m.org, contactId: ivo.id }));
  const cv = (await q(`select email from contacts where id=$1`, [ivo.id])).rows[0];
  check('33. une panne passagère de la base est réessayée UNE fois, et l’adresse déjà payée est écrite',
    r2.valeur === 'achete' && cv.email === 'ivo@acme.fr' && b.vus.length === 1,
    `${r2.valeur} ${cv.email} appels=${b.vus.length}`);

  // 3) Course : le chemin ENTREPRISE pose l'email pendant qu'on achetait.
  const ola = await engageurQualifie(m, 'ola', 'Ola Course', 'Directrice commerciale', 'https://www.linkedin.com/in/ola-course');
  const compte = (await q(`insert into accounts (organization_id, name) values ($1,'Acme') returning id`, [m.org])).rows[0].id;
  let double = false;
  const course = {
    query: async (sql, params) => {
      if (/update contacts set\s+email = \$3/.test(sql) && !double) {
        double = true;
        // Chemin de production : l'enrichissement d'entreprise retrouve la même
        // personne par son adresse de profil et lui pose SON email.
        await persistEnrichedContact(pool, m.org, compte, {
          email: 'ola-entreprise@acme.fr', linkedinUrl: ola.linkedin_url, emailStatusRaw: 'VALID',
        });
      }
      return pool.query(sql, params);
    },
  };
  const c = achat({ email: 'ola-achetee@acme.fr' });
  const r3 = await enEcoutant(() =>
    enrichirContactConnu({ ...c.deps(), pool: course }, { organizationId: m.org, contactId: ola.id }));
  const co = (await q(`select email from contacts where id=$1`, [ola.id])).rows[0];
  check('34. une adresse posée entre-temps par une autre source : l’achat est perdu, et on ne dit pas « achetée »',
    r3.valeur === 'achat_perdu' && co.email === 'ola-entreprise@acme.fr' &&
      r3.lignes.includes(`${MSG.prefixe} ${MSG.achatPerdu(ola.id)}`) &&
      !r3.lignes.includes(`${MSG.prefixe} ${MSG.achete(ola.id, 1.5)}`),
    `${r3.valeur} ${co.email} / ${r3.lignes.join(' | ')}`);
}

async function plafondNulEtMarquage() {
  console.log('un plafond réglé à zéro le dit, et seul un nom tronqué ferme la porte');
  const m = await monde();
  await ecrireReglage({ ex: pool, organisationId: m.org, utilisateurId: m.admin, role: 'admin' },
    { cle: 'enrichissements_par_jour', valeur: 0 });
  const zoe = await engageurQualifie(m, 'zoe', 'Zoe Zero', 'Directrice commerciale', 'https://www.linkedin.com/in/zoe-zero');
  const a = achat();
  const r = await enEcoutant(() => enrichirContactConnu(a.deps(), { organizationId: m.org, contactId: zoe.id }));
  check('35. un plafond réglé à zéro est nommé pour ce qu’il est, pas annoncé comme « atteint »',
    r.valeur === 'plafond' && r.lignes.includes(`${MSG.prefixe} ${MSG.plafondNul(m.org)}`) &&
      !r.lignes.includes(`${MSG.prefixe} ${MSG.plafond(m.org)}`),
    r.lignes.join(' | '));
  check('35b. et rien n’est consommé : il n’y a pas de ligne de consommation à créer',
    (await usage(m.org)) === null && a.vus.length === 0, JSON.stringify(await usage(m.org)));

  // Marquage asymétrique : une adresse FABRIQUÉE peut cesser de l'être, pas un nom tronqué.
  const m2 = await monde();
  const dan = await engageurQualifie(m2, 'dan', 'Dan Interne', 'Directeur commercial');
  const b = achat();
  await enEcoutant(() => enrichirContactConnu(b.deps(), { organizationId: m2.org, contactId: dan.id }));
  const cd = (await q(`select enriched_at from contacts where id=$1`, [dan.id])).rows[0];
  check('36. une adresse fabriquée est refusée SANS marquer : le jour où l’identifiant public est lu, elle redevient payable',
    cd.enriched_at === null, JSON.stringify(cd));

  // « Ada L. » : ce que LinkedIn affiche d'un hors-réseau dans une vignette.
  const tronque = await engageurQualifie(m2, 'lili', 'Lili L.', 'Directrice commerciale', 'https://www.linkedin.com/in/lili-l');
  const rt = await enEcoutant(() => enrichirContactConnu(b.deps(), { organizationId: m2.org, contactId: tronque.id }));
  const ct = (await q(`select first_name, last_name, enriched_at from contacts where id=$1`, [tronque.id])).rows[0];
  check('37. un nom tronqué est refusé ET marqué : aucun passage ne le complétera (coalesce), il resterait candidat pour rien',
    rt.valeur === 'refuse' && ct.last_name === 'L.' && ct.enriched_at !== null &&
      rt.lignes.includes(`${MSG.prefixe} ${MSG.refus(tronque.id, 'nom_tronque')}`),
    `${rt.valeur} ${JSON.stringify(ct)}`);
  check('37b. et aucun crédit n’a été consommé pour l’un ou l’autre', b.vus.length === 0 && (await usage(m2.org)) === null);
}

async function retention() {
  console.log('la marque d’achat n’épargne de la purge que ce qui a vraiment une adresse');
  const m = await monde();
  // Deux personnes qualifiées, anciennes. L'une a son email acheté, l'autre non —
  // les DEUX marquées par le même chemin de production (le handler lui-même).
  const fay = await engageurQualifie(m, 'fay', 'Fay Trouvee', 'Directrice commerciale', 'https://www.linkedin.com/in/fay-trouvee');
  const gus = await engageurQualifie(m, 'gus', 'Gus Introuvable', 'Directeur commercial', 'https://www.linkedin.com/in/gus-introuvable');
  await enEcoutant(() => enrichirContactConnu(achat().deps(), { organizationId: m.org, contactId: fay.id }));
  await enEcoutant(() => enrichirContactConnu(achat({ email: null }).deps(), { organizationId: m.org, contactId: gus.id }));
  const avant = (await q(`select (select count(*)::int from contacts where id=$1) f, (select count(*)::int from contacts where id=$2) g`, [fay.id, gus.id])).rows[0];
  check('26. avant la purge, les deux personnes existent, l’une avec email et l’autre sans',
    avant.f === 1 && avant.g === 1 &&
      (await q(`select email from contacts where id=$1`, [gus.id])).rows[0].email === null);

  // Les deux signaux vieillissent au-delà du délai, mais DANS la fenêtre d'épargne
  // d'un email acheté (14 j < 20 j < 28 j) : seul l'email doit sauver sa personne.
  await q(`update signals set occurred_at = now() - interval '20 days' where organization_id=$1`, [m.org]);
  await ecarterSignauxTropAnciens(pool, 14);
  const apres = (await q(`select (select count(*)::int from contacts where id=$1) f, (select count(*)::int from contacts where id=$2) g`, [fay.id, gus.id])).rows[0];
  check('27. la personne dont on a acheté l’adresse est épargnée', apres.f === 1, JSON.stringify(apres));
  check('28. la personne marquée SANS adresse est purgée : la marque seule ne rouvre aucune rétention',
    apres.g === 0, JSON.stringify(apres));
}

async function pannes() {
  console.log('une panne du fournisseur ne rejoue rien, et ne dit rien de la clé');
  const m = await monde();
  const hal = await engageurQualifie(m, 'hal', 'Hal Panne', 'Directeur commercial', 'https://www.linkedin.com/in/hal-panne');
  const a = achat({ leve: new TypeError('https://api.fullenrich.com/v1/bulk?api_key=sk-secret-reel') });
  const r = await enEcoutant(() => enrichirContactConnu(a.deps(), { organizationId: m.org, contactId: hal.id }));
  check('29. une panne du fournisseur ne lève pas : le job ne sera pas rejoué, donc rien n’est racheté',
    r.valeur === 'panne_fournisseur', String(r.valeur));
  check('29b. le journal nomme le type de l’erreur, jamais son message (une URL provider porte la clé)',
    r.lignes.includes(`${MSG.prefixe} ${MSG.panne(hal.id, 'TypeError')}`) && !r.lignes.join(' ').includes('sk-secret-reel'),
    r.lignes.join(' | '));
  const c = (await q(`select email, enriched_at from contacts where id=$1`, [hal.id])).rows[0];
  check('29c. la personne n’est pas marquée : elle repartira', c.email === null && c.enriched_at === null, JSON.stringify(c));

  // Sans clé FullEnrich : rien n'est consommé, rien n'est marqué.
  const m2 = await monde();
  const ida = await engageurQualifie(m2, 'ida', 'Ida Sanscle', 'Directrice commerciale', 'https://www.linkedin.com/in/ida-sanscle');
  const b = achat();
  const r2 = await enEcoutant(() => enrichirContactConnu(b.deps({ sansCle: true }), { organizationId: m2.org, contactId: ida.id }));
  check('30. sans clé fournisseur, aucun crédit n’est consommé et rien n’est marqué',
    r2.valeur === 'sans_cle' && (await usage(m2.org)) === null && b.vus.length === 0, `${r2.valeur} ${JSON.stringify(await usage(m2.org))}`);

  // Un contact d'une AUTRE organisation n'est pas lisible : le filtre est explicite.
  const m3 = await monde();
  const r3 = await enEcoutant(() => enrichirContactConnu(achat().deps(), { organizationId: m3.org, contactId: ida.id }));
  check('31. un contact d’une autre organisation est introuvable, et aucun crédit n’est pris',
    r3.valeur === 'introuvable' && (await usage(m3.org)) === null, String(r3.valeur));
}

// ------------------------------- 12. une campagne 100 % LinkedIn n'achete aucune adresse

async function campagneLinkedInSeule() {
  console.log('une sequence 100 % LinkedIn n achete pas d adresse email');
  const m = await monde();
  // La sequence n'ecrit QUE par LinkedIn. L'URN suffit a envoyer le message : acheter une
  // adresse email serait une depense dont personne ne se servira jamais.
  await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, 0, 'linkedin_message')`, [m.campagne]);
  // Adresse PUBLIQUE, donc resolvable : sans cela l'exclusion des adresses deduites
  // suffirait a ecarter le contact, et le controle ne prouverait rien de la regle visee.
  const paul = await engageurQualifie(m, 'pub1', 'Paul Public', 'Directeur commercial', 'https://www.linkedin.com/in/paul-public');

  const enFilePour = async (id) =>
    (await q(`select count(*)::int n from pgboss.job where name='enrichment.contact_connu' and data->>'contactId' = $1`, [id])).rows[0].n;

  await enqueueEnrichmentContactsConnus(boss, pool);
  check('12a. sequence 100 % LinkedIn : aucune adresse n est achetee pour ce contact',
    (await enFilePour(paul.id)) === 0, `en file = ${await enFilePour(paul.id)}`);

  // Preuve par retrait : une seule etape email dans la sequence, et le MEME contact
  // redevient un achat legitime. Sans ce second controle, 12a passerait aussi bien si
  // l'enrichissement etait casse de bout en bout, ou si le contact etait ecarte pour
  // une tout autre raison.
  await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, 1, 'email')`, [m.campagne]);
  await enqueueEnrichmentContactsConnus(boss, pool);
  check('12b. une etape email dans la sequence, et le meme contact redevient un achat legitime',
    (await enFilePour(paul.id)) === 1, `en file = ${await enFilePour(paul.id)}`);
}

await jouer(colonneDeCout, producteur, famine, fileReelle, handler, sansResultat, plafondEtRefus, apresLAchat, plafondNulEtMarquage, tentativesPayees, conflitDAdresse, retention, pannes, campagneLinkedInSeule);
await boss.stop({ graceful: false });
await pool.end();
console.log(failures === 0 ? '\nTOUT VERT' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
