/**
 * Endpoint appelé par l'extension Chrome pour enregistrer le résultat d'une
 * action LinkedIn (envoyée ou échouée). Transition autorisée uniquement depuis
 * `processing` (sinon 409). Valide le jeton et l'appartenance à l'organisation.
 */
import { getPool } from '../../../../../lib/db';
import { recordResult, validateToken } from '../../../../../lib/linkedin/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  let body: { token?: unknown; queue_id?: unknown; status?: unknown; error_code?: unknown; error_message?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  const { token, queue_id, status } = body;
  if (typeof token !== 'string' || token.length === 0) {
    return Response.json({ error: 'Token required' }, { status: 400 });
  }
  if (typeof queue_id !== 'string' || (status !== 'sent' && status !== 'failed')) {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const pool = getPool();
  const orgId = await validateToken(pool, token);
  if (!orgId) {
    return Response.json({ error: 'Invalid token' }, { status: 401 });
  }

  const ok = await recordResult(pool, {
    organizationId: orgId,
    queueId: queue_id,
    status,
    errorCode: typeof body.error_code === 'string' ? body.error_code : null,
    errorMessage: typeof body.error_message === 'string' ? body.error_message : null,
  });
  if (!ok) {
    // Ligne absente, autre org, ou pas en `processing` → conflit.
    return Response.json({ error: 'Not claimable' }, { status: 409 });
  }
  return Response.json({ ok: true }, { status: 200 });
}
