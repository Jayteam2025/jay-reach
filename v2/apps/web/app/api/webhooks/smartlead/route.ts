/**
 * Webhook entrant Smartlead (T27, volet réception) : réponses, bounces et
 * désinscriptions email. L'URL porte `?org=<id>&token=<secret>` (le token est
 * vérifié en temps constant contre le secret stocké dans la config du provider
 * Smartlead de l'organisation — Smartlead ne permet de configurer qu'une URL,
 * pas d'en-tête personnalisé). Contact inconnu → 200 sans rien stocker.
 */
import { timingSafeEqual } from 'node:crypto';
import { parseSmartleadEvent } from '@jay-reach/core';
import { getPool } from '../../../../lib/db';
import { processSmartleadEvent } from '../../../../lib/webhooks/smartlead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const org = url.searchParams.get('org');
  const token = url.searchParams.get('token');
  if (!org || !token) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const pool = getPool();
  const cred = await pool.query<{ secret: string | null }>(
    `select config->>'webhook_secret' as secret from credentials
      where organization_id = $1 and provider_id = 'smartlead'`,
    [org],
  );
  const expected = cred.rows[0]?.secret;
  if (!expected || !safeEqual(token, expected)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }

  const event = parseSmartleadEvent(body);
  if ('error' in event) {
    return Response.json({ error: event.error }, { status: 400 });
  }

  const result = await processSmartleadEvent(pool, org, event);
  return Response.json({ ok: true, ...result });
}
