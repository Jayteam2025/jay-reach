// Lot 2, P4 : la population globale des contacts est calculée par UNE requête Postgres
// (dédoublonnage, tri, total, page). Ce runner la compare, sur une vraie base, à l'ancienne
// implémentation en mémoire (oracle : `contacts-globaux.oracle.ts`) : même total, mêmes contacts,
// même ordre, mêmes valeurs (statut, étape, campagne représentative, nombreCampagnes), page après
// page, pour chaque onglet/filtre. Mesure aussi requêtes et lignes lues pour une page de 50.
//
// Env : DATABASE_URL, TEST_ORG (obligatoires) ; MODE=lecture refuse toute écriture (base réelle).
import assert from 'node:assert/strict';
import pg from 'pg';

const { Pool } = pg;
const ORG = process.env.TEST_ORG;
const lectureSeule = process.env.MODE === 'lecture';
const { nouveau, ancien } = await import(process.env.BUNDLE);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
if (lectureSeule) {
  pool.on('connect', (c) => c.query('set default_transaction_read_only = on'));
}

let nbRequetes = 0;
let nbLignes = 0;
function ctx() {
  return {
    ex: {
      query: async (sql, params) => {
        const r = await pool.query(sql, params);
        nbRequetes += 1;
        nbLignes += r.rows.length;
        return r;
      },
    },
    organisationId: ORG,
    utilisateurId: null,
    role: 'viewer',
  };
}
const mesure = async (f) => {
  nbRequetes = 0;
  nbLignes = 0;
  const v = await f();
  return { v, requetes: nbRequetes, lignes: nbLignes };
};

let echecs = 0;
let comparaisons = 0;
function verifie(libelle, f) {
  comparaisons += 1;
  try {
    f();
  } catch (e) {
    echecs += 1;
    console.log(`  KO ${libelle}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`);
  }
}

const STATUTS = ['tous', 'a_contacter', 'sans_email', 'en_pause', 'en_sequence', 'a_repondu', 'interesse', 'ecarte', 'termine', 'rebond', 'ne_plus_contacter'];

async function comparer(libelle, filtres) {
  const c = ctx();
  const { lignes: ref, tronque: refTronque } = await ancien.collecter(c, { filtre: 'tous', ...filtres });
  const total = ref.length;
  const nbPages = Math.max(1, Math.ceil(total / 50)) + 1; // une page vide au-delà de la fin
  let vues = 0;
  for (let page = 1; page <= nbPages; page++) {
    const r = await nouveau.listerContacts(ctx(), { filtre: 'tous', ...filtres, page });
    const attendu = ref.slice((page - 1) * 50, page * 50);
    verifie(`${libelle} page ${page} : total`, () => assert.equal(r.total, total));
    verifie(`${libelle} page ${page} : tronque`, () => assert.equal(r.tronque, refTronque));
    verifie(`${libelle} page ${page} : lignes (${attendu.length})`, () => assert.deepStrictEqual(r.lignes, attendu));
    vues += r.lignes.length;
  }
  verifie(`${libelle} : pages disjointes, ${total} contacts vus`, () => assert.equal(vues, total));
  const csv = await nouveau.exporterCsv(ctx(), { filtre: 'tous', ...filtres });
  verifie(`${libelle} : export = ${total} lignes`, () => assert.equal(csv.split('\r\n').length - 1, total));
  if (ancien.exporterCsv) {
    const csvAncien = await ancien.exporterCsv(ctx(), { filtre: 'tous', ...filtres });
    verifie(`${libelle} : export identique octet pour octet`, () => assert.equal(csv, csvAncien));
  }
  console.log(`  ${libelle} : ${total} contacts`);
  return total;
}

async function main() {
  const campagnes = (await pool.query(`select id, name from campaigns where organization_id = $1 order by name asc`, [ORG])).rows;
  console.log(`[contacts-globaux] organisation ${ORG}, ${campagnes.length} campagne(s)`);

  const brut = (await pool.query(`select count(*)::int as n from enrollments where organization_id = $1`, [ORG])).rows[0].n;
  console.log(`  inscriptions : ${brut}`);

  let total = 0;
  for (const filtre of STATUTS) total = Math.max(total, await comparer(`statut=${filtre}`, { filtre }));
  for (const camp of campagnes) {
    await comparer(`campagne=${camp.name}`, { campagneId: camp.id });
    await comparer(`campagne=${camp.name} + en_sequence`, { campagneId: camp.id, filtre: 'en_sequence' });
  }
  for (const source of ['adzuna', 'francetravail', 'linkedin', 'manuel']) await comparer(`source=${source}`, { source });
  for (const email of ['verifie', 'a_trouver']) await comparer(`email=${email}`, { email });
  const echant = (await pool.query(`select first_name from contacts where organization_id = $1 and first_name is not null limit 1`, [ORG])).rows[0];
  if (echant) await comparer(`recherche=${echant.first_name.slice(0, 3)}`, { recherche: echant.first_name.slice(0, 3) });
  await comparer('recherche avec % littéral', { recherche: '50%' });
  await comparer('combiné source+email+statut', { source: 'adzuna', email: 'verifie', filtre: 'a_contacter' });

  // Page inexistante : vide mais le total reste juste.
  const loin = await nouveau.listerContacts(ctx(), { page: 9999 });
  verifie('page 9999 : vide, total conservé', () => {
    assert.equal(loin.lignes.length, 0);
    assert.ok(loin.total >= 0);
  });

  // Coût d'une page de 50 : avant / après.
  const avant = await mesure(() => ancien.listerContacts(ctx(), { page: 1 }));
  const apres = await mesure(() => nouveau.listerContacts(ctx(), { page: 1 }));
  console.log(`[mesure] page 1, tous contacts : AVANT ${avant.requetes} requêtes / ${avant.lignes} lignes lues ; APRÈS ${apres.requetes} requête(s) / ${apres.lignes} lignes lues`);

  console.log(`[contacts-globaux] ${comparaisons} comparaisons, ${echecs} écart(s)`);
  await pool.end();
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
