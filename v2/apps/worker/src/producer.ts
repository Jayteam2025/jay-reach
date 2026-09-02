/**
 * Producteur d'orchestration : ce qui MET les jobs en file. Sans lui, rien ne
 * démarre. Enfile un `sources.discover` par couple (thème de veille,
 * fournisseur rattaché) : un thème cherché chez deux fournisseurs donne deux
 * collectes, avec les mêmes mots-clés puisqu'ils appartiennent au thème.
 *
 * Idempotent sur une fenêtre temporelle : l'id de job est dérivé de
 * (rattachement, fenêtre), donc deux passages du producteur dans la même
 * fenêtre ne créent qu'un seul job — utile si plusieurs workers tournent en
 * parallèle. Il est dérivé du rattachement et non du thème, sans quoi deux
 * fournisseurs du même thème produiraient le même identifiant et l'un des deux
 * serait silencieusement écarté.
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
  /** Identifiant du rattachement (thème, fournisseur), pour tracer l'exécution. */
  readonly source_provider_id: string;
  readonly config: { keywords?: unknown; location?: unknown } | null;
}

export async function enqueueDiscoverForActiveSources(
  boss: PgBoss,
  pool: Pool,
  opts: { bucket?: string } = {},
): Promise<number> {
  const bucket = opts.bucket ?? 'once';
  const res = await pool.query<SourceRow>(
    `select s.id, s.organization_id, sp.provider_id, sp.id as source_provider_id, s.config
       from sources s
       join source_providers sp on sp.source_id = s.id
      where s.is_active = true and sp.is_active = true`,
  );

  let enqueued = 0;
  for (const src of res.rows) {
    const config = src.config ?? {};
    const keywords = Array.isArray(config.keywords) ? config.keywords.map((k) => String(k)).filter(Boolean) : [];
    if (keywords.length === 0) {
      // Un thème sans mots-clés n'a rien à chercher — on le saute (pas d'erreur).
      continue;
    }
    const job: DiscoverJob = {
      organizationId: src.organization_id,
      sourceId: src.id,
      provider: src.provider_id,
      sourceProviderId: src.source_provider_id,
      keywords,
      ...(typeof config.location === 'string' && config.location ? { location: config.location } : {}),
    };
    const id = deterministicUuid('discover', src.source_provider_id, bucket);
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
 * FullEnrich est facturé à l'appel, d'où quatre précautions :
 *  - un plafond quotidien, décompté ici plutôt que dans le handler : refuser
 *    un job avant de le créer coûte moins cher que de le créer pour l'annuler,
 *    et le compteur est le même que celui qui protège déjà Reoon ;
 *  - seuls les comptes JAMAIS enrichis (`enriched_at is null`) sont candidats ;
 *  - l'identifiant de job est déterministe par (compte, persona), donc un
 *    passage répété du producteur ne redemande pas le même enrichissement ;
 *  - le lot est plafonné, pour qu'une grosse collecte ne déclenche pas des
 *    centaines d'appels d'un coup.
 *
 * Le persona fournit les intitulés de poste recherchés : sans eux, le handler
 * résout l'entreprise mais ne cherche aucun contact.
 *
 * Le signal qui a qualifié le compte voyage avec le job jusqu'au contact créé.
 * Il était perdu ici : la requête partait bien des signaux, mais son `distinct`
 * ne retenait que le couple (compte, persona). Résultat, les 102 contacts de
 * la base ne portaient aucune origine, et rien ne disait quelle offre avait
 * déclenché quelle prise de contact. On garde le signal qualifié le plus
 * récent — un compte peut en avoir plusieurs, et le dernier est celui qui
 * motive l'enrichissement.
 */
/**
 * Paires (compte, persona) enrichies par jour, au maximum.
 *
 * Rien ne bornait cette dépense : vingt-cinq paires par tour, un tour tous les
 * quarts d'heure, soit deux mille quatre cents appels quotidiens possibles —
 * soixante fois ce qu'une capacité d'envoi de cent trente-cinq courriels par
 * jour peut consommer. La valeur est donc dérivée de la sortie, pas de ce que
 * le moteur sait faire.
 */
const PLAFOND_ENRICHISSEMENT_PAR_DEFAUT = Number(process.env.ENRICH_DAILY_CAP ?? 50);

/**
 * Plafond de l'organisation, tel qu'elle l'a saisi dans l'écran Fournisseurs.
 *
 * Une variable d'environnement ne se règle pas depuis l'application : personne
 * ne voyait ce plafond, et un opérateur cherchait où borner sa dépense sans
 * rien trouver. Le réglage vit maintenant à côté de la clé du fournisseur,
 * comme celui de Reoon. L'environnement reste le repli, pour une instance qui
 * n'a rien saisi.
 */
async function plafondEnrichissement(pool: Pool, organizationId: string): Promise<number> {
  const res = await pool.query<{ valeur: string | null }>(
    `select config ->> 'daily_cap' as valeur
       from credentials where organization_id = $1 and provider_id = 'fullenrich'`,
    [organizationId],
  );
  const saisi = Number(res.rows[0]?.valeur);
  // Zéro est un réglage, pas une absence : c'est ainsi qu'on met
  // l'enrichissement automatique en pause le temps d'éprouver la chaîne sur
  // deux entreprises choisies à la main. Le traiter comme invalide aurait
  // rétabli le plafond par défaut — l'inverse exact de ce qui est demandé.
  return Number.isFinite(saisi) && saisi >= 0 ? saisi : PLAFOND_ENRICHISSEMENT_PAR_DEFAUT;
}

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
    source_signal_id: string;
  }>(
    `with candidats as (
       select distinct on (a.id, p.id)
              a.organization_id, a.id as account_id, a.name as company_name,
              a.domain, a.country, p.id as persona_id, p.title_patterns,
              s.id as source_signal_id, s.score
         from signals s
         join accounts a on a.id = s.account_id
         join personas p on p.organization_id = a.organization_id
        where s.status = 'qualified'
          and a.enriched_at is null
          and p.is_active
          and array_length(p.title_patterns, 1) > 0
        order by a.id, p.id, s.occurred_at desc, s.id
     )
     select organization_id, account_id, company_name, domain, country,
            persona_id, title_patterns, source_signal_id
       from candidats
      order by score desc nulls last, account_id
      limit $1`,
    [limit],
  );

  let enqueued = 0;
  // Un plafond par organisation, lu une seule fois pour tout le lot.
  const plafonds = new Map<string, number>();
  for (const row of res.rows) {
    // Le crédit se prend AVANT de déposer le job, et par paire. Le compteur est
    // atomique : deux tours simultanés ne peuvent pas dépasser le plafond à
    // eux deux.
    const plafond = plafonds.get(row.organization_id) ?? (await plafondEnrichissement(pool, row.organization_id));
    plafonds.set(row.organization_id, plafond);
    const credit = await pool.query<{ ok: boolean }>(
      `select app.consume_provider_credit($1, 'fullenrich', $2, 1) as ok`,
      [row.organization_id, plafond],
    );
    if (credit.rows[0]?.ok !== true) {
      console.warn(
        `[enrich] plafond quotidien atteint pour l'organisation ${row.organization_id} — ${res.rows.length - enqueued} paire(s) reportée(s)`,
      );
      break;
    }
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
          sourceSignalId: row.source_signal_id,
        },
      },
    ]);
    enqueued += 1;
  }
  return enqueued;
}

/**
 * Inscrit en campagne les contacts enrichis qui n'y sont pas encore.
 *
 * C'était le maillon manquant. La file `sequence.enroll` était déclarée, le
 * worker s'y abonnait, son traitement était écrit — et personne n'y déposait
 * jamais de job. Un signal était collecté, qualifié, scoré, enrichi, puis
 * s'arrêtait là. C'est l'unique raison pour laquelle la chaîne ne produisait
 * rien.
 *
 * Le chemin va du contact à la campagne : son signal d'origine donne le thème
 * de veille, le thème donne les campagnes qui s'en nourrissent, et parmi
 * elles on retient celle qui accepte sa persona.
 *
 * Trois refus délibérés :
 *
 *  - **Une campagne qui ne déclare aucune persona n'inscrit personne.** Une
 *    règle d'entrée vide se lit comme « accepte tout le monde », et une
 *    campagne d'essai aspirerait alors chaque contact enrichi de
 *    l'organisation. L'inscription engage des envois réels : on demande donc
 *    que la cible ait été dite.
 *  - **Un contact sans persona n'est pas inscrit.** On ne saurait pas quel
 *    message lui adresser.
 *  - **Le score minimum de la campagne est enfin lu.** Il était enregistré
 *    depuis l'éditeur et n'avait aucun lecteur : une campagne exigeant 60
 *    inscrivait à 12 sans que rien ne le signale.
 *
 * L'identifiant de job est déterministe par (campagne, contact) : un passage
 * répété du producteur ne réinscrit pas le même contact, et l'index partiel
 * d'`enrollments` refuse de toute façon une seconde inscription vivante.
 */
export async function enqueueEnrollments(
  boss: PgBoss,
  pool: Pool,
  opts: { limit?: number } = {},
): Promise<number> {
  const limit = opts.limit ?? 50;
  const res = await pool.query<{
    organization_id: string;
    campaign_id: string;
    contact_id: string;
    signal_id: string;
  }>(
    `select distinct on (ct.id)
            ct.organization_id, c.id as campaign_id, ct.id as contact_id, s.id as signal_id
       from contacts ct
       join signals s on s.id = ct.source_signal_id
       join campaigns c on c.organization_id = ct.organization_id
        and c.status = 'active'
       -- Le thème peut être rattaché de deux façons : directement sur la
       -- campagne, ou par la table de liaison quand elle en sert plusieurs.
        and (c.source_id = s.source_id
             or exists (select 1 from campaign_sources cs
                         where cs.campaign_id = c.id and cs.source_id = s.source_id))
       -- La persona du contact doit être explicitement acceptée.
        and ct.persona_id is not null
        and c.entry_rules -> 'personas' ? ct.persona_id::text
       -- Score minimum de la campagne, absent = aucune exigence.
        and coalesce(s.score, 0) >= coalesce((c.entry_rules ->> 'min_score')::int, 0)
      where ct.source_signal_id is not null
        and not exists (
          select 1 from enrollments e
           where e.contact_id = ct.id
             and e.status in ('active', 'paused', 'paused_absence')
        )
      order by ct.id, s.score desc nulls last, c.created_at
      limit $1`,
    [limit],
  );

  let enqueued = 0;
  for (const row of res.rows) {
    await boss.insert([
      {
        name: 'sequence.enroll',
        id: deterministicUuid('enroll', row.campaign_id, row.contact_id),
        data: {
          organizationId: row.organization_id,
          campaignId: row.campaign_id,
          contactId: row.contact_id,
          signalId: row.signal_id,
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
 * Un thème sans mots-clés voit sa demande effacée sans job : il n'a rien à
 * chercher, et laisser la demande en place la ferait relever à chaque cycle.
 * Un thème sans fournisseur actif non plus, pour la même raison.
 *
 * Demander une collecte sur un thème la demande chez tous ses fournisseurs :
 * c'est la veille qu'on relance, pas un connecteur en particulier.
 */
export async function enqueueRequestedRuns(boss: PgBoss, pool: Pool): Promise<number> {
  // `returning` sous le UPDATE : la demande est consommée et lue d'un seul geste,
  // donc deux workers ne peuvent pas enfiler la même collecte.
  const demandes = await pool.query<{ id: string; organization_id: string; config: SourceRow['config'] }>(
    `update sources
        set run_requested_at = null
      where run_requested_at is not null
      returning id, organization_id, config`,
  );

  let enqueued = 0;
  for (const src of demandes.rows) {
    const config = src.config ?? {};
    const keywords = Array.isArray(config.keywords) ? config.keywords.map((k) => String(k)).filter(Boolean) : [];
    if (keywords.length === 0) {
      console.warn(`[producer] collecte demandée pour le thème ${src.id} sans mots-clés — ignorée`);
      continue;
    }
    const rattachements = await pool.query<{ id: string; provider_id: string }>(
      `select id, provider_id from source_providers where source_id = $1 and is_active = true`,
      [src.id],
    );
    if (rattachements.rowCount === 0) {
      console.warn(`[producer] collecte demandée pour le thème ${src.id} sans fournisseur actif — ignorée`);
      continue;
    }
    for (const rattachement of rattachements.rows) {
      const job: DiscoverJob = {
        organizationId: src.organization_id,
        sourceId: src.id,
        provider: rattachement.provider_id,
        sourceProviderId: rattachement.id,
        keywords,
        ...(typeof config.location === 'string' && config.location ? { location: config.location } : {}),
      };
      await boss.send('sources.discover', job);
      enqueued += 1;
    }
  }
  return enqueued;
}
