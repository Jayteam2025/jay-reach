import { NextResponse, type NextRequest } from 'next/server';

// Rafraîchissement de session Supabase désactivé tant que Supabase n'est pas
// configuré (le SDK n'est pas compatible avec le runtime du middleware). Le vrai
// code vit dans lib/supabase/middleware.ts et sera rebranché au branchement auth.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

// Désactivé : ne matche aucune route (le middleware est un no-op et le runtime
// edge lève une EvalError). Le vrai middleware auth sera rebranché plus tard.
export const config = {
  matcher: ['/__middleware_disabled__'],
};
