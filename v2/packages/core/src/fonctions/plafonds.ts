/**
 * Réglages et plafonds de l'organisation (spec lot 2 §7) : une ligne par clé
 * dans `organization_settings`, avec repli sur l'environnement puis un défaut
 * en dur — décision JB du 10/09 : tout plafond se règle dans l'app, rien de
 * figé, l'environnement ne sert que de repli pour une instance qui n'a rien
 * saisi.
 *
 * Les noms d'environnement de repli du scoring et de l'enrichissement
 * (`SCORE_DAILY_CAP`, `ENRICH_DAILY_CAP`) sont ceux déjà lus par le moteur
 * (`apps/worker/src/producer.ts`) : une même variable pilote les deux, qu'elle
 * soit consultée depuis le worker ou depuis cette couche fonctions.
 *
 * R83 (relecture tâche 21) : `scoring_par_jour` et `enrichissements_par_jour`
 * sont les deux SEULES clés à porter un second repli historique —
 * `credentials.config.daily_cap` du fournisseur associé (`anthropic`,
 * `fullenrich`), l'ancien réglage v1 — et `plafondDuJour` ci-dessous en est
 * désormais l'UNIQUE implémentation, utilisée aussi bien par le worker
 * (`apps/worker/src/producer.ts`, `traitements.ts`, avec un `Pool` pg brut,
 * sans `Contexte`) que par cette couche. Avant ce correctif, le worker lisait
 * `credentials.config.daily_cap` directement (`lirePlafondFournisseur`),
 * IGNORANT `organization_settings` : un plafond réglé dans l'écran Plafonds
 * n'était jamais appliqué par le moteur, qui continuait sur l'ancienne valeur
 * (ou le défaut). Une seule fonction, un seul chemin de lecture, pour que la
 * valeur affichée soit toujours celle appliquée.
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider } from './contexte.js';
import { normaliserPlafond } from '../plafonds.js';
import type { Executeur } from '../executeur.js';

export type ClePlafond =
  | 'scoring_par_jour'
  | 'enrichissements_par_jour'
  | 'age_max_offres_jours'
  | 'score_min_defaut'
  | 'relecture_premiers_envois_defaut'
  | 'fuseau';

const CLE_PLAFOND_VALUES = [
  'scoring_par_jour',
  'enrichissements_par_jour',
  'age_max_offres_jours',
  'score_min_defaut',
  'relecture_premiers_envois_defaut',
  'fuseau',
] as const satisfies readonly ClePlafond[];

export const CLES_REGLAGES: readonly { cle: ClePlafond; defaut: number | string; env?: string }[] = [
  { cle: 'scoring_par_jour', defaut: 300, env: 'SCORE_DAILY_CAP' },
  { cle: 'enrichissements_par_jour', defaut: 30, env: 'ENRICH_DAILY_CAP' },
  { cle: 'age_max_offres_jours', defaut: 14 },
  { cle: 'score_min_defaut', defaut: 70 },
  { cle: 'relecture_premiers_envois_defaut', defaut: 0 },
  { cle: 'fuseau', defaut: 'Europe/Paris' },
];

/**
 * Jour calendaire (AAAA-MM-JJ) d'un instant DANS un fuseau donné — copie locale
 * volontaire du même utilitaire d'une ligne que `campagnes.ts`/`sources.ts`
 * (`jourDansFuseau`, mêmes commentaires : pas de couplage cross-fichier pour un
 * utilitaire de cette taille). Exportée ici (contrairement aux deux autres,
 * qui restent privées à leur fichier) : le worker (`traitements.ts`,
 * `producer.ts`) en a besoin pour poser `usage_date` dans le fuseau de
 * l'organisation (#118), et n'a qu'un `Pool` brut, jamais les deux autres
 * copies qui vivent dans `packages/core/src/fonctions`.
 */
export function jourCourantDansFuseau(fuseau: string, maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(maintenant);
}

/**
 * Fuseau de l'organisation (`organization_settings.fuseau`), pour un appelant
 * qui n'a qu'un `Executeur`/`Pool` brut et pas besoin des cinq autres réglages
 * (#118) : le worker, qui consomme le crédit `provider_daily_usage` en dehors
 * de tout `Contexte`. Même repli que `lireReglages` pour cette seule clé
 * (`valeurTexteValide` puis le défaut de `CLES_REGLAGES`) — pas de repli
 * d'environnement pour `fuseau`, elle n'en a jamais eu.
 */
export async function fuseauDeLOrganisation(ex: Executeur, organisationId: string): Promise<string> {
  const res = await ex.query<{ value: unknown }>(
    `select value from organization_settings where organization_id = $1 and key = 'fuseau'`,
    [organisationId],
  );
  const defaut = CLES_REGLAGES.find((d) => d.cle === 'fuseau')!.defaut as string;
  return valeurTexteValide(res.rows[0]?.value) ?? defaut;
}

/** Type attendu pour la `valeur` de chaque clé, dérivé du type de son défaut — sert au schéma d'écriture ci-dessous. */
const TYPE_ATTENDU_PAR_CLE: Record<ClePlafond, 'number' | 'string'> = Object.fromEntries(
  CLES_REGLAGES.map(({ cle, defaut }) => [cle, typeof defaut === 'number' ? 'number' : 'string']),
) as Record<ClePlafond, 'number' | 'string'>;

/**
 * Une valeur jsonb lue en base qui n'est pas du type attendu pour sa clé (mauvais type stocké,
 * corruption, ligne posée par un ancien format) doit être traitée comme ABSENTE — jamais coercée en
 * `NaN` ou en `[object Object]`. Une chaîne numérique reste acceptée pour une clé numérique : c'est le
 * format que l'écran envoie (`schemaEcrireReglage` accepte aussi les chaînes, cf. plus bas).
 */
function valeurNumeriqueValide(brut: unknown): number | null {
  if (typeof brut === 'number' && Number.isFinite(brut)) return brut;
  if (typeof brut === 'string' && brut.trim() !== '') {
    const n = Number(brut.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function valeurTexteValide(brut: unknown): string | null {
  return typeof brut === 'string' && brut.trim() !== '' ? brut : null;
}

/**
 * Fournisseur associé à une clé de plafond, pour son repli historique
 * `credentials.config.daily_cap` (R78, généralisé R83) — seules ces deux clés
 * en ont un : les trois autres clés numériques (`age_max_offres_jours`,
 * `score_min_defaut`, `relecture_premiers_envois_defaut`) n'ont jamais existé
 * ailleurs que dans `organization_settings`, aucun repli credentials n'a de
 * sens pour elles.
 */
const PROVIDER_REPLI_CREDENTIALS: Partial<Record<ClePlafond, string>> = {
  scoring_par_jour: 'anthropic',
  enrichissements_par_jour: 'fullenrich',
};

/**
 * Résout la valeur d'UNE clé numérique à partir de sa valeur brute déjà lue
 * en base (`undefined`/invalide si absente) : `organization_settings` →
 * `credentials.config.daily_cap` du fournisseur associé (repli historique,
 * seulement si `PROVIDER_REPLI_CREDENTIALS` en connaît un pour cette clé) →
 * variable d'environnement → défaut en dur.
 *
 * Partagée par `lireReglages` (qui a déjà TOUTES les valeurs brutes en main
 * via une lecture groupée d'`organization_settings`, une seule requête pour
 * les six clés) et par `plafondDuJour` (une clé à la fois, sa propre lecture
 * ciblée) — la MÊME logique des deux côtés : avant R83, le worker avait sa
 * propre implémentation (`lirePlafondFournisseur`, `apps/worker/src/producer.ts`)
 * qui lisait `credentials.config.daily_cap` directement et ignorait
 * complètement `organization_settings`, si bien qu'un plafond réglé dans
 * l'écran Plafonds n'était jamais appliqué par le moteur.
 */
async function resoudrePlafondNumerique(
  ex: Executeur,
  organisationId: string,
  cle: ClePlafond,
  brut: unknown,
  defaut: number,
  env: string | undefined,
): Promise<number> {
  const n = valeurNumeriqueValide(brut);
  if (n !== null) return n;

  const providerRepli = PROVIDER_REPLI_CREDENTIALS[cle];
  if (providerRepli) {
    const credRes = await ex.query<{ config: unknown }>(
      `select config from credentials /* jr:plafond_du_jour_credentials */
        where organization_id = $1 and provider_id = $2`,
      [organisationId, providerRepli],
    );
    const saisi = Number((credRes.rows[0]?.config as { daily_cap?: unknown } | null)?.daily_cap);
    if (Number.isFinite(saisi) && saisi >= 0) return saisi;
  }

  return env ? normaliserPlafond(process.env[env] ?? null, defaut) : defaut;
}

/** Lit les réglages de l'organisation : ligne en base en premier (si du bon type), sinon l'environnement (repli numérique), sinon le défaut. */
export async function lireReglages(ctx: Contexte): Promise<Record<ClePlafond, number | string>> {
  const res = await ctx.ex.query<{ key: string; value: unknown }>(
    `select key, value from organization_settings where organization_id = $1`,
    [ctx.organisationId],
  );
  const parCle = new Map(res.rows.map((r) => [r.key, r.value]));

  const sortie = {} as Record<ClePlafond, number | string>;
  for (const { cle, defaut, env } of CLES_REGLAGES) {
    const brut = parCle.get(cle);
    if (typeof defaut === 'number') {
      sortie[cle] = await resoudrePlafondNumerique(ctx.ex, ctx.organisationId, cle, brut, defaut, env);
      continue;
    }
    sortie[cle] = valeurTexteValide(brut) ?? defaut;
  }

  return sortie;
}

/**
 * Plafond numérique d'UNE clé — seule source de vérité (R83) pour tout
 * appelant qui n'a pas besoin des six réglages en même temps : le worker
 * (`apps/worker/src/producer.ts`, `traitements.ts`), qui n'a pas de `Contexte`
 * mais un `Pool` pg brut — `Executeur` n'est que sa forme structurelle
 * minimale, un `Pool` la respecte déjà.
 *
 * Même chaîne de repli que `lireReglages` (`resoudrePlafondNumerique`, code
 * partagé) : `organization_settings` → `credentials.config.daily_cap` du
 * fournisseur associé → environnement → défaut. AUCUN cache : chaque appel
 * relit la base, donc une valeur posée par `ecrireReglage` s'applique dès le
 * PROCHAIN appel — le prochain job de scoring ou d'enrichissement automatique
 * côté worker, immédiatement côté web.
 */
export async function plafondDuJour(ex: Executeur, organisationId: string, cle: ClePlafond): Promise<number> {
  const def = CLES_REGLAGES.find((d) => d.cle === cle);
  if (!def || typeof def.defaut !== 'number') {
    throw new Error(`« ${cle} » n'est pas un plafond numérique.`);
  }
  const res = await ex.query<{ value: unknown }>(
    `select value from organization_settings where organization_id = $1 and key = $2`,
    [organisationId, cle],
  );
  return resoudrePlafondNumerique(ex, organisationId, cle, res.rows[0]?.value, def.defaut, def.env);
}

/**
 * `true` si `valeur` est un identifiant de fuseau IANA que le moteur JS
 * reconnaît — le même format que celui attendu par Postgres (`at time zone`).
 * `Intl.DateTimeFormat` lève sur un identifiant inconnu (« Paris » plutôt que
 * « Europe/Paris ») ; construire le formateur suffit, pas besoin de l'utiliser.
 */
function fuseauValide(valeur: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: valeur });
    return true;
  } catch {
    return false;
  }
}

/**
 * La `valeur` doit correspondre au type attendu de la `cle` visée (un entier pour un plafond, une
 * chaîne non vide pour `fuseau`) — sinon `organization_settings` accumulerait des lignes du mauvais
 * type que `lireReglages` devrait ensuite écarter silencieusement.
 *
 * `fuseau` (revue F5, relecture) : une chaîne non vide ne suffit pas — « Paris » la satisferait
 * alors que ni `Intl.DateTimeFormat` ni Postgres (`at time zone`) ne le reconnaissent. Le risque
 * n'est pas seulement local : `enqueueEnrollments` (producer.ts) balaie TOUTES les organisations
 * en une seule requête et interpole ce fuseau dans un `at time zone` — une valeur invalide sur une
 * seule ligne y ferait échouer la requête entière (« invalid time zone »), bloquant les
 * inscriptions de toutes les organisations, pas seulement celle qui l'a saisie.
 */
export const schemaEcrireReglage = z
  .object({
    cle: z.enum(CLE_PLAFOND_VALUES),
    valeur: z.union([z.number().int().min(0), z.string().min(1)]),
  })
  .superRefine((entree, ctx) => {
    const attendu = TYPE_ATTENDU_PAR_CLE[entree.cle];
    if (typeof entree.valeur !== attendu) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valeur'],
        message:
          attendu === 'number'
            ? `La clé « ${entree.cle} » attend un nombre entier positif ou nul, pas une chaîne.`
            : `La clé « ${entree.cle} » attend une chaîne non vide, pas un nombre.`,
      });
      return;
    }
    if (entree.cle === 'fuseau' && typeof entree.valeur === 'string' && !fuseauValide(entree.valeur)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valeur'],
        message: `« ${entree.valeur} » n'est pas un identifiant de fuseau horaire reconnu (ex. Europe/Paris).`,
      });
    }
  });

/** Écrit un réglage — réservé aux admins et au-delà (owner). */
export async function ecrireReglage(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'admin');
  const { cle, valeur } = valider(schemaEcrireReglage, entree);
  await ctx.ex.query(
    `insert into organization_settings (organization_id, key, value, updated_at, updated_by)
     values ($1, $2, $3::jsonb, now(), $4)
     on conflict (organization_id, key) do update
       set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
    [ctx.organisationId, cle, JSON.stringify(valeur), ctx.utilisateurId],
  );
}

/** Une ligne de la table éditable de l'écran Réglages › Plafonds (tâche 21) : valeur réellement appliquée, défaut, repli d'environnement, et qui a modifié quand. */
export interface DetailReglage {
  cle: ClePlafond;
  valeur: number | string;
  defaut: number | string;
  /** Nom de la variable d'environnement de repli, `null` quand la clé n'en a aucun (`score_min_defaut`, `relecture_premiers_envois_defaut`, `age_max_offres_jours`, `fuseau`). */
  repli: string | null;
  /** Nom affiché de l'auteur de la dernière écriture EXPLICITE en base, `null` si la clé n'a jamais été réglée dans l'écran (valeur = défaut ou repli). */
  modifiePar: string | null;
  modifieLe: string | null;
}

/**
 * Détail des réglages pour la table éditable de l'écran (tâche 21) : la valeur
 * réellement appliquée (`lireReglages`, R78 compris) enrichie de sa provenance
 * — qui l'a réglée en base et quand, `null`/`null` pour une clé qui n'a jamais
 * été écrite explicitement (elle applique alors son défaut ou son repli).
 *
 * Requête d'audit séparée de `lireReglages` (deux lectures d'`organization_settings`
 * pour un rendu de cette page plutôt qu'une) : jointe à `auth.users` comme
 * `ajouterNote`/`lireFiche` (`contacts.ts`) pour un NOM affiché, jamais un id
 * technique — un coût négligeable sur un écran de réglages, pas un chemin chaud.
 *
 * `reglages` : à passer quand l'appelant les a déjà lus (même convention que
 * `lireConsommationDuJour`) — la page Plafonds a aussi besoin de la
 * consommation du jour, qui exige elle aussi `lireReglages` ; passer la même
 * valeur aux deux évite une troisième lecture d'`organization_settings` pour
 * un seul rendu.
 */
export async function lireReglagesDetail(
  ctx: Contexte,
  reglages?: Awaited<ReturnType<typeof lireReglages>>,
): Promise<DetailReglage[]> {
  // I7 (Important, revue finale du 14/09) : expose le nom de l'auteur de
  // chaque réglage, sans contrôle de rôle jusqu'ici.
  exiger(ctx, 'viewer');
  const [valeurs, auditRes] = await Promise.all([
    reglages ?? lireReglages(ctx),
    ctx.ex.query<{ key: string; updated_at: string; nom: string | null }>(
      `select os.key, os.updated_at,
              coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)) as nom
         from organization_settings os
         left join auth.users u on u.id = os.updated_by
        where os.organization_id = $1`,
      [ctx.organisationId],
    ),
  ]);
  const parCle = new Map(auditRes.rows.map((r) => [r.key, r]));

  return CLES_REGLAGES.map(({ cle, defaut, env }) => {
    const audit = parCle.get(cle);
    return {
      cle,
      valeur: valeurs[cle],
      defaut,
      repli: env ?? null,
      modifiePar: audit?.nom ?? null,
      modifieLe: audit?.updated_at ?? null,
    };
  });
}

/** Une jauge de consommation : ce qui a déjà été utilisé aujourd'hui, et le plafond courant. */
export interface Jauge {
  utilise: number;
  plafond: number;
}

/**
 * Plafond d'enrichissement du jour — SEULE source de vérité pour les deux
 * boutons « Chercher l'email » (tâche 8 par signal, `apps/web/app/actions/enrichir.ts` ;
 * tâche 17 par contact, `fonctions/contacts.ts`), qui partagent le même
 * compteur `provider_daily_usage(provider_id='fullenrich')` et doivent donc
 * appliquer le même nombre (R78, tour de correction 1 de la tâche 17) — et
 * désormais (R83) le même nombre que le worker, via `plafondDuJour`.
 */
export async function plafondEnrichissementDuJour(ctx: Contexte): Promise<number> {
  return plafondDuJour(ctx.ex, ctx.organisationId, 'enrichissements_par_jour');
}

/**
 * Consommation du jour, pour l'écran comme pour le MCP : scoring et
 * enrichissement lus dans `provider_daily_usage` (le compteur atomique que le
 * moteur incrémente déjà via `app.consume_provider_credit`, cf.
 * `apps/worker/src/traitements.ts` et `producer.ts`) ; les envois comptés sur
 * les actions réellement parties (mêmes statuts que `chargerContraintesSender`
 * dans `apps/worker/src/handlers/sequence.ts`), plafonnés par la somme des
 * quotas des expéditeurs email actifs.
 *
 * Scoring, enrichissement ET envois se remettent à zéro à minuit dans le
 * fuseau de l'organisation (#118, tour de correction 5) : `usage_date` (scoring,
 * enrichissement) et la borne du jour (envois) utilisent la même clé de jour
 * (`jourCourantDansFuseau`). Avant ce correctif, scoring/enrichissement
 * utilisaient `current_date` (UTC, le fuseau du serveur) — décision du
 * coordinateur au 14/09, revenue avec l'exigence de JB du 17/09 (« tout doit
 * être juste et cohérent ») : la page Plafonds affichait honnêtement « minuit
 * UTC », mais un plafond qui « se remet à zéro » à une heure différente de
 * celle de l'organisation reste une incohérence pour l'opérateur.
 *
 * `reglages` : à passer quand l'appelant les a déjà lus (`lireAujourdhui`, qui
 * en a aussi besoin pour son propre fuseau) — évite une deuxième lecture de
 * `organization_settings` dans le même appel. Absent, `lireReglages(ctx)` est
 * appelé ici comme avant : le comportement ne change pas pour un appelant qui
 * ne passe rien.
 */
export async function lireConsommationDuJour(
  ctx: Contexte,
  reglages?: Awaited<ReturnType<typeof lireReglages>>,
): Promise<{ scoring: Jauge; enrichissement: Jauge; envois: Jauge }> {
  const reglagesResolus = reglages ?? (await lireReglages(ctx));
  const fuseau = String(reglagesResolus.fuseau);
  // Même clé de jour que le worker (`app.consume_provider_credit`, appelé avec
  // ce jour depuis `traiterScore`/`enqueueEnrichmentForQualified`) et que
  // `chercherEmail` (`contacts.ts`) : sans ça, lire ce jour côté app pendant
  // que le worker écrit celui d'un AUTRE jour (UTC) ferait retomber la jauge à
  // zéro entre minuit UTC et minuit heure de l'organisation.
  const jour = jourCourantDansFuseau(fuseau);

  const scoringRes = await ctx.ex.query<{ n: number }>(
    `select coalesce(used, 0)::int as n /* scored_today */
       from provider_daily_usage
      where organization_id = $1 and provider_id = 'anthropic' and usage_date = $2::date`,
    [ctx.organisationId, jour],
  );
  const enrichRes = await ctx.ex.query<{ n: number }>(
    `select coalesce(used, 0)::int as n /* enrich_today */
       from provider_daily_usage
      where organization_id = $1 and provider_id = 'fullenrich' and usage_date = $2::date`,
    [ctx.organisationId, jour],
  );
  const envoisUtiliseRes = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n
       from actions a
      where a.organization_id = $1
        and a.channel = 'email'
        and a.status in ('dispatched', 'delivered')
        and a.dispatched_at >= date_trunc('day', now() at time zone $2) at time zone $2`,
    [ctx.organisationId, fuseau],
  );
  const envoisPlafondRes = await ctx.ex.query<{ plafond: number }>(
    `select coalesce(sum(daily_quota), 0)::int as plafond
       from senders
      where organization_id = $1 and kind = 'email' and is_active`,
    [ctx.organisationId],
  );

  return {
    scoring: { utilise: scoringRes.rows[0]?.n ?? 0, plafond: Number(reglagesResolus.scoring_par_jour) },
    // `reglagesResolus.enrichissements_par_jour` porte déjà le repli R78
    // (`credentials.config.daily_cap`, cf. `lireReglages`) — même valeur que
    // `plafondEnrichissementDuJour(ctx)`, sans le relire.
    enrichissement: { utilise: enrichRes.rows[0]?.n ?? 0, plafond: Number(reglagesResolus.enrichissements_par_jour) },
    envois: { utilise: envoisUtiliseRes.rows[0]?.n ?? 0, plafond: envoisPlafondRes.rows[0]?.plafond ?? 0 },
  };
}
