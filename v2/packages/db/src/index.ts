import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Schéma généré (T2) via `supabase gen types typescript --local`.
 * Régénérer après chaque migration : `pnpm --filter @jay-reach/db db:types`.
 */
export type { Database, Json } from './database.types.js';
import type { Database } from './database.types.js';

/**
 * Client Supabase typé. Le worker utilise la clé de service (bypass RLS) et
 * DOIT filtrer explicitement par organisation dans chaque requête.
 */
export function createDbClient(url: string, key: string): SupabaseClient<Database> {
  if (!url || !key) {
    throw new Error('SUPABASE_URL et une clé sont requis pour créer le client DB.');
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
