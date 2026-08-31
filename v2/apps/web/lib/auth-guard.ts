// Politique d'accès du middleware, isolée en fonction pure pour être testable
// sans serveur. Le middleware (middleware.ts) applique cette décision.

// Chemins accessibles sans session :
//  - /login          : la page de connexion elle-même
//  - /api/extension  : endpoints de l'extension (auth par token, pas par session)
//  - /api/webhooks   : webhooks entrants (Smartlead…) — auth par token dans l'URL
//  - /api/health     : sonde de disponibilité
//  - /api/cron       : tâches planifiées — auth par CRON_SECRET, jamais par session
//  - /extension/auth : handshake OAuth du token d'extension
//
// Ces chemins ne sont pas « ouverts » : chacun porte sa propre authentification.
// Ce qu'ils ont en commun, c'est qu'aucun appelant n'a de session de navigateur —
// une redirection vers la page de connexion n'aurait donc aucun sens.
export const PUBLIC_PREFIXES = [
  '/login',
  '/api/extension',
  '/api/webhooks',
  '/api/health',
  '/api/cron',
  '/extension/auth',
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type AccessDecision = 'allow' | 'redirect-login';

/**
 * Décide si une requête peut atteindre la route ou doit être renvoyée au login.
 *
 * - Les chemins publics (/login, endpoints extension…) passent toujours.
 * - Supabase non configuré : `allowUnconfigured` tranche. En dev (mode démo,
 *   aucune donnée réelle) on laisse passer pour ne pas rendre l'app inutilisable ;
 *   en PRODUCTION on **verrouille** (fail-closed) — une prod démarrée sans les
 *   variables Supabase (oubli .env, injection Docker ratée) ne doit jamais servir
 *   tout le site sans authentification.
 * - Supabase configuré (données réelles) : une route applicative non publique
 *   exige une session.
 */
export function decideAccess(input: {
  pathname: string;
  configured: boolean;
  authenticated: boolean;
  allowUnconfigured: boolean;
}): AccessDecision {
  if (isPublicPath(input.pathname)) return 'allow';
  if (!input.configured) return input.allowUnconfigured ? 'allow' : 'redirect-login';
  if (input.authenticated) return 'allow';
  return 'redirect-login';
}
