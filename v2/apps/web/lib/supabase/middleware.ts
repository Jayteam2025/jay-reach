import { NextResponse, type NextRequest } from 'next/server';
import type { CookieOptions } from '@supabase/ssr';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Rafraîchit la session Supabase à chaque requête (cookies). Tant que Supabase
 * n'est pas configuré, ne fait rien — et surtout ne charge pas le SDK (évite
 * une incompatibilité de runtime au démarrage à vide).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.next({ request });
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

  await supabase.auth.getUser();
  return response;
}
