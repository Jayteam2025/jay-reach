// P3 : preuve par exécution réelle que le menu (lireResumeCoquille) et l'accueil
// (lireAujourdhui) ne peuvent pas afficher deux nombres différents, et que la lecture
// du menu est bien plus légère. Lecture seule (SELECT uniquement), pour chaque
// organisation de la base visée. Le bundle est produit par le .sh (esbuild).
import { Pool } from 'pg';
import { lireAujourdhui, lireResumeCoquille, listerCampagnes, listerCampagnesPourFiltre } from './_coquille-bundle.mjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'OK' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!cond) failures += 1;
}

/** Compte les requêtes réellement envoyées à Postgres par une lecture. */
function compteur(organisationId) {
  const state = { n: 0 };
  const ex = { query: (...args) => { state.n += 1; return pool.query(...args); } };
  return { state, ctx: { ex, organisationId, utilisateurId: null, role: 'viewer' } };
}

const { rows: orgs } = await pool.query('select id, name from organizations order by created_at');
check('au-moins-une-organisation', orgs.length > 0, `${orgs.length} organisation(s)`);

for (const org of orgs) {
  const plein = compteur(org.id);
  const a = await lireAujourdhui(plein.ctx);
  const leger = compteur(org.id);
  const c = await lireResumeCoquille(leger.ctx);
  const tag = `[${org.name}]`;

  console.log(`${tag} accueil: aTraiter=${a.aTraiter.total} partis=${a.fileDuJour.partis} enFile=${a.fileDuJour.enFile} plafond=${a.plafonds.envois.plafond} | menu: aTraiter=${c.aTraiterTotal} partis=${c.fileDuJour.partis} enFile=${c.fileDuJour.enFile} plafond=${c.plafondEnvois}`);
  console.log(`${tag} requetes: accueil=${plein.state.n} menu=${leger.state.n}`);

  check(`${tag} badge-egal-accueil`, c.aTraiterTotal === a.aTraiter.total);
  check(`${tag} partis-egal-accueil`, c.fileDuJour.partis === a.fileDuJour.partis);
  check(`${tag} enFile-egal-accueil`, c.fileDuJour.enFile === a.fileDuJour.enFile);
  check(`${tag} plafond-egal-accueil`, c.plafondEnvois === a.plafonds.envois.plafond);
  check(`${tag} fuseau-egal-accueil`, c.fuseau === a.fuseau);
  check(`${tag} moteur-egal-accueil`, c.moteur.enMarche === a.moteur.enMarche && String(c.moteur.dernierPassage) === String(a.moteur.dernierPassage));
  check(`${tag} menu-bien-plus-leger`, leger.state.n <= 6 && leger.state.n < plein.state.n);

  const listeComplete = compteur(org.id);
  const complete = await listerCampagnes(listeComplete.ctx);
  const legere = compteur(org.id);
  const options = await listerCampagnesPourFiltre(legere.ctx);
  console.log(`${tag} campagnes: listerCampagnes=${listeComplete.state.n} requetes, listerCampagnesPourFiltre=${legere.state.n} requete`);
  check(`${tag} filtre-meme-ids-meme-ordre`, JSON.stringify(options.map((o) => [o.id, o.nom, o.statut])) === JSON.stringify(complete.map((o) => [o.id, o.nom, o.statut])));
  check(`${tag} filtre-une-requete`, legere.state.n === 1);
}

await pool.end();
if (failures > 0) {
  console.log(`=== COQUILLE COHERENCE FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('=== COQUILLE COHERENCE OK ===');
