/**
 * Réponses LinkedIn relevées par l'extension.
 *
 * L'extension envoie mais ne lisait rien : un prospect qui répondait sur
 * LinkedIn continuait de recevoir les relances email, puisque rien ne le
 * signalait. Ce trou allait contre la règle n° 9 (« une réponse ne doit jamais
 * passer inaperçue ») et contre la raison d'être du séquenceur multicanal.
 *
 * Le serveur ne peut pas interroger LinkedIn lui-même — seule l'extension a la
 * session de l'utilisateur. Elle relève donc les conversations et les dépose
 * ici, où elles suivent exactement le même traitement qu'une réponse email :
 * classement, ouverture du fil, arrêt de la séquence, notification.
 *
 * Un contact inconnu ne laisse aucune trace, comme pour le webhook Smartlead :
 * la boîte de réception de l'opérateur ne doit contenir que des gens qu'il a
 * lui-même démarchés, pas sa messagerie LinkedIn personnelle.
 */
import { getPool } from '../../../../../lib/db';
import { validateToken } from '../../../../../lib/linkedin/queue';
import { notifyReply, recordInboundReply } from '../../../../../lib/inbox/record-reply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Une conversation relevée par l'extension. */
interface ReponseEntrante {
  readonly profileUrn?: unknown;
  readonly linkedinUrl?: unknown;
  readonly text?: unknown;
  readonly messageId?: unknown;
  readonly receivedAt?: unknown;
}

/** Nombre de réponses acceptées par appel : une relève normale en compte peu. */
const MAX_PAR_APPEL = 50;

/** Extrait l'identifiant public d'un profil (`.../in/<vanity>/`). */
function vanityDe(url: string): string | null {
  const m = url.match(/\/in\/([^/?#]+)/);
  return m?.[1] ? decodeURIComponent(m[1]).toLowerCase() : null;
}

export async function POST(req: Request): Promise<Response> {
  let body: { token?: unknown; replies?: unknown; resolvedProfiles?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  const { token, replies } = body;
  if (typeof token !== 'string' || token.length === 0) {
    return Response.json({ error: 'Token required' }, { status: 400 });
  }
  if (!Array.isArray(replies)) {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }
  if (replies.length > MAX_PAR_APPEL) {
    return Response.json({ error: 'Too many replies' }, { status: 413 });
  }

  const pool = getPool();
  const orgId = await validateToken(pool, token);
  if (!orgId) {
    return Response.json({ error: 'Invalid token' }, { status: 401 });
  }

  // L'extension remonte les URN qu'elle a résolus pour des contacts qui n'en
  // avaient pas. Sans eux, une réponse de ces contacts ne serait jamais
  // rattachée : un message reçu ne porte que l'URN de son auteur.
  let profilsResolus = 0;
  if (Array.isArray(body.resolvedProfiles)) {
    for (const p of body.resolvedProfiles.slice(0, MAX_PAR_APPEL) as { vanity?: unknown; urn?: unknown }[]) {
      if (typeof p.vanity !== 'string' || typeof p.urn !== 'string') continue;
      if (!p.urn.startsWith('urn:li:fsd_profile:')) continue;
      const maj = await pool.query(
        `update contacts set linkedin_provider_id = $3
          where organization_id = $1
            and lower(linkedin_url) like '%/in/' || $2 || '%'
            and linkedin_provider_id is null`,
        [orgId, p.vanity.toLowerCase(), p.urn],
      );
      profilsResolus += maj.rowCount ?? 0;
    }
  }

  let enregistrees = 0;
  let deja = 0;
  let inconnues = 0;

  for (const brut of replies as ReponseEntrante[]) {
    const texte = typeof brut.text === 'string' ? brut.text.trim() : '';
    if (texte.length === 0) continue;

    const urn = typeof brut.profileUrn === 'string' ? brut.profileUrn : null;
    const url = typeof brut.linkedinUrl === 'string' ? brut.linkedinUrl : null;
    const vanity = url ? vanityDe(url) : null;
    if (!urn && !vanity) continue;

    // Résolution par l'URN d'abord — il ne change pas — puis par l'identifiant
    // public, que les contacts importés portent le plus souvent.
    const trouve = await pool.query<{ id: string }>(
      `select id from contacts
        where organization_id = $1
          and (($2::text is not null and linkedin_provider_id = $2)
            or ($3::text is not null and lower(linkedin_url) like '%/in/' || $3 || '%'))
        limit 1`,
      [orgId, urn, vanity],
    );
    const contact = trouve.rows[0];
    if (!contact) {
      inconnues += 1;
      continue;
    }

    // L'URN est plus stable que l'URL : on le retient au passage s'il manquait.
    if (urn) {
      await pool.query(
        `update contacts set linkedin_provider_id = $2
          where id = $1 and (linkedin_provider_id is null or linkedin_provider_id <> $2)`,
        [contact.id, urn],
      );
    }

    const recu = typeof brut.receivedAt === 'string' ? new Date(brut.receivedAt) : new Date();
    const resultat = await recordInboundReply(pool, orgId, {
      contactId: contact.id,
      channel: 'linkedin_message',
      body: texte,
      providerMessageId: typeof brut.messageId === 'string' ? brut.messageId : null,
      ...(Number.isNaN(recu.getTime()) ? {} : { receivedAt: recu }),
      raw: { source: 'extension_linkedin' },
    });

    if (resultat.isNew) {
      enregistrees += 1;
      await notifyReply(pool, orgId, 'Nouvelle réponse LinkedIn', texte.slice(0, 140));
    } else {
      deja += 1;
    }
  }

  return Response.json({ ok: true, enregistrees, deja, inconnues, profilsResolus }, { status: 200 });
}
