/** Lecture d'une variable d'environnement serveur, avec message clair si absente. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

/**
 * URL publique de l'instance, celle qu'on affiche à l'opérateur pour qu'il la
 * colle chez un provider (webhook Smartlead, notamment).
 *
 * `APP_URL` d'abord : c'est la variable documentée, la seule qui vaille quand
 * on s'auto-héberge. À défaut, on déduit l'URL de production Vercel.
 *
 * `VERCEL_URL` est volontairement ignorée : elle désigne le déploiement courant
 * et change à chaque envoi. Un webhook configuré avec cette URL-là cesserait de
 * recevoir au déploiement suivant, sans que rien ne le signale.
 */
export function appUrl(): string {
  const explicite = process.env.APP_URL?.trim();
  if (explicite) {
    return explicite.replace(/\/+$/, '');
  }
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return production ? `https://${production}` : '';
}
