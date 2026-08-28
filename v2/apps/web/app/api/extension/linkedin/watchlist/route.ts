/**
 * Liste des profils LinkedIn que l'extension doit surveiller.
 *
 * La relève des réponses se fait dans le navigateur, sur la messagerie
 * personnelle de l'opérateur. Sans cette liste, l'extension n'aurait aucun moyen
 * de savoir quelles conversations concernent la prospection, et devrait envoyer
 * toute sa messagerie au serveur pour qu'il trie — y compris des échanges
 * privés qui n'ont rien à y faire.
 *
 * On inverse donc le sens : le serveur dit qui il suit, l'extension filtre chez
 * elle, et seules les réponses des personnes réellement démarchées sortent du
 * navigateur.
 *
 * Rien de secret ici : ce sont les profils publics des contacts de
 * l'organisation, que l'extension connaît déjà puisqu'elle leur écrit.
 */
import { getPool } from '../../../../../lib/db';
import { validateToken } from '../../../../../lib/linkedin/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Plafond de profils renvoyés. La relève ne compare qu'aux vingt dernières
 * conversations : une liste énorme ne servirait à rien et alourdirait chaque
 * tour de boucle.
 */
const MAX_PROFILS = 500;

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

  // On surveille qui a été contacté ou est sur le point de l'être : une
  // inscription vivante, ou une action LinkedIn passée par la file. Un contact
  // dont la séquence est finie depuis longtemps n'a plus à être écouté.
  const res = await pool.query<{ urn: string | null; url: string | null }>(
    `select distinct c.linkedin_provider_id as urn, c.linkedin_url as url
       from contacts c
      where c.organization_id = $1
        and (c.linkedin_url is not null or c.linkedin_provider_id is not null)
        and (
          exists (
            select 1 from enrollments e
             where e.contact_id = c.id
               and e.status in ('active', 'paused', 'paused_absence')
          )
          or exists (
            select 1 from linkedin_action_queue q
             where q.contact_id = c.id
               and q.created_at > now() - interval '90 days'
          )
        )
      limit $2`,
    [orgId, MAX_PROFILS],
  );

  const profils = res.rows.map((r) => ({
    urn: r.urn,
    // L'identifiant public suffit à l'extension : elle compare des profils, pas des URL.
    vanity: r.url ? (r.url.match(/\/in\/([^/?#]+)/)?.[1]?.toLowerCase() ?? null) : null,
  }));

  return Response.json({ profils }, { status: 200 });
}
