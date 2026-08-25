import { NextResponse, type NextRequest } from 'next/server';
import type { CookieOptions } from '@supabase/ssr';

type CookieToSet = { name: string; value: string; options: CookieOptions };

export interface SessionResult {
  response: NextResponse;
  /** true si Supabase est configuré (donc l'auth peut être exigée). */
  configured: boolean;
  /** true si une session valide est présente. */
  authenticated: boolean;
}

/**
 * Rafraîchit la session Supabase à chaque requête (cookies) et indique si une
 * session est présente. Tant que Supabase n'est pas configuré, ne fait rien —
 * et surtout ne charge pas le SDK (évite une incompatibilité de runtime au
 * démarrage à vide) ; `configured: false` signale à l'appelant de ne pas
 * exiger d'authentification (mode démo).
 */
export async function updateSession(request: NextRequest): Promise<SessionResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { response: NextResponse.next({ request }), configured: false, authenticated: false };
  }

  const { createServerClient } = await import('@supabase/ssr');
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  return { response, configured: true, authenticated: data.user !== null };
}
