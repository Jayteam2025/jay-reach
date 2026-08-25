import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';
import { decideAccess } from './lib/auth-guard';

export async function middleware(request: NextRequest) {
  const { response, configured, authenticated } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Hors production, on tolère l'absence de config Supabase (mode démo/dev) ;
  // en production, on verrouille (voir decideAccess) pour ne jamais servir le
  // site sans authentification si les variables Supabase manquent.
  const allowUnconfigured = process.env.NODE_ENV !== 'production';
  const decision = decideAccess({ pathname, configured, authenticated, allowUnconfigured });
  if (decision === 'allow') {
    return response;
  }

  // Route applicative sans session → redirection vers /login (avec retour).
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

// Matche toutes les routes applicatives, sauf les assets statiques Next, le
// service worker et les fichiers publics à extension. La logique publique/privée
// fine est gérée par decideAccess (lib/auth-guard.ts).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)'],
};
