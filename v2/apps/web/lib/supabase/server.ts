import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireEnv } from '../env';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** Comme `createClient`, mais renvoie null si Supabase n'est pas configuré
 *  (permet aux écrans de s'afficher à vide plutôt que de planter). */
export async function createClientOrNull() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return null;
  }
  return createClient();
}

/** Client Supabase côté serveur (RSC / Server Actions / Route Handlers). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Appelé depuis un Server Component : le refresh de session est
            // géré par le middleware, on ignore.
          }
        },
      },
    },
  );
}
