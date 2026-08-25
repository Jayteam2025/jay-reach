import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from '../env';

/**
 * Client Supabase avec la clé de service — **serveur/worker uniquement**.
 * Bypasse la RLS : l'appelant DOIT vérifier le rôle lui-même avant usage.
 * Ne jamais importer depuis un composant client.
 */
export function createServiceClient() {
  return createSupabaseClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
