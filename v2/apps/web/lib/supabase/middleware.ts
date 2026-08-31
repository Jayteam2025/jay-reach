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
 * En-tête par lequel le middleware transmet l'utilisateur qu'il vient de
 * vérifier, pour que les écrans n'aient pas à le redemander.
 *
 * Il est posé — ou effacé — à CHAQUE requête, donc un client qui l'enverrait
 * lui-même le verrait écrasé. Et il ne sert jamais à autoriser quoi que ce
 * soit : les politiques de sécurité de la base filtrent sur le jeton
 * (`user_id = auth.uid()`), pas sur cet en-tête. Au pire, un identifiant forgé
 * ne renvoie aucune ligne.
 */
export const EN_TETE_UTILISATEUR = 'x-jr-user-id';

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

  // L'identité vérifiée ici voyage avec la requête : la vérifier une seconde
  // fois dans la barre latérale coûtait un aller-retour de plus sur chaque
  // page. L'en-tête est réécrit systématiquement, y compris quand il n'y a pas
  // de session — sans quoi celui d'un client passerait.
  const enTetes = new Headers(request.headers);
  if (data.user) {
    enTetes.set(EN_TETE_UTILISATEUR, data.user.id);
  } else {
    enTetes.delete(EN_TETE_UTILISATEUR);
  }
  const reponse = NextResponse.next({ request: { headers: enTetes } });
  for (const cookie of response.cookies.getAll()) {
    reponse.cookies.set(cookie);
  }

  return { response: reponse, configured: true, authenticated: data.user !== null };
}
