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
  | 'linkedin_posts_par_jour'
  | 'linkedin_requetes_par_heure'
  | 'linkedin_personnes_par_passage'
  | 'linkedin_invitations_par_semaine'
  | 'linkedin_messages_par_semaine'
  | 'age_max_offres_jours'
  | 'score_min_defaut'
  | 'relecture_premiers_envois_defaut'
  | 'fuseau';

const CLE_PLAFOND_VALUES = [
  'scoring_par_jour',
  'enrichissements_par_jour',
  'linkedin_posts_par_jour',
  'linkedin_requetes_par_heure',
  'linkedin_personnes_par_passage',
  'linkedin_invitations_par_semaine',
  'linkedin_messages_par_semaine',
  'age_max_offres_jours',
  'score_min_defaut',
  'relecture_premiers_envois_defaut',
  'fuseau',
] as const satisfies readonly ClePlafond[];

export const CLES_REGLAGES: readonly { cle: ClePlafond; defaut: number | string; env?: string }[] = [
  { cle: 'scoring_par_jour', defaut: 300, env: 'SCORE_DAILY_CAP' },
  { cle: 'enrichissements_par_jour', defaut: 30, env: 'ENRICH_DAILY_CAP' },
  { cle: 'linkedin_posts_par_jour', defaut: 3, env: 'LINKEDIN_POSTS_DAILY_CAP' },
  { cle: 'linkedin_requetes_par_heure', defaut: 60, env: 'LINKEDIN_REQUESTS_HOURLY_CAP' },
  // 100 : trois posts par jour (plafond ci-dessus) font 300 personnes, soit exactement le plafond
  // de scoring, que les offres d'emploi se partagent. Un passage qui enregistre plus fabrique des
  // fiches que le moteur ne traitera jamais (revue finale, 2.3).
  { cle: 'linkedin_personnes_par_passage', defaut: 100, env: 'LINKEDIN_PEOPLE_PER_RUN_CAP' },
  // Deux plafonds d'envoi, un par type d'action, sur sept jours glissants. C'est l'invitation qui
  // met un compte LinkedIn en danger (son taux d'acceptation est surveillé), le message beaucoup
  // moins : un compteur commun forçait à brider les messages au rythme du plus risqué. Le plafond
  // quotidien de chaque type se déduit du sien (`chargerStatsRythme`, linkedin/file.ts).
  { cle: 'linkedin_invitations_par_semaine', defaut: 100, env: 'LINKEDIN_INVITES_WEEKLY_CAP' },
  { cle: 'linkedin_messages_par_semaine', defaut: 200, env: 'LINKEDIN_MESSAGES_WEEKLY_CAP' },
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
 * La jauge des envois, seule à distinguer « aucun plafond réglé » (`null`) de
 * « plafond à zéro » (`0`, qui vaut pause dans ce produit, cf. `placesRestantes`
 * dans `packages/core/src/plafonds.ts`). Les autres plafonds ont toujours une
 * valeur : ils viennent d'un réglage d'organisation, pas d'une colonne nullable.
 */
export interface JaugeEnvois {
  utilise: number;
  plafond: number | null;
}

/**
 * Les emails qui consomment le quota du jour : REMIS au transporteur
 * (`dispatched`, ou `delivered` une fois réellement parti), dans le jour de
 * l'organisation. Mêmes lignes que celles comptées par le moteur
 * (`chargerContraintesSender`, `apps/worker/src/handlers/sequence.ts`) — une
 * jauge qui ne compterait pas la même chose que lui pourrait annoncer de la
 * place restante alors qu'il a atteint son quota.
 *
 * Alias imposé : `actions a` ; paramètres `$2` = jour calendaire (date),
 * `$3` = fuseau — mêmes positions que `SQL_ACTION_DU_JOUR` (`aujourdhui.ts`),
 * pour que les deux tiennent dans une seule requête du menu.
 *
 * Le cast `::date::timestamp` avant `at time zone` est obligatoire, pour la
 * raison détaillée dans `SQL_ACTION_DU_JOUR` : sans lui, Postgres repart du
 * fuseau de la session et le comptage du jour rate presque toutes les lignes.
 */
export const SQL_EMAIL_CONSOMME_LE_QUOTA = `a.channel = 'email'
          and a.status in ('dispatched', 'delivered')
          and a.dispatched_at >= ($2::date::timestamp at time zone $3)
          and a.dispatched_at < (($2::date + 1)::timestamp at time zone $3)`;

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
 * Plafond d'envois du jour : somme des quotas journaliers des boîtes email
 * actives. SEULE définition du plafond d'organisation — le menu, l'accueil, la
 * page Plafonds et la file du jour (`listerFileDuJour`, `campagnes.ts`)
 * l'appellent tous.
 *
 * `null` = AUCUNE LIMITE RÉGLÉE, et ce n'est pas la même chose que zéro.
 * `senders.daily_quota` est nullable, et le moteur lit ce `null` comme « pas de
 * limite » (`quotaSenderRestant` rend `Infinity`,
 * `apps/worker/src/handlers/sequence.ts`), tandis que zéro vaut pause partout
 * dans le produit (`placesRestantes`). Un `coalesce(sum(...), 0)` confondait les
 * deux : la jauge annonçait « en pause » pendant que le moteur envoyait sans
 * limite — relevé par la revue de cohérence du lot 2, prouvé par
 * `test/pg-verify/jauge-envois.sh`.
 *
 * Une seule boîte active sans quota suffit à rendre `null` : `sum` ignore les
 * NULL, donc additionner les autres annoncerait un plafond que le moteur ne
 * respecte pas. Aucune boîte active rend bien `0` — rien ne peut partir.
 */
export async function lirePlafondEnvois(ctx: Contexte): Promise<number | null> {
  const res = await ctx.ex.query<{ plafond: number | null }>(
    `select case when count(*) filter (where daily_quota is null) > 0 then null
                 else coalesce(sum(daily_quota), 0)::int end as plafond /* jr:plafond_envois_org */
       from senders
      where organization_id = $1 and kind = 'email' and is_active`,
    [ctx.organisationId],
  );
  return res.rows[0]?.plafond ?? null;
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
): Promise<{ scoring: Jauge; enrichissement: Jauge; envois: JaugeEnvois }> {
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
  // Même fragment que le menu (`lireResumeCoquille`, `aujourdhui.ts`) : sans
  // définition partagée, les deux écrans ont déjà affiché deux nombres
  // différents pour « envois du jour ».
  const envoisUtiliseRes = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n /* jr:envois_du_jour */
       from actions a
      where a.organization_id = $1
        and ${SQL_EMAIL_CONSOMME_LE_QUOTA}`,
    [ctx.organisationId, jour, fuseau],
  );
  return {
    scoring: { utilise: scoringRes.rows[0]?.n ?? 0, plafond: Number(reglagesResolus.scoring_par_jour) },
    // `reglagesResolus.enrichissements_par_jour` porte déjà le repli R78
    // (`credentials.config.daily_cap`, cf. `lireReglages`) — même valeur que
    // `plafondEnrichissementDuJour(ctx)`, sans le relire.
    enrichissement: { utilise: enrichRes.rows[0]?.n ?? 0, plafond: Number(reglagesResolus.enrichissements_par_jour) },
    envois: { utilise: envoisUtiliseRes.rows[0]?.n ?? 0, plafond: await lirePlafondEnvois(ctx) },
  };
}

/**
 * Les plafonds qui bornent la collecte LinkedIn du serveur (lot 4a) : posts par jour et requêtes
 * par heure bornent le TRAFIC ; `linkedin_personnes_par_passage` borne ce qu'un passage ÉCRIT en
 * base, parce que les étages aval (scoring, enrichissement) sont plafonnés à un ou deux ordres
 * de grandeur de moins que ce que 60 requêtes de 50 profils laissent entrer.
 */
export type ClePlafondLinkedIn = 'linkedin_posts_par_jour' | 'linkedin_requetes_par_heure' | 'linkedin_personnes_par_passage';

/** Plafond LinkedIn d'une clé : même chaîne de repli que les autres (`plafondDuJour`), valeur en base d'abord. */
export async function lirePlafondLinkedIn(ctx: Contexte, cle: ClePlafondLinkedIn): Promise<number> {
  return plafondDuJour(ctx.ex, ctx.organisationId, cle);
}

/**
 * Consigne UNE requête émise vers LinkedIn, au moment où elle part. Le passage
 * doit appartenir à l'organisation : sans cette jointure, un identifiant de
 * passage d'une autre organisation serait accepté (le worker écrit avec la clé
 * de service, que la RLS ne borne pas).
 */
export async function tracerRequeteLinkedIn(ctx: Contexte, sourceRunId: string): Promise<void> {
  const res = await ctx.ex.query(
    `insert into linkedin_requetes (organization_id, source_run_id) /* jr:linkedin_requete_tracer */
     select so.organization_id, sr.id
       from source_runs sr
       join sources so on so.id = sr.source_id
      where sr.id = $2 and so.organization_id = $1`,
    [ctx.organisationId, sourceRunId],
  );
  if (res.rowCount === 0) throw new Error("Passage de collecte introuvable pour cette organisation.");
}

/**
 * Consigne UNE requête d'ENVOI émise vers LinkedIn, au moment où elle part : même table, même
 * fenêtre horaire que la collecte (le compte est le même). L'action doit appartenir à
 * l'organisation, pour la même raison que `tracerRequeteLinkedIn` : le worker écrit avec la clé
 * de service, que la RLS ne borne pas.
 */
export async function tracerEnvoiLinkedIn(ctx: Contexte, actionQueueId: string): Promise<void> {
  const res = await ctx.ex.query(
    `insert into linkedin_requetes (organization_id, action_queue_id) /* jr:linkedin_envoi_tracer */
     select q.organization_id, q.id
       from linkedin_action_queue q
      where q.id = $2 and q.organization_id = $1`,
    [ctx.organisationId, actionQueueId],
  );
  if (res.rowCount === 0) throw new Error("Action LinkedIn introuvable pour cette organisation.");
}

/**
 * Requêtes émises vers LinkedIn depuis `depuis` (inclus), jusqu'à `jusqua`
 * (exclu) si fourni. Compte l'horodatage de CHAQUE requête, jamais le
 * démarrage du passage : une collecte ouverte à 23 h 55 dont une requête part
 * à 00 h 05 compte une requête de chaque côté de minuit.
 */
export async function compterRequetesLinkedIn(ctx: Pick<Contexte, 'ex' | 'organisationId'>, depuis: Date, jusqua?: Date): Promise<number> {
  const res = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n /* jr:linkedin_requetes_compter */
       from linkedin_requetes
      where organization_id = $1
        and requested_at >= $2
        and ($3::timestamptz is null or requested_at < $3)`,
    [ctx.organisationId, depuis, jusqua ?? null],
  );
  return res.rows[0]?.n ?? 0;
}

/**
 * Posts `linkedin_post_engagers` RÉELLEMENT OUVERTS chez LinkedIn pendant `jour`
 * (AAAA-MM-JJ) dans `fuseau`. Une source n'a pas de ligne `source_providers` pour
 * ce type : le repère est `config.sourceType` (cf. `construireConfigStocke`,
 * `sources.ts`). La borne s'écrit `::date::timestamp at time zone` : sans le cast
 * intermédiaire, Postgres repart du fuseau de la session.
 *
 * Ne comptent que les passages ayant émis AU MOINS UNE requête (`linkedin_requetes`).
 * Un `source_runs` est ouvert par le producteur avant que le job ne tourne : compter
 * les lignes au lieu des requêtes rendait le plafond faux dès que plusieurs passages
 * s'ouvraient dans le même tour — ce que font `lancerCampagne` (toutes les sources de
 * la campagne, à chaque activation) et `lancerTache({tache:'sources'})`. Quatre posts
 * suivis, plafond de trois : les quatre lisaient « quatre passages aujourd'hui », se
 * clôturaient à vide, et plus rien ne collectait jusqu'au lendemain.
 *
 * `sauf` : le passage qui demande son propre budget. Il n'a encore rien émis au moment
 * du calcul, donc l'`exists` l'exclut déjà ; l'exclure explicitement évite que la règle
 * dépende de cet ordre.
 */
export async function compterPostsLinkedInDuJour(
  ctx: Contexte,
  jour: string,
  fuseau: string,
  sauf?: string,
): Promise<number> {
  const res = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n /* jr:linkedin_posts_du_jour */
       from source_runs sr
       join sources so on so.id = sr.source_id
      where so.organization_id = $1
        and so.config->>'sourceType' = 'linkedin_post_engagers'
        and sr.started_at >= ($2::date::timestamp at time zone $3)
        and sr.started_at < (($2::date + 1)::timestamp at time zone $3)
        and ($4::uuid is null or sr.id <> $4::uuid)
        and exists (select 1 from linkedin_requetes lr where lr.source_run_id = sr.id)`,
    [ctx.organisationId, jour, fuseau, sauf ?? null],
  );
  return res.rows[0]?.n ?? 0;
}

/**
 * Fuseau dans lequel se compte le « jour » du plafond de posts : celui de `linkedin_settings`
 * (le même que l'écran Expéditeurs règle pour le canal gelé de l'extension), à défaut
 * Europe/Paris, valeur par défaut de la table (migration 20260831160000).
 *
 * DETTE POUR LE LOT 4b : cette fonction rendait aussi la FENÊTRE d'envoi (jours, heures), lue puis
 * jetée par l'unique appelant, qui n'en gardait que le fuseau. Elle a été retirée plutôt que de
 * laisser croire qu'elle contraint la collecte : rien ne part automatiquement en 4a (seul un clic
 * d'opérateur enfile un passage, et refuser à 20 h le clic d'un humain qui a choisi son moment est
 * un mauvais produit, ruling 63). La fenêtre devient OBLIGATOIRE le jour où une collecte part toute
 * seule : une collecte à 4 h du matin sans personne devant est ce qui trahit une machine. Elle se
 * relira alors dans `linkedin_settings` (`send_days`, `send_from_hour`, `send_to_hour`, où
 * `send_to_hour` vaut jusqu'à 24) ; l'écran Expéditeurs l'écrit déjà.
 */
export async function lireFuseauLinkedIn(ctx: Contexte): Promise<string> {
  const res = await ctx.ex.query<{ timezone: string }>(
    `select timezone /* jr:linkedin_fuseau */
       from linkedin_settings
      where organization_id = $1`,
    [ctx.organisationId],
  );
  return res.rows[0]?.timezone ?? 'Europe/Paris';
}
