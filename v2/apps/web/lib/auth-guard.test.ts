import { describe, it, expect } from 'vitest';
import { decideAccess, isPublicPath, PUBLIC_PREFIXES } from './auth-guard';

// Les 17 écrans applicatifs (routes protégées) — aucun n'a de garde propre, la
// protection tient au middleware, d'où ce test qui échoue si la politique laisse
// passer une route applicative sans session.
const APP_ROUTES = [
  '/',
  '/signals',
  '/prospects',
  '/annuaire',
  '/campaigns',
  '/campaigns/123',
  '/inbox',
  '/approvals',
  '/import',
  '/settings/linkedin',
  '/settings/sources',
  '/settings/personas',
  '/settings/customers',
  '/settings/providers',
  '/settings/senders',
];

describe('decideAccess — garde d’authentification du middleware', () => {
  it('Supabase configuré + pas de session → toute route applicative redirige vers le login', () => {
    for (const pathname of APP_ROUTES) {
      expect(decideAccess({ pathname, configured: true, authenticated: false, allowUnconfigured: true })).toBe('redirect-login');
    }
  });

  it('Supabase configuré + session valide → tout passe', () => {
    for (const pathname of APP_ROUTES) {
      expect(decideAccess({ pathname, configured: true, authenticated: true, allowUnconfigured: true })).toBe('allow');
    }
  });

  it('mode démo (non configuré, hors production) → tout passe, y compris sans session', () => {
    for (const pathname of [...APP_ROUTES, '/login']) {
      expect(decideAccess({ pathname, configured: false, authenticated: false, allowUnconfigured: true })).toBe('allow');
    }
  });

  it('non configuré EN PRODUCTION → fail-closed : les routes app redirigent, /login reste accessible', () => {
    // Une prod démarrée sans les variables Supabase ne doit jamais servir le site
    // sans authentification (allowUnconfigured = false en production).
    for (const pathname of APP_ROUTES) {
      expect(decideAccess({ pathname, configured: false, authenticated: false, allowUnconfigured: false })).toBe('redirect-login');
    }
    // Les chemins publics restent joignables, sinon /login bouclerait.
    expect(decideAccess({ pathname: '/login', configured: false, authenticated: false, allowUnconfigured: false })).toBe('allow');
    expect(decideAccess({ pathname: '/api/health', configured: false, authenticated: false, allowUnconfigured: false })).toBe('allow');
  });

  it('un webhook entrant reste joignable en production (Supabase configuré, non authentifié)', () => {
    // Scénario réel : Smartlead POST sans session. Sans /api/webhooks en public,
    // le middleware redirigerait vers /login et le handler ne serait jamais appelé.
    expect(
      decideAccess({ pathname: '/api/webhooks/smartlead', configured: true, authenticated: false, allowUnconfigured: false }),
    ).toBe('allow');
  });

  it('les chemins publics restent accessibles sans session quand Supabase est configuré', () => {
    const publicPaths = [
      '/login',
      '/login?next=/signals',
      '/api/extension/linkedin/next',
      '/api/extension/linkedin/update',
      '/api/health',
      '/extension/auth',
    ];
    for (const pathname of publicPaths) {
      // On teste le chemin sans query (le middleware passe request.nextUrl.pathname).
      const clean = pathname.split('?')[0]!;
      expect(decideAccess({ pathname: clean, configured: true, authenticated: false, allowUnconfigured: true })).toBe('allow');
    }
  });

  it('isPublicPath ne matche pas un préfixe partiel trompeur', () => {
    // /loginfake ne doit pas être traité comme /login.
    expect(isPublicPath('/loginfake')).toBe(false);
    expect(isPublicPath('/api/extensionery')).toBe(false);
    // mais le préfixe exact et ses sous-chemins, oui.
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/api/extension/linkedin/next')).toBe(true);
  });

  it('la liste des préfixes publics est minimale et explicite', () => {
    expect(PUBLIC_PREFIXES).toEqual(['/login', '/api/extension', '/api/webhooks', '/api/health', '/extension/auth']);
  });
});
