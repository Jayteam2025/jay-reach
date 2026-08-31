/**
 * Cree un compte et le rattache a une organisation existante.
 *
 * Passe par l'API d'administration Supabase plutot que par l'inscription
 * publique : le compte est confirme d'emblee, et on choisit son role dans
 * l'organisation. L'invitation par email reste possible depuis l'application,
 * mais elle suppose un serveur d'envoi configure.
 *
 * Le mot de passe est lu sur l'entree standard, jamais passe en argument : un
 * argument de ligne de commande est visible dans la liste des processus.
 *
 * Usage :
 *   printf 'motdepasse' | node --env-file=.env apps/worker/scripts/creer-compte.mjs <email> <organisation_id> <role>
 */
import { readFileSync } from 'node:fs';

const [email, organisationId, role = 'admin'] = process.argv.slice(2);
if (!email || !organisationId) {
  console.error('Usage : printf <motdepasse> | node ... creer-compte.mjs <email> <organisation_id> [role]');
  process.exit(1);
}
if (!['owner', 'admin', 'operator', 'viewer'].includes(role)) {
  console.error(`Role invalide : ${role}. Attendu : owner, admin, operator ou viewer.`);
  process.exit(1);
}

let motDePasse = '';
try {
  motDePasse = readFileSync(0, 'utf8').trim();
} catch {
  /* pas d'entree standard */
}
if (motDePasse.length < 12) {
  console.error('Mot de passe absent ou trop court (12 caracteres minimum).');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !cle) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.');
  process.exit(1);
}
const entetes = { apikey: cle, Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' };

// 1. Le compte existe-t-il deja ?
const recherche = await fetch(`${url}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, { headers: entetes });
const trouves = recherche.ok ? ((await recherche.json()).users ?? []) : [];
let userId = trouves.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;

if (userId) {
  // Compte existant : on remet le mot de passe pour que le titulaire puisse
  // entrer, sans toucher au reste.
  const maj = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: entetes,
    body: JSON.stringify({ password: motDePasse, email_confirm: true }),
  });
  console.log(maj.ok ? 'compte existant : mot de passe reinitialise' : `echec de mise a jour (${maj.status})`);
} else {
  const creation = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ email, password: motDePasse, email_confirm: true }),
  });
  if (!creation.ok) {
    console.error('Echec de creation :', creation.status, (await creation.text()).slice(0, 200));
    process.exit(1);
  }
  userId = (await creation.json()).id;
  console.log('compte cree');
}

// 2. Rattachement a l'organisation.
const pg = await import('/Users/jayb/DEV/Jay/jay-reach/v2/node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js');
const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const r = await pool.query(
    `insert into memberships (organization_id, user_id, role)
     values ($1, $2, $3)
       on conflict (organization_id, user_id) do update set role = excluded.role
     returning role`,
    [organisationId, userId, role],
  );
  console.log('membre de l organisation, role :', r.rows[0]?.role);
} finally {
  await pool.end();
}
console.log('identifiant :', userId);
