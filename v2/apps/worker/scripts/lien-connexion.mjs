/**
 * Genere un lien de connexion pour un compte, via l'API d'administration
 * Supabase. Sert a se connecter en recette sans connaitre ni modifier le mot de
 * passe du titulaire.
 *
 * Le lien est a usage unique et expire. La cle de service n'est jamais affichee.
 *
 * Usage : node --env-file=.env apps/worker/scripts/lien-connexion.mjs <email> [redirection]
 */
const email = process.argv[2];
const redirection = process.argv[3] ?? 'https://jay-reach.vercel.app/';

if (!email) {
  console.error('Usage : node --env-file=.env apps/worker/scripts/lien-connexion.mjs <email> [redirection]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !cle) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.');
  process.exit(1);
}

const res = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: { apikey: cle, Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email, options: { redirect_to: redirection } }),
});

const corps = await res.text();
if (!res.ok) {
  // Le corps d'erreur peut contenir la requete : on ne relaie que le statut et
  // le message, jamais l'echo des en-tetes.
  let message = `HTTP ${res.status}`;
  try {
    const j = JSON.parse(corps);
    message = j.msg ?? j.message ?? j.error_description ?? message;
  } catch {
    /* corps non JSON */
  }
  console.error('Echec :', message);
  process.exit(1);
}

const donnees = JSON.parse(corps);
const lien = donnees.action_link ?? donnees.properties?.action_link;
if (!lien) {
  console.error('Reponse sans lien exploitable.');
  process.exit(1);
}
console.log(lien);
