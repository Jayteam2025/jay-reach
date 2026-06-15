import { supabase } from '@/lib/supabase';

/**
 * Invoque une edge function via fetch direct plutot que
 * supabase.functions.invoke.
 *
 * Pourquoi : le client supabase-js a un timeout implicite qui coupe les
 * requetes longues (>20-60s selon les cas) en silence, sans remonter
 * d'erreur. Pour les endpoints lents (wipe DB, scrape cron, reenrich
 * batch) on veut un timeout explicite et la garantie que l'appel part.
 *
 * Utilisation :
 *   const data = await invokeEdgeFunction<MyResponse>('wipe-prospection-db', {});
 */
export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  body: unknown = {},
  options: { timeoutMs?: number } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 180_000;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Pas de session active');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': anonKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${functionName} HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as T | { error?: string };
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      throw new Error(String(data.error));
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}
