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
import { bornerParCampagne, normaliserPlafond, placesRestantes, plafondDuJour, fuseauDeLOrganisation, jourCourantDansFuseau } from '@jay-reach/core';
import type { DiscoverJob } from './handlers/discover.js';
// Type seul : aucune de ces deux importations ne charge `puppeteer-core`.
import type { CollecteLinkedInJob } from './handlers/collecte-linkedin.js';
import { compterEntreesDuJour } from './handlers/sequence.js';
import { startSourceRun } from './db.js';
import { deterministicUuid } from './ids.js';
import { ecarterEngageur, lienProfilDeduit } from './handlers/post-engagement.js';

interface SourceRow {
  readonly id: string;
  readonly organization_id: string;
  readonly provider_id: string;
  /** Identifiant du rattachement (thème, fournisseur), pour tracer l'exécution. */
  readonly source_provider_id: string;
  readonly config: { keywords?: unknown; location?: unknown; ageMaxJours?: unknown; sourceType?: unknown } | null;
}

/** Le seul type LinkedIn que le worker sait exécuter au lot 4a. Les trois autres arrivent au 4b. */
const TYPE_LINKEDIN_EXECUTABLE = 'linkedin_post_engagers';

/**
 * Enfile une collecte LinkedIn demandée à la main. Rien d'autre ne l'enfile :
 * le chemin périodique les exclut explicitement.
 *
 * Le passage (`source_runs`) est ouvert ICI, avant le job, parce que sa charge
 * utile le porte : tout ce que le passage apprendra (requêtes émises, personnes
 * vues, écarts du scoring plus tard) s'y rattache. Si le job n'est jamais
 * exécuté — worker tué entre les deux — la ligne reste `running` et
 * `closeStaleSourceRuns` la referme en `error` au bout de trente minutes.
 */
async function enfilerCollecteLinkedIn(
  boss: PgBoss,
  pool: Pool,
  src: { id: string; organization_id: string },
  type: string,
): Promise<number> {
  if (type !== TYPE_LINKEDIN_EXECUTABLE) {
    console.warn(`[producer] collecte demandée pour la source ${src.id} : type LinkedIn pas encore exécutable — ignorée`);
    return 0;
  }
  const sourceRunId = await startSourceRun(pool, src.id);
  const job: CollecteLinkedInJob = {
    organizationId: src.organization_id,
    sourceId: src.id,
    sourceRunId,
  };
  await boss.send('linkedin.collecte', job);
  return 1;
}

const AGE_MAX_SIGNAL_JOURS_PAR_DEFAUT = 14;

/** Une valeur invalide de `SIGNAL_MAX_AGE_DAYS` retombe sur quatorze jours plutôt que de casser le cycle de production. */
function lireAgeMaxSignalJours(): number {
  const brut = process.env.SIGNAL_MAX_AGE_DAYS;
  if (brut === undefined || brut.trim() === '') return AGE_MAX_SIGNAL_JOURS_PAR_DEFAUT;
  const valeur = Number(brut);
  if (Number.isFinite(valeur) && valeur > 0) return Math.trunc(valeur);
  console.warn(`[producer] SIGNAL_MAX_AGE_DAYS invalide (« ${brut} »), repli sur ${AGE_MAX_SIGNAL_JOURS_PAR_DEFAUT} jours`);
  return AGE_MAX_SIGNAL_JOURS_PAR_DEFAUT;
}

/**
 * Au-delà de ce nombre de jours, un signal ne vaut plus ni scoring ni
 * enrichissement : la base contient des milliers de signaux de juillet et
 * août jamais traités, et les faire scorer coûterait du crédit IA pour rien.
 *
 * Coexiste avec le réglage `age_max_offres_jours` / `sources.config.ageMaxJours`
 * (I3, revue finale du 17/09, filtre appliqué par `insertSignals`,
 * `apps/worker/src/db.ts`) — les deux tombent souvent sur 14 jours par
 * défaut, mais ce n'est PAS le même mécanisme : celui-ci PURGE APRÈS COUP,
 * globalement pour toutes les organisations, un signal déjà en base et jamais
 * traité (variable d'environnement `SIGNAL_MAX_AGE_DAYS`, non réglable par
 * organisation) ; I3 ÉCARTE AVANT INSERTION, par organisation/source, une
 * offre trop vieille au moment même où le connecteur la remonte (réglable en
 * base, réglage par défaut de l'écran Plafonds). Une offre qui passe I3 (donc
 * insérée) peut donc encore être purgée plus tard par celui-ci si elle reste
 * `new`/`qualified` sans jamais être scorée ni enrichie.
 */
export const AGE_MAX_SIGNAL_JOURS = lireAgeMaxSignalJours();

/**
 * Multiple du délai d'ancienneté pendant lequel un engageur qualifié est épargné
 * par la purge parce que NOUS avons acheté l'email de son contact. La fenêtre se
 * compte depuis l'achat (`contacts.enriched_at`), pas depuis la collecte du
 * signal : sinon la marge réelle dépendrait du retard de la file d'enrichissement
 * — un contact enrichi au jour 25 à cause d'un plafond FullEnrich n'aurait plus
 * que trois jours, ce qui n'a aucun rapport avec ce qu'on protège.
 *
 * Pourquoi une borne, et pas « toujours » : un contact qui a un email mais
 * AUCUNE inscription n'a jamais été contacté, il n'a donc aucun historique
 * d'envoi à protéger. L'épargner sans limite, c'est garder indéfiniment le nom,
 * l'intitulé, l'adresse LinkedIn et l'email d'une personne réelle — exactement
 * la rétention sans fin que la purge existe pour fermer. Trois chemins
 * ordinaires produisent cet état (campagne qui n'est plus `active`, persona
 * retirée de `entry_rules -> 'personas'`, score du signal sous `min_score`) :
 * ce n'est pas un cas de bord.
 *
 * Pourquoi DEUX fois, et pas une : la fenêtre couvre une pause de campagne
 * ordinaire survenant APRÈS l'achat — l'opérateur met sa campagne en pause, la
 * reprend, et l'email payé est toujours là. Un seul délai ferait expirer l'achat
 * en même temps que le signal lui-même, donc sans marge du tout.
 *
 * Deux autres épargnes n'ont PAS de borne, et c'est voulu : l'INSCRIPTION (des
 * messages sont réellement partis) et l'email qui ne vient pas de nous
 * (`enriched_at is null` : liste importée, contact migré de la v1 — voir
 * `ecarterSignauxTropAnciens`).
 */
export const FACTEUR_EPARGNE_EMAIL = 2;

// Ecart global, toutes organisations confondues : la règle d'ancienneté est
// la même pour tout le monde et ne dépend d'aucun réglage d'organisation.
/** Ecarte les signaux trop anciens pour valoir un scoring ou un enrichissement. */
export async function ecarterSignauxTropAnciens(
  pool: Pool,
  maxJours: number,
): Promise<{ nouveaux: number; qualifies: number }> {
  if (!Number.isFinite(maxJours) || maxJours <= 0) return { nouveaux: 0, qualifies: 0 };
  // Une PERSONNE (`post_engagement`) ne passe jamais en `discarded` : son signal
  // et son contact s'effacent (rien de personnel sur ce qui ne sert pas), par le
  // même chemin que l'écart du scoring. Les deux mises à jour ci-dessous les
  // excluent donc : un engageur QUALIFIÉ ancien est effacé lui aussi, AVEC mémoire
  // (il a été jugé), sans quoi il garderait indéfiniment nom, intitulé et adresse.
  // Y échappent les contacts énumérés par les quatre branches ci-dessous : ceux
  // qui ont une inscription, ceux qui préexistaient à l'engageur, et ceux dont
  // l'email mérite encore d'être gardé. La mémoire est par couple post-personne :
  // elle ne l'empêche pas de revenir par un autre post.
  const personnes = await pool.query<{ id: string; organization_id: string }>(
    `select id, organization_id from signals
      where kind = 'post_engagement' and status = 'new' and score is null
        and occurred_at < now() - make_interval(days => $1)`,
    [maxJours],
  );
  for (const p of personnes.rows) await ecarterEngageur(pool, p.organization_id, p.id, { juge: false });
  const qualifiesPersonnes = await pool.query<{ id: string; organization_id: string }>(
    `select s.id, s.organization_id from signals s
      where s.kind = 'post_engagement' and s.status = 'qualified'
        and s.occurred_at < now() - make_interval(days => $1)
        and not exists (
          select 1 from contacts ct
           where ct.source_signal_id = s.id
             -- Déjà inscrit : épargné sans limite de temps, des messages sont partis.
             and (exists (select 1 from enrollments e where e.contact_id = ct.id)
                  -- Le contact est ANTÉRIEUR au signal qui lui sert d'origine : il
                  -- préexistait à l'engageur (liste importée, migration v1), et le
                  -- rattachement n'a fait que combler son origine vide. Cette ligne
                  -- n'est pas née de notre collecte, on ne l'efface pas — et
                  -- l'effacer emporterait son appartenance à la liste. Un contact
                  -- réellement créé par l'engageur est, lui, POSTÉRIEUR à son signal
                  -- (enregistrerEngageur insère le signal puis le contact).
                  or ct.created_at < s.occurred_at
                  -- Email que NOUS avons acheté : la fenêtre court depuis l'achat.
                  --
                  -- La condition sur l'email est celle que ce commentaire
                  -- énonçait déjà et que le code ne vérifiait pas : tant que
                  -- enriched_at n'était posé que par persistEnrichedContact,
                  -- qui refuse un contact sans email, les deux étaient
                  -- équivalents. Ils ne le sont plus : l'enrichissement d'un
                  -- contact connu (tâche 8) pose aussi enriched_at quand
                  -- FullEnrich n'a RIEN trouvé, pour ne pas racheter la même
                  -- personne tous les jours. Sans cette condition, cette marque
                  -- épargnerait de la purge le nom, l'intitulé et l'adresse
                  -- LinkedIn d'une personne pour qui on n'a obtenu aucune
                  -- adresse — exactement la rétention sans fin que la purge
                  -- existe pour fermer.
                  or (ct.email is not null and ct.enriched_at is not null
                      and ct.enriched_at >= now() - make_interval(days => $2))
                  -- Email qui ne vient pas de notre enrichissement : il a été fourni
                  -- par l'opérateur, sa rétention lui appartient, pas à la purge.
                  --
                  -- DÉFENSE EN PROFONDEUR DÉLIBÉRÉE, ET NON PROUVÉE. Mesuré le
                  -- 06/10/2026 : aucun chemin de production ne produit son état
                  -- ISOLÉMENT, et la retirer ne fait rougir aucun contrôle du
                  -- harnais. Les deux chemins qui donnent un email sans
                  -- enriched_at sont déjà couverts ailleurs : l'import de fichier
                  -- inscrit systématiquement (première branche), et la migration
                  -- des données v1 crée des fiches antérieures au signal (deuxième
                  -- branche). Ce n'est donc PAS du code mort, et ce n'est pas non
                  -- plus du code prouvé.
                  --
                  -- Gardée quand même, pour l'asymétrie : ce qu'elle protège est un
                  -- effacement IRRÉVERSIBLE de données que l'opérateur a fournies.
                  -- La garder à tort conserve quelques lignes trop longtemps ; la
                  -- retirer à tort détruit définitivement. Et sa redondance tient à
                  -- un détail qui peut changer sans qu'on y pense : le jour où
                  -- l'import n'inscrira plus systématiquement, elle redevient la
                  -- seule protection.
                  or (ct.email is not null and ct.enriched_at is null)))`,
    [maxJours, maxJours * FACTEUR_EPARGNE_EMAIL],
  );
  // `compter: false` : la personne est jugée (donc mémorisée), mais le passage qui
  // l'a collectée est clos depuis des semaines — son compteur d'écarts ne doit pas
  // bouger rétroactivement, sinon le rendement comparé des sources est faussé.
  for (const p of qualifiesPersonnes.rows)
    await ecarterEngageur(pool, p.organization_id, p.id, { juge: true, compter: false });
  const nouveaux = await pool.query(
    `update signals
        set status = 'discarded', discard_reason = 'stale', scored_at = coalesce(scored_at, now())
      where status = 'new' and score is null and kind <> 'post_engagement'
        and occurred_at < now() - make_interval(days => $1)`,
    [maxJours],
  );
  // Un signal qualifie attend l'enrichissement tant que son compte n'a pas
  // `enriched_at` (critere de `enqueueEnrichmentForQualified`).
  const qualifies = await pool.query(
    `update signals s
        set status = 'discarded', discard_reason = 'stale_unenriched'
      where s.status = 'qualified' and s.kind <> 'post_engagement'
        and s.occurred_at < now() - make_interval(days => $1)
        and not exists (select 1 from accounts a where a.id = s.account_id and a.enriched_at is not null)`,
    [maxJours],
  );
  return { nouveaux: (nouveaux.rowCount ?? 0) + personnes.rows.length, qualifies: (qualifies.rowCount ?? 0) + qualifiesPersonnes.rows.length };
}

export async function enqueueDiscoverForActiveSources(
  boss: PgBoss,
  pool: Pool,
  opts: { bucket?: string } = {},
): Promise<number> {
  const bucket = opts.bucket ?? 'once';
  // R72 : une source rattachée à AUCUNE campagne active ne tourne pas, même
  // active elle-même — une campagne encore en brouillon (ou en pause/archivée)
  // ne doit produire aucune collecte. Une source liée à plusieurs campagnes
  // dont une seule active reste due (l'`exists` évite de la dupliquer).
  const res = await pool.query<SourceRow>(
    `select s.id, s.organization_id, sp.provider_id, sp.id as source_provider_id, s.config
       from sources s
       join source_providers sp on sp.source_id = s.id
      where s.is_active = true and sp.is_active = true
        -- Les sources LinkedIn ne passent JAMAIS par la planification : ce tour
        -- revient toutes les quinze minutes, soit quatre-vingt-seize passages
        -- par jour pour un plafond de trois. Elles partent a la demande
        -- (enqueueRequestedRuns) et par la seulement. Aujourd hui la jointure
        -- sur source_providers les ecarterait deja, faute de rattachement, mais
        -- cette exclusion est DELIBEREE : elle doit survivre au jour ou cette
        -- jointure deviendra un left join.
        and coalesce(s.config->>'sourceType', '') not like 'linkedin%'
        and exists (
          select 1 from campaign_sources cs
            join campaigns c on c.id = cs.campaign_id
           where cs.source_id = s.id and c.status = 'active'
        )`,
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
      ...(typeof config.ageMaxJours === 'number' ? { ageMaxJours: config.ageMaxJours } : {}),
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
 *
 * R83 (relecture tâche 21) : ce plafond passait par `lirePlafondFournisseur`
 * ci-dessous, qui lit `credentials.config.daily_cap` en ignorant complètement
 * `organization_settings` — le réglage que pose l'écran Réglages › Plafonds.
 * Un opérateur qui y changeait « Enrichissements par jour » ne voyait donc
 * JAMAIS son changement appliqué par le moteur. `plafondDuJour`
 * (`@jay-reach/core`) est désormais l'unique source : `organization_settings`
 * d'abord, `credentials.config.daily_cap` en repli historique, puis
 * l'environnement, puis un défaut — la même chaîne que l'écran.
 */
async function plafondEnrichissement(pool: Pool, organizationId: string): Promise<number> {
  return plafondDuJour(pool, organizationId, 'enrichissements_par_jour');
}

/**
 * Plafond de l'organisation, tel qu'elle l'a saisi dans l'écran Fournisseurs —
 * pour un fournisseur SANS équivalent dans `organization_settings` (SalesBlink :
 * son plafond d'envoi n'est pas un plafond d'organisation, cf.
 * `apps/worker/src/handlers/email-salesblink.ts`). Pour `anthropic` et
 * `fullenrich`, qui ONT une clé `organization_settings`, utiliser `plafondDuJour`
 * (`@jay-reach/core`) à la place — celui-ci lit `organization_settings` en
 * premier, ce que cette fonction ne fait pas.
 */
export async function lirePlafondFournisseur(
  pool: Pool,
  organizationId: string,
  providerId: string,
  defaut: number,
): Promise<number> {
  const res = await pool.query<{ daily_cap: string | null }>(
    `select config ->> 'daily_cap' as daily_cap
       from credentials
      where organization_id = $1 and provider_id = $2
      limit 1`,
    [organizationId, providerId],
  );
  return normaliserPlafond(res.rows[0]?.daily_cap, defaut);
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
              s.id as source_signal_id, s.score, s.occurred_at
         from signals s
         join accounts a on a.id = s.account_id
         join personas p on p.organization_id = a.organization_id
        where s.status = 'qualified'
          and a.enriched_at is null
          and p.is_active
          and array_length(p.title_patterns, 1) > 0
          and s.occurred_at >= now() - make_interval(days => $2)
        order by a.id, p.id, s.occurred_at desc, s.id
     )
     select organization_id, account_id, company_name, domain, country,
            persona_id, title_patterns, source_signal_id
       from candidats
      order by occurred_at desc, score desc nulls last, account_id
      limit $1`,
    [limit, AGE_MAX_SIGNAL_JOURS],
  );

  let enqueued = 0;
  // Un plafond par organisation, lu une seule fois pour tout le lot.
  const plafonds = new Map<string, number>();
  // #118 (tour de correction 5) : le jour du crédit consommé doit être celui de
  // l'ORGANISATION, pas `current_date` (le fuseau du serveur, UTC) — un
  // fuseau par organisation, lu une seule fois pour tout le lot (même motif
  // que `plafonds` ci-dessus).
  const jours = new Map<string, string>();
  for (const row of res.rows) {
    // Un job déjà en file ne se paie pas deux fois.
    //
    // L'identifiant est déterministe par (compte, persona) : redéposer le même
    // ne crée rien. Mais le crédit, lui, était pris avant l'insertion — donc
    // décompté pour un job qui n'existera pas. Mesuré sur la base le
    // 02/09/2026 : cinq crédits consommés dans la journée pour deux jobs
    // réellement créés. Trois brûlés sur des doublons, sans qu'aucun appel ne
    // parte chez le fournisseur.
    const idJob = deterministicUuid('enrich-company', row.account_id, row.persona_id);
    const dejaEnFile = await pool.query<{ existe: boolean }>(
      `select exists (select 1 from pgboss.job where id = $1::uuid
                       and state in ('created','retry','active')) as existe`,
      [idJob],
    );
    if (dejaEnFile.rows[0]?.existe) {
      continue;
    }

    // Le crédit se prend ensuite, mais TOUJOURS avant l'insertion : le compteur
    // est atomique, et deux tours simultanés ne peuvent pas dépasser le plafond
    // à eux deux. L'ordre inverse laisserait passer un dépassement.
    const plafond = plafonds.get(row.organization_id) ?? (await plafondEnrichissement(pool, row.organization_id));
    plafonds.set(row.organization_id, plafond);
    let jour = jours.get(row.organization_id);
    if (!jour) {
      jour = jourCourantDansFuseau(await fuseauDeLOrganisation(pool, row.organization_id));
      jours.set(row.organization_id, jour);
    }
    const credit = await pool.query<{ ok: boolean }>(
      `select app.consume_provider_credit($1, 'fullenrich', $2, 1, $3::date) as ok`,
      [row.organization_id, plafond, jour],
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
        id: idJob,
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
 * Enfile l'achat d'une adresse pour les personnes DÉJÀ identifiées : un engageur
 * de post LinkedIn, qualifié par le scoring, qui n'a pas encore d'email.
 *
 * C'est le maillon qui manquait entre la qualification d'une personne et son
 * enrichissement. `enqueueEnrichmentForQualified` ci-dessus part des `accounts`,
 * et un engageur n'en a pas : son contact serait resté sans adresse pour
 * toujours, et le handler qui sait l'acheter n'aurait jamais été appelé.
 *
 * Le crédit N'EST PAS pris ici, contrairement au chemin entreprise : un job par
 * contact, donc le handler est le seul à savoir s'il va réellement appeler
 * FullEnrich (il peut encore refuser, cf. `raisonDeNePasAcheter`). Le décompter
 * ici le brûlerait pour des appels qui ne partent pas.
 *
 * Trois filtres, trois raisons :
 *  - `enriched_at is null` : l'achat a été TENTÉ, abouti ou non. Sans ce filtre,
 *    une personne pour qui FullEnrich n'a rien trouvé serait rachetée à chaque
 *    tour, indéfiniment.
 *  - `email is null` : rien à acheter si on a déjà l'adresse.
 *  - adresse de profil non FABRIQUÉE : voir `raisonDeNePasAcheter`. Le handler
 *    refuserait de toute façon, mais ces contacts sont le cas MAJORITAIRE tant
 *    que la collecte ne lit pas l'identifiant public — ils rempliraient le lot
 *    et affameraient les contacts réellement payables. La forme de l'adresse
 *    vient de `lienProfilDeduit` elle-même, et non d'un préfixe recopié ici :
 *    appelée sur une chaîne vide, elle rend exactement ce préfixe.
 *
 * Plus récents d'abord : un signal frais vaut mieux qu'un signal de la semaine
 * dernière quand le plafond ne permet pas de tout prendre.
 */
export async function enqueueEnrichmentContactsConnus(
  boss: PgBoss,
  pool: Pool,
  opts: { limit?: number } = {},
): Promise<number> {
  const limit = opts.limit ?? 25;
  const res = await pool.query<{ organization_id: string; contact_id: string }>(
    `select c.organization_id, c.id as contact_id
       from contacts c
       join signals s
         on s.id = c.source_signal_id and s.organization_id = c.organization_id
      where c.email is null
        and c.enriched_at is null
        and c.linkedin_url is not null
        and s.status = 'qualified'
        and (c.linkedin_provider_id is null or c.linkedin_url <> $2 || c.linkedin_provider_id)
      order by s.occurred_at desc nulls last, c.created_at desc, c.id
      limit $1`,
    [limit, lienProfilDeduit('')],
  );

  let enqueued = 0;
  // Un fuseau par organisation, lu une seule fois pour tout le lot : il borne la
  // journée de l'identifiant de job ci-dessous.
  const jours = new Map<string, string>();
  for (const row of res.rows) {
    let jour = jours.get(row.organization_id);
    if (!jour) {
      jour = jourCourantDansFuseau(await fuseauDeLOrganisation(pool, row.organization_id));
      jours.set(row.organization_id, jour);
    }
    // L'identifiant porte le JOUR : redéposer le même contact dans la même
    // journée ne crée rien, mais un contact resté sans suite (plafond atteint,
    // panne du fournisseur) repart demain sous un identifiant neuf. Sans le
    // jour, il ne repartirait jamais.
    await boss.insert([
      {
        name: 'enrichment.contact_connu',
        id: deterministicUuid('enrich-contact-connu', row.contact_id, jour),
        data: { organizationId: row.organization_id, contactId: row.contact_id },
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
 * L'identifiant de job est déterministe par (campagne, contact, jour UTC) : un
 * passage répété du producteur le même jour ne réinscrit pas le même contact.
 * Le jour fait partie de la clé pour qu'un contact reporté par le plafond de
 * la campagne (`handlers/sequence.ts`, `enrollContact`) revienne le
 * lendemain avec un nouveau job, plutôt que de rester coincé derrière le
 * même identifiant jusqu'à l'archivage pg-boss (douze heures après un job
 * terminé) ; l'index partiel d'`enrollments` refuse de toute façon une
 * seconde inscription vivante.
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
       -- Un engageur naît SANS email : l'inscrire maintenant brûlerait une place du
       -- plafond du jour et le tick l'arrêterait (not_sendable), puis l'email
       -- arrivé plus tard relancerait une seconde inscription. Restreint à ce kind
       -- par construction : le chemin des offres d'emploi n'est pas touché.
        and not (s.kind = 'post_engagement' and ct.email is null)
       -- Score minimum de la campagne, absent = aucune exigence.
        and coalesce(s.score, 0) >= coalesce((c.entry_rules ->> 'min_score')::int, 0)
       -- Fuseau de l'organisation de CETTE campagne (revue F5, point 1, tour de
       -- correction 2), pour le pré-filtre ci-dessous : cette requête mélange
       -- potentiellement plusieurs organisations en un seul passage, contrairement
       -- à compterEntreesDuJour (organisation connue par son appelant) -- jointure
       -- plutôt qu'un paramètre JS, même repli (clé absente/vide -> Europe/Paris)
       -- que fuseauDeLOrganisation.
       left join organization_settings ofz on ofz.organization_id = c.organization_id and ofz.key = 'fuseau'
      where ct.source_signal_id is not null
       -- Pré-filtre : une campagne dont le plafond du jour est déjà atteint
       -- n'a rien à proposer ici (contrôle autoritaire refait dans enrollContact).
       -- Jour de l'organisation, pas celui du serveur (revue F5, point 1, tour 2) :
       -- même borne que compterEntreesDuJour, qui refait le contrôle autoritaire.
       -- Relecture : cette requête balaie TOUTES les organisations d'un coup --
       -- un fuseau invalide sur UNE SEULE ligne (schemaEcrireReglage le refuse
       -- désormais à l'écriture, mais une ligne déjà fausse en base reste
       -- possible) ferait échouer « invalid time zone » pour tout le monde.
       -- Vérifié contre pg_timezone_names, repli sur Europe/Paris sinon --
       -- une valeur absente ou invalide ne matche simplement aucune ligne.
        and (c.daily_cap is null
             or c.daily_cap > (select count(*) from enrollments e2
                                 where e2.campaign_id = c.id
                                   and e2.started_at >= date_trunc('day', now() at time zone coalesce((select tz.name from pg_timezone_names tz where tz.name = ofz.value #>> '{}'), 'Europe/Paris'))
                                                        at time zone coalesce((select tz.name from pg_timezone_names tz where tz.name = ofz.value #>> '{}'), 'Europe/Paris')))
        and not exists (
          select 1 from enrollments e
           where e.contact_id = ct.id
             and e.status in ('active', 'paused', 'paused_absence')
        )
      order by ct.id, s.score desc nulls last, c.created_at
      limit $1`,
    [limit],
  );

  const ids = [...new Set(res.rows.map((r) => r.campaign_id))];
  // Une campagne appartient à une seule organisation : `res.rows` en porte déjà
  // l'id, pas besoin de la relire (revue F5, point 1, tour de correction 2 —
  // `compterEntreesDuJour` en a besoin pour son propre fuseau).
  const orgParCampagne = new Map(res.rows.map((r) => [r.campaign_id, r.organization_id]));
  const places = new Map<string, number | null>();
  if (ids.length > 0) {
    const caps = await pool.query<{ id: string; daily_cap: number | null }>(
      `select id, daily_cap from campaigns where id = any($1::uuid[])`,
      [ids],
    );
    for (const c of caps.rows) {
      places.set(
        c.id,
        c.daily_cap === null ? null : placesRestantes(c.daily_cap, await compterEntreesDuJour(pool, c.id, orgParCampagne.get(c.id)!)),
      );
    }
  }
  const { retenues, reportees } = bornerParCampagne(res.rows, places);
  for (const [campaignId, n] of reportees) {
    console.log(`[enroll] campagne ${campaignId} : ${n} contact(s) reportes au lendemain, plafond du jour atteint`);
  }

  // Le jour UTC fait partie de la clé d'idempotence : sans lui, un contact
  // reporté hier par le plafond de la campagne (job terminé sans inscrire,
  // cf. `enrollContact`) ne reviendrait qu'à l'archivage pg-boss du job
  // précédent (douze heures), jamais au reset du plafond à minuit.
  const jourUtc = new Date().toISOString().slice(0, 10);
  let enqueued = 0;
  for (const row of retenues) {
    await boss.insert([
      {
        name: 'sequence.enroll',
        id: deterministicUuid('enroll', row.campaign_id, row.contact_id, jourUtc),
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
 *
 * R72 : un passage demandé à la main obéit à la même règle que la
 * planification périodique — aucune campagne rattachée active, aucune
 * collecte. La demande est quand même consommée (`run_requested_at` remis à
 * `null`) pour ne pas relever indéfiniment la même demande orpheline ; seule
 * une ligne de journal courte le dit, sans nom ni config de la source.
 */
export async function enqueueRequestedRuns(boss: PgBoss, pool: Pool): Promise<number> {
  // `returning` sous le UPDATE : la demande est consommée et lue d'un seul geste,
  // donc deux workers ne peuvent pas enfiler la même collecte.
  const demandes = await pool.query<{
    id: string;
    organization_id: string;
    config: SourceRow['config'];
    has_active_campaign: boolean;
  }>(
    `update sources s
        set run_requested_at = null
      where run_requested_at is not null
      returning id, organization_id, config,
        exists (
          select 1 from campaign_sources cs
            join campaigns c on c.id = cs.campaign_id
           where cs.source_id = s.id and c.status = 'active'
        ) as has_active_campaign`,
  );

  let enqueued = 0;
  for (const src of demandes.rows) {
    if (!src.has_active_campaign) {
      console.warn(`[producer] passage demandé ignoré : aucune campagne active`);
      continue;
    }
    const config = src.config ?? {};
    // Une source LinkedIn n'a ni `source_providers` ni `keywords` : elle tombait
    // dans les deux `continue` ci-dessous, et le bouton « Lancer la collecte »
    // ne faisait rien. Elle part par sa propre file.
    const type = typeof config.sourceType === 'string' ? config.sourceType : '';
    if (type.startsWith('linkedin')) {
      enqueued += await enfilerCollecteLinkedIn(boss, pool, src, type);
      continue;
    }
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
        ...(typeof config.ageMaxJours === 'number' ? { ageMaxJours: config.ageMaxJours } : {}),
      };
      await boss.send('sources.discover', job);
      enqueued += 1;
    }
  }
  return enqueued;
}
