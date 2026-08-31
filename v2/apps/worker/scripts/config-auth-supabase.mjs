/**
 * Lit ou met a jour la configuration Auth du projet Supabase (URL du site et
 * redirections autorisees), via l'API de gestion.
 *
 * Sans cette configuration, les liens de confirmation d'email et de connexion
 * pointent vers l'URL par defaut du projet — localhost en developpement. Un
 * utilisateur invite recevrait donc un lien vers la machine de quelqu'un
 * d'autre.
 *
 * Usage :
 *   node --env-file=.env apps/worker/scripts/config-auth-supabase.mjs lire
 *   node --env-file=.env apps/worker/scripts/config-auth-supabase.mjs ecrire <site_url> <redirections separees par des virgules>
 */
const PROJET = 'jstcgfgwaeesrqztsvhe';
const jeton = process.env.SUPABASE_ACCESS_TOKEN;

if (!jeton) {
  console.error('SUPABASE_ACCESS_TOKEN absent du .env.');
  process.exit(1);
}

const base = `https://api.supabase.com/v1/projects/${PROJET}/config/auth`;
const entetes = { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' };

const action = process.argv[2] ?? 'lire';

if (action === 'lire') {
  const res = await fetch(base, { headers: entetes });
  if (!res.ok) {
    console.error('Echec de lecture :', res.status);
    process.exit(1);
  }
  const c = await res.json();
  console.log('site_url        :', c.site_url);
  console.log('uri_allow_list  :', c.uri_allow_list || '(vide)');
  console.log('confirmations   :', c.mailer_autoconfirm ? 'auto (pas d email)' : 'par email');
} else if (action === 'ecrire') {
  const siteUrl = process.argv[3];
  const redirections = process.argv[4];
  if (!siteUrl || !redirections) {
    console.error('Usage : ecrire <site_url> <redirections>');
    process.exit(1);
  }
  const res = await fetch(base, {
    method: 'PATCH',
    headers: entetes,
    body: JSON.stringify({ site_url: siteUrl, uri_allow_list: redirections }),
  });
  if (!res.ok) {
    console.error('Echec d ecriture :', res.status, (await res.text()).slice(0, 200));
    process.exit(1);
  }
  const c = await res.json();
  console.log('site_url        :', c.site_url);
  console.log('uri_allow_list  :', c.uri_allow_list);
} else {
  console.error('Action inconnue. Utiliser « lire » ou « ecrire ».');
  process.exit(1);
}
