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

/**
 * Enfile un `signals.score` par organisation ayant des signaux à scorer
 * (`status='new'` et `score is null`). Idempotent par fenêtre : un seul job par
 * (organisation, fenêtre). Le scoring lui-même lit un lot et s'arrête ; le
 * producteur périodique reprogramme tant qu'il reste des signaux.
 */
export async function enqueueScoringForOrgs(
  boss: PgBoss,
  pool: Pool,
  opts: { bucket?: string } = {},
): Promise<number> {
  const bucket = opts.bucket ?? 'once';
  const res = await pool.query<{ organization_id: string }>(
    `select distinct organization_id
       from signals where status = 'new' and score is null`,
  );
  let enqueued = 0;
  for (const row of res.rows) {
    const id = deterministicUuid('score', row.organization_id, bucket);
    await boss.insert([{ name: 'signals.score', id, data: { organizationId: row.organization_id } }]);
    enqueued += 1;
  }
  return enqueued;
}

/**
 * Enfile un `enrichment.company` par (compte qualifié, persona) pour les comptes
 * qu'un signal a qualifiés et qui n'ont pas encore été enrichis.
 *
 * C'est le maillon qui manquait entre le scoring et l'enrichissement : les
 * handlers existaient et écoutaient leurs files, mais personne n'y déposait de
 * job. Un signal qualifié restait donc sans suite.
 *
 * FullEnrich est facturé à l'appel, d'où trois précautions :
 *  - seuls les comptes JAMAIS enrichis (`enriched_at is null`) sont candidats ;
 *  - l'identifiant de job est déterministe par (compte, persona), donc un
 *    passage répété du producteur ne redemande pas le même enrichissement ;
 *  - le lot est plafonné, pour qu'une grosse collecte ne déclenche pas des
 *    centaines d'appels d'un coup.
 *
 * Le persona fournit les intitulés de poste recherchés : sans eux, le handler
 * résout l'entreprise mais ne cherche aucun contact.
 */
export async function enqueueEnrichmentForQualified(
  boss: PgBoss,
  pool: Pool,
  opts: { limit?: number } = {},
): Promise<number> {
  const limit = opts.limit ?? 25;
  const res = await pool.query<{
    organization_id: string;
    account_id: string;
    company_name: string;
    domain: string | null;
    country: string | null;
    persona_id: string;
    title_patterns: string[];
  }>(
    `select distinct a.organization_id, a.id as account_id, a.name as company_name,
            a.domain, a.country, p.id as persona_id, p.title_patterns
       from signals s
       join accounts a on a.id = s.account_id
       join personas p on p.organization_id = a.organization_id
      where s.status = 'qualified'
        and a.enriched_at is null
        and array_length(p.title_patterns, 1) > 0
      limit $1`,
    [limit],
  );

  let enqueued = 0;
  for (const row of res.rows) {
    await boss.insert([
      {
        name: 'enrichment.company',
        id: deterministicUuid('enrich-company', row.account_id, row.persona_id),
        data: {
          organizationId: row.organization_id,
          accountId: row.account_id,
          companyName: row.company_name,
          ...(row.domain ? { domain: row.domain } : {}),
          ...(row.country ? { countryCode: row.country } : {}),
          personaId: row.persona_id,
          positionTitles: row.title_patterns,
        },
      },
    ]);
    enqueued += 1;
  }
  return enqueued;
}

/**
 * Enfile les collectes demandées à la main depuis l'écran Sources.
 *
 * Le bouton « lancer maintenant » pose un horodatage sur la source ; c'est ici
 * qu'il devient un job. Deux différences avec la planification :
 *  - l'identifiant du job n'est PAS déterministe par fenêtre : demander deux
 *    fois de suite, c'est vouloir deux collectes, pas une seule dédupliquée ;
 *  - la demande est effacée avant d'enfiler, pour qu'un worker qui redémarre
 *    au mauvais moment ne relance pas une collecte déjà partie.
 *
 * Une source sans mots-clés voit sa demande effacée sans job : elle n'a rien à
 * chercher, et laisser la demande en place la ferait relever à chaque cycle.
 */
export async function enqueueRequestedRuns(boss: PgBoss, pool: Pool): Promise<number> {
  // `returning` sous le UPDATE : la demande est consommée et lue d'un seul geste,
  // donc deux workers ne peuvent pas enfiler la même collecte.
  const res = await pool.query<SourceRow>(
    `update sources
        set run_requested_at = null
      where run_requested_at is not null
      returning id, organization_id, provider_id, config`,
  );

  let enqueued = 0;
  for (const src of res.rows) {
    const config = src.config ?? {};
    const keywords = Array.isArray(config.keywords) ? config.keywords.map((k) => String(k)).filter(Boolean) : [];
    if (keywords.length === 0) {
      console.warn(`[producer] collecte demandée pour la source ${src.id} sans mots-clés — ignorée`);
      continue;
    }
    const job: DiscoverJob = {
      organizationId: src.organization_id,
      sourceId: src.id,
      provider: src.provider_id,
      keywords,
      ...(typeof config.location === 'string' && config.location ? { location: config.location } : {}),
    };
    await boss.send('sources.discover', job);
    enqueued += 1;
  }
  return enqueued;
}
