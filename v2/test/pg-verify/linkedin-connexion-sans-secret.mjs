// Lot 5, tâche 5, étape 6 (spec §14) : aucun secret ne subsiste.
//
// Une connexion COMPLÈTE est jouée sur Postgres avec les fonctions de production : demanderConnexion
// (cœur) -> pg_notify chiffré -> réception sur une connexion LISTEN -> traiterMessageConnexion
// (worker) -> dependancesWeb -> défi -> repondreDefi -> code livré -> réussite. Seul le navigateur
// est remplacé : la « mécanique » (`connecter`) lit les secrets par `demander` / `demanderMasque`
// exactement comme la vraie, puis écrit les mêmes lignes de sortie.
// Puis TOUTES les tables de la base et TOUT ce que le worker a écrit en console sont balayés.
//
// Mutations qui font rougir :
//   1. dependancesWeb.ecrire : écrire la ligne reçue dans `etape` — la contrainte de liste fermée refuse (3).
//   2. traiter-connexion.ts : journaliser `e.message` dans le `catch` du worker — 5 rougit.
//   3. linkedin-connexion.ts : mettre l'identifiant dans le `diff` du journal d'audit — 4 rougit.
//   4. le balayeur lui-même : 2 (valeur plantée) rougit s'il ne cherche plus dans les JSONB.
import pg from 'pg';
import {
  demanderConnexion, lireDemandeEnCours, repondreDefi, lireMessageConnexion, CANAL_CONNEXION_LINKEDIN,
  traiterMessageConnexion, oublierConnexionsEnCours,
} from '__BUNDLE__';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);
let failures = 0;

// Ce que le worker écrit en console : capté pour être balayé (les erreurs et les journaux).
const journal = [];
for (const n of ['log', 'error', 'warn', 'info']) console[n] = (...a) => void journal.push(a.map(String).join(' '));
const sortie = (...a) => process.stdout.write(`${a.join(' ')}\n`);
const dire = (label, ok, extra) => { sortie(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`); if (!ok) failures += 1; };

const IDENTIFIANT = 'jb.secret.4242@exemple-prive.fr';
const MOT_DE_PASSE = 'Mdp-Très-Secret-ZXY-90817';
const CODE = '5738291';

/** Cherche chaque valeur dans toutes les tables (ligne en JSON, donc toutes les colonnes, JSONB compris). */
async function balayer(valeurs) {
  const tables = (await q(`select schemaname, tablename from pg_tables where schemaname in ('public', 'auth')`)).rows;
  const trouvees = [];
  for (const { schemaname, tablename } of tables) {
    const r = await q(`select t::text as ligne from ${schemaname}."${tablename}" t`);
    for (const { ligne } of r.rows) {
      for (const v of valeurs) if (ligne.includes(v)) trouvees.push(`${schemaname}.${tablename}`);
    }
  }
  return { tables: tables.length, trouvees };
}

const org = (await q(`insert into organizations (name, slug) values ('Sans secret', 'sans-secret') returning id`)).rows[0].id;
const user = (await q(`insert into auth.users (email) values ('admin@t.local') returning id`)).rows[0].id;
await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [org, user]);
const ctx = { ex: pool, organisationId: org, utilisateurId: user, role: 'admin' };

// Une connexion LISTEN reçoit ce que la server action émet : c'est le chemin du canal, sans le port forcé de l'écoute.
const ecoute = new pg.Client({ connectionString: process.env.DATABASE_URL });
await ecoute.connect();
await ecoute.query(`LISTEN ${CANAL_CONNEXION_LINKEDIN}`);
const recus = [];
const charges = [];
ecoute.on('notification', (n) => {
  charges.push(n.payload);
  recus.push(lireMessageConnexion(n.payload).then((m) => traiterMessageConnexion(pool, m, { connecter, env: {} })));
});
const attendre = async (cond, ms = 15000) => { const t = Date.now(); while (!(await cond())) { if (Date.now() - t > ms) throw new Error('délai du harnais'); await new Promise((r) => setTimeout(r, 50)); } };

/**
 * La mécanique du terminal, sans navigateur : demande identifiant, mot de passe, puis le code (le
 * défi), et écrit les mêmes lignes que la vraie. `d` est la vraie `dependancesWeb`.
 */
async function connecter(c, d) {
  d.ecrire('Sortie du navigateur : 203.0.113.9 (FR)');
  const id = await d.demander('identifiant');
  const mdp = await d.demanderMasque('motDePasse');
  if (id !== IDENTIFIANT || mdp !== MOT_DE_PASSE) { d.ecrire('Connexion refusée : identifiant ou mot de passe incorrect.'); return 1; }
  const code = await d.demanderMasque('code');
  if (code !== CODE) { d.ecrire('Connexion refusée : identifiant ou mot de passe incorrect.'); return 1; }
  d.ecrire('Session LinkedIn active.');
  return 0;
}

try {
  sortie('\n1. une connexion complète, avec défi');
  const { demandeId } = await demanderConnexion(ctx, { identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE });
  await attendre(async () => (await lireDemandeEnCours(ctx))?.statut === 'code_demande');
  dire('1. la demande arrive au défi (code attendu)', true);
  await repondreDefi(ctx, demandeId, CODE);
  await attendre(async () => (await lireDemandeEnCours(ctx))?.statut === 'reussi');
  await Promise.all(recus);
  const fin = await lireDemandeEnCours(ctx);
  dire('1b. la connexion aboutit : statut reussi, étape session_active', fin?.statut === 'reussi' && fin.etape === 'session_active', JSON.stringify(fin));
  dire('1c. deux messages sont partis (secrets, code), tous deux chiffrés',
    charges.length === 2 && charges.every((c) => !c.includes(IDENTIFIANT) && !c.includes(MOT_DE_PASSE) && !c.includes(CODE)));

  sortie('\n2. le balayeur mord (valeur plantée)');
  // `audit_events` est append-only : la valeur est plantée dans une table témoin, jetée aussitôt.
  await q(`create table public.zz_temoin (j jsonb)`);
  await q(`insert into public.zz_temoin values ($1::jsonb)`, [JSON.stringify({ libelle: 'x', cache: { profond: 'PLANTE-ZZ-77' } })]);
  const temoin = await balayer(['PLANTE-ZZ-77']);
  dire('2. une valeur cachée dans un JSONB imbriqué est retrouvée', temoin.trouvees.includes('public.zz_temoin'), JSON.stringify(temoin.trouvees));
  await q(`drop table public.zz_temoin`);

  sortie('\n3. aucune colonne de la table d\'état ne porte un secret');
  const etat = await q(`select (t::text) as ligne from linkedin_connexion_demandes t`);
  dire('3. la table d\'état a des lignes, et aucune ne contient identifiant, mot de passe ni code',
    etat.rows.length >= 1 && etat.rows.every((r) => ![IDENTIFIANT, MOT_DE_PASSE, CODE].some((s) => r.ligne.includes(s))), `${etat.rows.length} ligne(s)`);

  sortie('\n4. aucune table de la base ne contient un secret');
  const base = await balayer([IDENTIFIANT, MOT_DE_PASSE, CODE, 'Mdp-Très', 'jb.secret']);
  dire(`4. ${base.tables} tables balayées (public, auth) : aucune trace`, base.trouvees.length === 0, JSON.stringify(base.trouvees));
  const audit = (await q(`select action from audit_events where organization_id = $1 order by created_at`, [org])).rows.map((r) => r.action);
  dire('4b. la tentative a laissé son audit : demandée, puis terminée', audit.includes('linkedin.connexion_demandee') && audit.includes('linkedin.connexion_terminee'), audit.join(', '));

  sortie('\n5. aucune trace dans le journal du worker, même quand la connexion plante');
  oublierConnexionsEnCours();
  const m2 = (await q(`insert into linkedin_connexion_demandes (organization_id, demandee_par, statut) values ($1, $2, 'demandee') returning id`, [org, user])).rows[0].id;
  await traiterMessageConnexion(pool, { type: 'secrets', demandeId: m2, organizationId: org, identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE }, {
    connecter: async () => { throw new Error(`Chromium a planté : ${IDENTIFIANT} ${MOT_DE_PASSE} ${CODE}`); },
  });
  const apres = (await q(`select statut, motif from linkedin_connexion_demandes where id = $1`, [m2])).rows[0];
  dire('5. la panne se clôt en erreur_interne', apres.statut === 'echec' && apres.motif === 'erreur_interne', JSON.stringify(apres));
  const texte = journal.join('\n');
  dire(`5b. ${journal.length} ligne(s) de journal du worker, aucune ne porte un secret`,
    journal.length > 0 && ![IDENTIFIANT, MOT_DE_PASSE, CODE].some((s) => texte.includes(s)));
  const base2 = await balayer([IDENTIFIANT, MOT_DE_PASSE, CODE]);
  dire('5c. et la base reste propre après la panne', base2.trouvees.length === 0, JSON.stringify(base2.trouvees));
} catch (e) {
  failures += 1;
  sortie(`  FAIL le harnais a levé : ${e.stack ?? e.message}`);
}

await ecoute.end();
await pool.end();
sortie(`\n[linkedin-connexion-sans-secret] ${failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`}`);
process.exit(failures === 0 ? 0 : 1);
