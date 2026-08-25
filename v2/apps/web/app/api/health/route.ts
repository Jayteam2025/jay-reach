import { CORE_VERSION } from '@jay-reach/core';
import { getPool } from '../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sonde de santé (T33) : vérifie la base (ping SQL + latence) et rapporte l'état
 * agrégé. Renvoie 200 si tout est OK, 503 sinon. Aucune donnée personnelle.
 */
export async function GET(): Promise<Response> {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  // Base de données.
  const t0 = Date.now();
  try {
    await getPool().query('select 1');
    checks.database = { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    checks.database = { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return Response.json(
    { status: ok ? 'ok' : 'degraded', service: 'web', core: CORE_VERSION, checks },
    { status: ok ? 200 : 503 },
  );
}
