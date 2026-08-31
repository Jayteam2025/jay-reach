/**
 * Le compte LinkedIn depuis lequel l'extension enverra.
 *
 * L'écran de réglages disait « extension connectée » sans dire connectée à
 * quoi. Sur un poste où plusieurs sessions LinkedIn se succèdent — un compte
 * personnel et un compte de prospection, par exemple — c'est la seule
 * information qui permet de voir qu'on s'apprête à écrire depuis le mauvais
 * profil.
 *
 * L'extension appelle cette route après avoir lu `/voyager/api/me`. Le nom et
 * l'identifiant public d'un profil ne sont pas des secrets : ce sont ceux que
 * LinkedIn affiche à quiconque visite la page.
 */
import { createHash } from 'node:crypto';
import { getPool } from '../../../../../lib/db';
import { validateToken } from '../../../../../lib/linkedin/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Le nom affiché reste court : au-delà, c'est qu'on ne lit plus un nom. */
const MAX_LONGUEUR = 120;

function nettoyer(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const net = valeur.trim().slice(0, MAX_LONGUEUR);
  return net.length > 0 ? net : null;
}

export async function POST(req: Request): Promise<Response> {
  let corps: { token?: unknown; name?: unknown; publicIdentifier?: unknown };
  try {
    corps = (await req.json()) as typeof corps;
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  const token = corps.token;
  if (typeof token !== 'string' || token.length === 0) {
    return Response.json({ error: 'Token required' }, { status: 400 });
  }

  const pool = getPool();
  const orgId = await validateToken(pool, token);
  if (!orgId) {
    return Response.json({ error: 'Invalid token' }, { status: 401 });
  }

  const nom = nettoyer(corps.name);
  const identifiant = nettoyer(corps.publicIdentifier);

  // La mise à jour vise le jeton qui a servi à s'authentifier, pas tous ceux de
  // l'organisation : deux opérateurs peuvent avoir chacun le leur, et écraser
  // le profil de l'autre afficherait le mauvais compte à quelqu'un.
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await pool.query(
    `update extension_tokens
        set linkedin_profile_name = $1,
            linkedin_profile_identifier = $2,
            linkedin_seen_at = now()
      where token_hash = $3 and organization_id = $4 and is_active = true`,
    [nom, identifiant, tokenHash, orgId],
  );

  return Response.json({ ok: true });
}
