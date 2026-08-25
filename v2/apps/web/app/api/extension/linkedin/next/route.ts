/**
 * Endpoint appelé par l'extension Chrome : « donne-moi la prochaine action
 * LinkedIn à envoyer ». Valide le jeton d'extension, applique le pacing et
 * renvoie une action à traiter (ou null + raison). Aucun envoi ici : l'extension
 * exécute l'appel Voyager avec la session de l'utilisateur puis rappelle /update.
 */
import { getPool } from '../../../../../lib/db';
import { claimNext, validateToken } from '../../../../../lib/linkedin/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  let token: unknown;
  try {
    ({ token } = (await req.json()) as { token?: unknown });
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  if (typeof token !== 'string' || token.length === 0) {
    return Response.json({ error: 'Token required' }, { status: 400 });
  }

  const pool = getPool();
  const orgId = await validateToken(pool, token);
  if (!orgId) {
    return Response.json({ error: 'Invalid token' }, { status: 401 });
  }

  const result = await claimNext(pool, orgId);
  return Response.json(result, { status: 200 });
}
