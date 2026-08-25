/**
 * Producteur d'orchestration : ce qui MET les jobs en file. Sans lui, rien ne
 * démarre. Lit les sources actives et enfile un `sources.discover` par source.
 *
 * Idempotent sur une fenêtre temporelle : l'id de job est dérivé de
 * (source, fenêtre), donc deux passages du producteur dans la même fenêtre ne
 * créent qu'un seul job — utile si plusieurs workers tournent en parallèle.
 * Les secrets ne sont jamais dans le payload (résolus à l'exécution).
 */
import type PgBoss from 'pg-boss';
import type { Pool } from 'pg';
import type { DiscoverJob } from './handlers/discover.js';
import { deterministicUuid } from './ids.js';

interface SourceRow {
  readonly id: string;
  readonly organization_id: string;
  readonly provider_id: string;
  readonly config: { keywords?: unknown; location?: unknown } | null;
}

export async function enqueueDiscoverForActiveSources(
  boss: PgBoss,
  pool: Pool,
  opts: { bucket?: string } = {},
): Promise<number> {
  const bucket = opts.bucket ?? 'once';
  const res = await pool.query<SourceRow>(
    `select id, organization_id, provider_id, config
       from sources where is_active = true`,
  );

  let enqueued = 0;
  for (const src of res.rows) {
    const config = src.config ?? {};
    const keywords = Array.isArray(config.keywords) ? config.keywords.map((k) => String(k)).filter(Boolean) : [];
    if (keywords.length === 0) {
      // Une source sans mots-clés n'a rien à chercher — on la saute (pas d'erreur).
      continue;
    }
    const job: DiscoverJob = {
      organizationId: src.organization_id,
      sourceId: src.id,
      provider: src.provider_id,
      keywords,
      ...(typeof config.location === 'string' && config.location ? { location: config.location } : {}),
    };
    const id = deterministicUuid('discover', src.id, bucket);
    await boss.insert([{ name: 'sources.discover', id, data: job }]);
    enqueued += 1;
  }
  return enqueued;
}
