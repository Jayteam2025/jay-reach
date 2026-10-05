/**
 * Sources d'une campagne (onglet Sources, tâche 11, lot 2). Spec « une
 * fonction, deux façades » : l'écran (`apps/web/app/actions/sources.ts`) et
 * le futur serveur MCP appellent les mêmes fonctions avec le même `Contexte`.
 *
 * Une source est un THÈME DE VEILLE (`sources`, migration
 * `20260831140000_sources_themes_de_veille`) : nom et critères (mots-clés,
 * zone…) dans `config`, rattaché à zéro ou plusieurs fournisseurs
 * (`source_providers`) et à une ou plusieurs campagnes (`campaign_sources`).
 * Le worker (`apps/worker/src/producer.ts`, `enqueueDiscoverForActiveSources`)
 * enfile une collecte par (thème, fournisseur) actifs, en lisant
 * `sources.config.keywords`/`config.location` — PAS `source_providers.config`.
 *
 * Dans CET onglet, une carte = un thème créé pour CETTE campagne avec AU PLUS
 * un fournisseur rattaché (`creerSource` couvre ce cas simple ; le modèle
 * multi-fournisseurs reste pertinent pour une veille partagée entre
 * campagnes, mais aucun écran de ce lot ne le pilote). Les trois derniers
 * types (`csv`, `list`, `directory`) sont des ACTIONS PONCTUELLES : elles ne
 * créent jamais de ligne `sources`/`campaign_sources` — pas de carte, pas de
 * passage périodique, cohérent avec la maquette qui n'affiche que les cartes
 * de veille même après plusieurs imports CSV déjà faits. Elles ont leurs
 * propres fonctions (`importerCsv`, `ajouterDepuisAnnuaire`,
 * `ajouterDepuisListe`), proposées par le même menu « Ajouter une source »
 * mais jamais par `creerSource`.
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider, ErreurIntrouvable, ErreurEntree } from './contexte.js';
import { ecrireEvenement } from '../journal.js';
import { lireReglages } from './plafonds.js';
import {
  processImport,
  type ParsedRows,
  type ColumnMapping,
  type MappedRow,
} from '../import/index.js';

/**
 * Jour calendaire (AAAA-MM-JJ) d'un instant DANS un fuseau donné, pas dans
 * celui du process qui exécute le rendu (I5, revue finale — copie locale de
 * `cleJourDansFuseau`, `apps/web/lib/dates.ts`, même utilitaire que
 * `campagnes.ts` : pas de couplage cross-fichier pour une ligne).
 */
function jourDansFuseau(date: Date, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// ---------------------------------------------------------------------------
// Types de source
// ---------------------------------------------------------------------------

export const TYPES_SOURCES = [
  'adzuna',
  'france_travail',
  'linkedin_post_engagers',
  'linkedin_competitor_followers',
  'linkedin_keywords',
  'linkedin_job_change',
  'csv',
  'list',
  'directory',
] as const;
export type TypeSource = (typeof TYPES_SOURCES)[number];

/**
 * Types qui créent une veille persistante (`sources` + `campaign_sources`),
 * seuls acceptés par `creerSource`. Exporté (tâche 14) pour l'assistant de
 * création de campagne, qui ne propose que ces types dans son étape Sources.
 */
export const TYPES_VEILLE = [
  'adzuna',
  'france_travail',
  'linkedin_post_engagers',
  'linkedin_competitor_followers',
  'linkedin_keywords',
  'linkedin_job_change',
] as const;
export type TypeVeille = (typeof TYPES_VEILLE)[number];

const TYPES_LINKEDIN = [
  'linkedin_post_engagers',
  'linkedin_competitor_followers',
  'linkedin_keywords',
  'linkedin_job_change',
] as const;

/**
 * `provider_id` réel écrit dans `source_providers`, tel que le worker le
 * route (`SCRAPERS`, `apps/worker/src/handlers/discover.ts`) — `francetravail`
 * SANS underscore, alors que le type UI garde l'underscore (vocabulaire
 * d'affichage). Un mauvais `provider_id` ferait échouer silencieusement toute
 * collecte France Travail : aucun scraper enregistré à cette clé.
 */
const PROVIDER_ID_REEL: Record<'adzuna' | 'france_travail', string> = {
  adzuna: 'adzuna',
  france_travail: 'francetravail',
};
const PROVIDER_ID_INVERSE: Record<string, 'adzuna' | 'france_travail'> = {
  adzuna: 'adzuna',
  francetravail: 'france_travail',
};

function estTypeVeille(v: string): v is TypeVeille {
  return (TYPES_VEILLE as readonly string[]).includes(v);
}
function estTypeLinkedIn(v: string): v is (typeof TYPES_LINKEDIN)[number] {
  return (TYPES_LINKEDIN as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Schémas de `config` par type (formulaires des tiroirs)
// ---------------------------------------------------------------------------

/**
 * `.strict()` sur les six schémas de `config` (tour de correction 1, R58) :
 * aucun autre appelant dans le dépôt ne construit ces objets à la main
 * (grep fait avant d'ajouter — seul `sources.ts` importe ces schémas), et
 * chaque formulaire (tiroirs tâche 11, assistant tâche 14) reconstruit un
 * objet neuf à la soumission plutôt que de renvoyer la config stockée
 * (qui, elle, porte des clés dérivées comme `sourceType`/`keywords` —
 * ajoutées APRÈS validation par `construireConfigStocke`, jamais avant).
 * Une clé du mauvais fournisseur (ex. `contrat` envoyé à France Travail,
 * qui attend `typeContrat`) est donc désormais rejetée avec une
 * `ErreurEntree` au lieu d'être ignorée en silence.
 */
export const configAdzuna = z
  .object({
    motsCles: z.array(z.string().min(1)).min(1),
    lieux: z.array(z.string().min(1)).default([]),
    contrat: z.enum(['cdi', 'tous']).default('tous'),
    taille: z.string().max(60).optional(),
    exclusions: z.array(z.string()).default([]),
    /** Repli : réglage de l'organisation (`AGE_MAX_SIGNAL_JOURS_PAR_DEFAUT`, `apps/worker/src/producer.ts` = 14 jours). */
    ageMaxJours: z.number().int().positive().max(365).optional(),
  })
  .strict();
export type ConfigAdzuna = z.infer<typeof configAdzuna>;

export const configFranceTravail = z
  .object({
    motsCles: z.array(z.string().min(1)).min(1),
    lieux: z.array(z.string().min(1)).default([]),
    typeContrat: z.enum(['cdi', 'tous']).default('tous'),
    departement: z.string().max(60).optional(),
    exclusions: z.array(z.string()).default([]),
    ageMaxJours: z.number().int().positive().max(365).optional(),
  })
  .strict();
export type ConfigFranceTravail = z.infer<typeof configFranceTravail>;

export const configLinkedInPost = z
  .object({
    urlPost: z.string().min(1),
    garder: z.array(z.enum(['commente', 'reagi'])).min(1),
    /** Présent seulement si la campagne porte plusieurs personas (obligatoire alors, vérifié par `creerSource`). */
    personaId: z.string().min(1).optional(),
  })
  .strict();
export type ConfigLinkedInPost = z.infer<typeof configLinkedInPost>;

export const configLinkedInConcurrent = z
  .object({
    comptesConcurrents: z.array(z.string().min(1)).min(1),
    compteId: z.string().min(1),
    profilsParJour: z.number().int().positive().max(200).default(40),
  })
  .strict();
export type ConfigLinkedInConcurrent = z.infer<typeof configLinkedInConcurrent>;

export const configLinkedInMotsCles = z
  .object({
    sujets: z.array(z.string().min(1)).min(1),
    compteId: z.string().min(1),
    profilsParJour: z.number().int().positive().max(200).default(40),
  })
  .strict();
export type ConfigLinkedInMotsCles = z.infer<typeof configLinkedInMotsCles>;

export const configLinkedInChangementPoste = z
  .object({
    depuisJours: z.number().int().positive().max(365).default(90),
    compteId: z.string().min(1),
    profilsParJour: z.number().int().positive().max(200).default(40),
  })
  .strict();
export type ConfigLinkedInChangementPoste = z.infer<typeof configLinkedInChangementPoste>;

/** Bloc « collecte au lot 4 » (maquette `tiroir-source-linkedin.html`) : réglable, mais rien ne l'exécute avant le lot LinkedIn. */
function schemaConfigDuType(providerId: TypeVeille): z.ZodTypeAny {
  switch (providerId) {
    case 'adzuna':
      return configAdzuna;
    case 'france_travail':
      return configFranceTravail;
    case 'linkedin_post_engagers':
      return configLinkedInPost;
    case 'linkedin_competitor_followers':
      return configLinkedInConcurrent;
    case 'linkedin_keywords':
      return configLinkedInMotsCles;
    case 'linkedin_job_change':
      return configLinkedInChangementPoste;
  }
}

/**
 * `config` réellement stockée en base : les champs du formulaire, PLUS
 * `sourceType` (marqueur interne — seul moyen de retrouver le type d'une
 * source `linkedin_*`, qui n'a pas de ligne `source_providers`) et, pour
 * `adzuna`/`france_travail`, `keywords`/`location` en miroir — les deux clés
 * que `enqueueDiscoverForActiveSources` lit réellement sur `sources.config`.
 * `location` est le seul champ que le connecteur accepte (une chaîne) : les
 * lieux choisis sont joints par « , » (ex. « Île-de-France, Lyon », comme
 * l'affiche la maquette).
 */
export function construireConfigStocke(
  providerId: TypeVeille,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (providerId === 'adzuna' || providerId === 'france_travail') {
    const c = config as ConfigAdzuna | ConfigFranceTravail;
    return {
      ...config,
      sourceType: providerId,
      keywords: c.motsCles,
      ...(c.lieux.length > 0 ? { location: c.lieux.join(', ') } : {}),
    };
  }
  return { ...config, sourceType: providerId };
}

export type ConfigFormulaire =
  | ConfigAdzuna
  | ConfigFranceTravail
  | ConfigLinkedInPost
  | ConfigLinkedInConcurrent
  | ConfigLinkedInMotsCles
  | ConfigLinkedInChangementPoste;

function tableauDeChaines(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function nombreOuIndefini(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function chaineOuIndefinie(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function chaineOuVide(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Config de formulaire à partir de la config STOCKÉE en base — inverse exact
 * de `construireConfigStocke` (R43, tour de correction 2) : le tiroir de
 * réglages ET la carte doivent lire une source existante par cette seule
 * fonction, jamais directement les clés du formulaire dans `config`. Une
 * source migrée avant ce lot (R30, vérifiée sur la base OSS) ne porte QUE les
 * clés du worker (`keywords`, `location`, `exclude_keywords` — jamais
 * `motsCles`/`lieux`/`exclusions`) : les lire directement y renvoyait un
 * formulaire vide, obligeant à tout retaper pour pouvoir enregistrer.
 * `scoring_prompt`/`match_threshold` (posés par un autre chantier) restent
 * ignorés ici — non représentés dans `ConfigFormulaire` — mais jamais perdus
 * à l'écriture (`modifierSource` fusionne à la config existante).
 */
export function configFormulaireDepuisStockee(
  providerId: TypeVeille,
  configStockee: Record<string, unknown>,
): ConfigFormulaire {
  const c = configStockee ?? {};
  if (providerId === 'adzuna' || providerId === 'france_travail') {
    const motsCles = tableauDeChaines(c.keywords ?? c.motsCles);
    const location = typeof c.location === 'string' ? c.location : null;
    const lieux =
      location !== null
        ? location
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : tableauDeChaines(c.lieux);
    // `exclude_keywords` : nom réel sur une source migrée avant ce lot ;
    // `exclusions` : nom que ce formulaire écrit lui-même (spread inchangé
    // par `construireConfigStocke`, jamais renommé).
    const exclusions = tableauDeChaines(c.exclusions ?? c.exclude_keywords);
    const ageMaxJours = nombreOuIndefini(c.ageMaxJours ?? c.max_age_days);
    if (providerId === 'adzuna') {
      return {
        motsCles,
        lieux,
        contrat: c.contrat === 'cdi' ? 'cdi' : 'tous',
        taille: chaineOuIndefinie(c.taille),
        exclusions,
        ageMaxJours,
      };
    }
    return {
      motsCles,
      lieux,
      typeContrat: c.typeContrat === 'cdi' ? 'cdi' : 'tous',
      departement: chaineOuIndefinie(c.departement),
      exclusions,
      ageMaxJours,
    };
  }
  if (providerId === 'linkedin_post_engagers') {
    return {
      urlPost: chaineOuVide(c.urlPost),
      garder: tableauDeChaines(c.garder).filter(
        (v): v is 'commente' | 'reagi' => v === 'commente' || v === 'reagi',
      ),
      personaId: chaineOuIndefinie(c.personaId),
    };
  }
  if (providerId === 'linkedin_competitor_followers') {
    return {
      comptesConcurrents: tableauDeChaines(c.comptesConcurrents),
      compteId: chaineOuVide(c.compteId),
      profilsParJour: nombreOuIndefini(c.profilsParJour) ?? 40,
    };
  }
  if (providerId === 'linkedin_keywords') {
    return {
      sujets: tableauDeChaines(c.sujets),
      compteId: chaineOuVide(c.compteId),
      profilsParJour: nombreOuIndefini(c.profilsParJour) ?? 40,
    };
  }
  return {
    depuisJours: nombreOuIndefini(c.depuisJours) ?? 90,
    compteId: chaineOuVide(c.compteId),
    profilsParJour: nombreOuIndefini(c.profilsParJour) ?? 40,
  };
}

function lireSourceType(config: Record<string, unknown> | null): TypeVeille {
  const brut = config?.sourceType;
  if (typeof brut === 'string' && estTypeVeille(brut)) return brut;
  // Une `config` sans marqueur reconnu est traitée comme une source disparue
  // plutôt que de faire planter tout l'onglet sur une ligne incohérente.
  throw new ErreurIntrouvable('Source');
}

/**
 * Fragment SQL du fournisseur réel d'une source, pour un simple LOGO (pas la
 * priorité par nom de `resoudreProviders`, réservée à l'onglet Sources) :
 * `source_providers` d'abord (une source peut en avoir plusieurs, R30 — un
 * choix déterministe suffit ici), sinon `config.sourceType` (types
 * `linkedin_*`, jamais de ligne `source_providers`), sinon la colonne héritée
 * `sources.provider_id` (plus jamais écrite depuis `creerSource`, tâche 11 —
 * seules deux sources antérieures à ce lot la portent encore). `null` si
 * aucun des trois n'a de valeur : jamais une erreur (tour de correction 4,
 * R70 — `column "provider_id" est toujours NULL` a fait planter la page
 * d'ensemble d'une campagne, `campaigns/[id]/page.tsx`, sur `null.includes`).
 *
 * S'insère dans une requête qui alias `sources` en `so` (les quatre requêtes
 * qui l'utilisent le font déjà) ; fragment plutôt que fonction TS, ces
 * requêtes restent du SQL brut (`ctx.ex.query`), pas un query builder.
 */
export const SQL_PROVIDER_ID_AFFICHAGE = `coalesce(
  (select sp.provider_id from source_providers sp where sp.source_id = so.id order by sp.provider_id limit 1),
  so.config->>'sourceType',
  so.provider_id
)`;

/** Libellé affiché d'un fournisseur réel, pour la règle de priorité par le nom (R44). */
const LIBELLE_PROVIDER: Record<'adzuna' | 'france_travail', string> = {
  adzuna: 'Adzuna',
  france_travail: 'France Travail',
};

/**
 * Tous les fournisseurs UI d'une source, dans l'ordre d'affichage (R44, tour
 * de correction 2) : le premier est le PRINCIPAL — celui dont le libellé
 * apparaît dans le NOM de la source (ex. thème nommé « France Travail »,
 * rattaché à `adzuna` ET `francetravail` → principal `france_travail`, pas
 * le premier alphabétique) — puis les autres, par ordre alphabétique de
 * `provider_id` pour rester stable. Sans correspondance de nom, l'ordre
 * alphabétique fait foi pour tous.
 *
 * R30 (vérifié sur la base OSS, campagne « Directeur commercial ») : une
 * source peut être rattachée à PLUSIEURS fournisseurs — un thème créé avant
 * ce lot, quand une source valait pour plusieurs veilles (`creerSource` n'en
 * attache jamais qu'un). Sans fournisseur réel (type `linkedin_*`, qui n'a
 * jamais de ligne `source_providers`), le seul repère est `config.sourceType`.
 */
function resoudreProviders(
  nom: string,
  providerIdsReels: string[],
  config: Record<string, unknown> | null,
): TypeVeille[] {
  const traduits = providerIdsReels
    .map((p) => PROVIDER_ID_INVERSE[p])
    .filter((p): p is 'adzuna' | 'france_travail' => Boolean(p))
    .sort();
  if (traduits.length === 0) return [lireSourceType(config)];
  const nomNormalise = nom.toLowerCase();
  const estPrincipal = (p: 'adzuna' | 'france_travail') =>
    nomNormalise.includes(LIBELLE_PROVIDER[p].toLowerCase());
  return [...traduits.filter(estPrincipal), ...traduits.filter((p) => !estPrincipal(p))];
}

// ---------------------------------------------------------------------------
// listerSourcesCampagne
// ---------------------------------------------------------------------------

export const schemaCampagneIdSource = z.object({ campagneId: z.string().uuid() });

export interface SourceCarte {
  readonly id: string;
  /** Principal (R44) : celui dont le libellé apparaît dans le nom de la source, sinon le premier alphabétique. */
  readonly providerId: TypeVeille;
  /** Tous les fournisseurs réels rattachés (`source_providers`), dans l'ordre d'affichage — `[providerId]` hors thème hérité multi-fournisseurs (R30). */
  readonly providerIds: TypeVeille[];
  readonly nom: string;
  readonly config: Record<string, unknown>;
  /** Brut (`every 6h`), pour préremplir le sélecteur du tiroir de réglages sans reparser `prochainPassage`. */
  readonly schedule: string;
  readonly active: boolean;
  readonly dernierPassage: { quand: string; lus: number; retenus: number; ignores: number } | null;
  readonly prochainPassage: string | null;
  /** Sept valeurs, la plus ancienne d'abord (aujourd'hui inclus en dernier). */
  readonly retenus7j: number[];
  /** Offres distinctes trouvées par la source depuis son premier passage (signaux) — puce d'en-tête du tiroir. */
  readonly totalLu: number;
  /** Date du tout premier passage, `null` si la source n'a jamais tourné (masque la puce). */
  readonly premierPassage: string | null;
  /** Faux pour les quatre types `linkedin_*` tant que le worker ne les exécute pas (lot 4). */
  readonly collecteDisponible: boolean;
  /**
   * R72 : vrai si au moins une campagne rattachée (`campaign_sources`, toutes
   * campagnes confondues, pas seulement celle de cet écran) est `active`.
   * Faux → le producteur du worker ignore la source malgré `active` ; l'écran
   * s'en sert pour ne jamais annoncer une heure de prochain passage qui ne
   * viendra pas.
   */
  readonly campagneActive: boolean;
}

interface LigneSourceCarte {
  id: string;
  name: string;
  config: Record<string, unknown> | null;
  is_active: boolean;
  schedule: string | null;
}

/**
 * `schedule` accepte aussi la valeur historique `daily` (R30 : vérifiée sur
 * la base OSS, campagne « Directeur commercial » — ses deux sources datent
 * d'avant ce lot et portent `daily`, pas `every Xh`) : 24 heures pour
 * l'affichage, jamais reformatée de force en `every 24h` par une simple
 * lecture ou un enregistrement qui ne touche pas ce champ.
 */
export function heuresDeSchedule(schedule: string | null): number {
  if (schedule === 'daily') return 24;
  const m = /^every (\d+)h$/.exec(schedule ?? '');
  return m ? Number(m[1]) : 6;
}

const NOMBRE_JOURS_TENDANCE = 7;

export async function listerSourcesCampagne(
  ctx: Contexte,
  entree: unknown,
): Promise<SourceCarte[]> {
  exiger(ctx, 'viewer');
  const { campagneId } = valider(schemaCampagneIdSource, entree);

  const res = await ctx.ex.query<LigneSourceCarte>(
    `select s.id, s.name, s.config, s.is_active, s.schedule
       from campaign_sources cs /* jr:sources_lister */
       join sources s on s.id = cs.source_id
      where cs.campaign_id = $1 and s.organization_id = $2
      order by s.created_at asc`,
    [campagneId, ctx.organisationId],
  );
  // Court-circuite avant `lireReglages` (deuxième requête) quand il n'y a rien à enrichir —
  // même contrat qu'avant ce correctif (I5, revue finale) : aucune source, aucune requête de plus.
  if (res.rows.length === 0) return [];
  const ids = res.rows.map((r) => r.id);
  const fuseau = String((await lireReglages(ctx)).fuseau);

  const [passages, resumes, tendances, providers, campagnesActives] = await Promise.all([
    ctx.ex.query<{ source_id: string; started_at: string; items_found: number; items_new: number }>(
      // Un seul run par source (`distinct on`, le plus récent) : les runs plus
      // anciens ne sont pas rattachés à un fournisseur avant la bascule vers
      // les thèmes (commentaire de la migration), `source_id` reste donc la
      // seule clé fiable pour « le dernier passage de cette carte ».
      `select distinct on (source_id) source_id, started_at, items_found, items_new
         from source_runs /* jr:sources_dernier_passage */
        where source_id = any($1::uuid[])
        order by source_id, started_at desc`,
      [ids],
    ),
    // Résumé depuis le premier passage : puce d'en-tête du tiroir « {n} offres
    // trouvées depuis le {date} ». Le total compte les signaux distincts de la
    // source, pas la somme de `items_found` : un passage toutes les quinze
    // minutes relit les mêmes offres (R45 : 2 259 passages donnaient
    // « 1 667 653 offres lues » pour 38 000 offres réelles).
    ctx.ex.query<{ source_id: string; total: number; premier: string | null }>(
      `select src.id as source_id,
              (select count(*)::int from signals s where s.source_id = src.id) as total,
              (select min(r.started_at) from source_runs r where r.source_id = src.id) as premier
         from sources src /* jr:sources_resume_passages */
        where src.id = any($1::uuid[])`,
      [ids],
    ),
    // Groupé par jour DANS le fuseau de l'organisation, pas en UTC (I5, revue finale).
    ctx.ex.query<{ source_id: string; jour: string; n: number }>(
      `select source_id, to_char(occurred_at at time zone $2, 'YYYY-MM-DD') as jour, count(*)::int as n
         from signals /* jr:sources_retenus_7j */
        where source_id = any($1::uuid[]) and status in ('qualified', 'enrolled')
          and occurred_at >= now() - interval '7 days'
        group by source_id, jour`,
      [ids, fuseau],
    ),
    // Requête à part (pas de jointure sur la sélection principale) : un thème
    // rattaché à plusieurs fournisseurs (R30 — cf. `resoudreProviders`)
    // multiplierait sinon les lignes de `res`, dupliquant sa carte.
    ctx.ex.query<{ source_id: string; provider_id: string }>(
      `select source_id, provider_id from source_providers /* jr:sources_providers_rattaches */
        where source_id = any($1::uuid[])
        order by source_id, provider_id`,
      [ids],
    ),
    // R72 : toutes campagnes confondues (pas seulement `campagneId` de cet
    // écran) — une source partagée peut rester due grâce à une AUTRE
    // campagne active que celle affichée ici.
    ctx.ex.query<{ source_id: string }>(
      `select distinct cs.source_id from campaign_sources cs /* jr:sources_campagnes_actives */
         join campaigns c on c.id = cs.campaign_id
        where cs.source_id = any($1::uuid[]) and c.status = 'active'`,
      [ids],
    ),
  ]);

  const parPassage = new Map(passages.rows.map((r) => [r.source_id, r]));
  const parResume = new Map(resumes.rows.map((r) => [r.source_id, r]));
  const parTendance = new Map<string, Map<string, number>>();
  for (const r of tendances.rows) {
    if (!parTendance.has(r.source_id)) parTendance.set(r.source_id, new Map());
    parTendance.get(r.source_id)!.set(r.jour, r.n);
  }
  const parProvider = new Map<string, string[]>();
  for (const r of providers.rows) {
    if (!parProvider.has(r.source_id)) parProvider.set(r.source_id, []);
    parProvider.get(r.source_id)!.push(r.provider_id);
  }
  const idsAvecCampagneActive = new Set(campagnesActives.rows.map((r) => r.source_id));
  // Ancré sur le jour calendaire du fuseau de l'organisation (I5, revue finale), pas
  // `Date.now()` nu en UTC ; l'arithmétique en jours entiers qui suit reste ensuite en UTC pur,
  // sans nouveau risque de décalage puisque l'ancre porte déjà le bon jour.
  const ancreTendance = new Date(`${jourDansFuseau(new Date(), fuseau)}T00:00:00Z`);

  return res.rows.map((row) => {
    const config = (row.config ?? {}) as Record<string, unknown>;
    const providerIds = resoudreProviders(row.name, parProvider.get(row.id) ?? [], config);
    const providerId = providerIds[0]!;
    const resume = parResume.get(row.id);
    const passage = parPassage.get(row.id);
    const dernierPassage = passage
      ? {
          quand: passage.started_at,
          lus: passage.items_found,
          retenus: passage.items_new,
          ignores: Math.max(0, passage.items_found - passage.items_new),
        }
      : null;
    const prochainPassage = dernierPassage
      ? new Date(
          new Date(dernierPassage.quand).getTime() + heuresDeSchedule(row.schedule) * 3_600_000,
        ).toISOString()
      : null;

    const jours = parTendance.get(row.id) ?? new Map<string, number>();
    const retenus7j: number[] = [];
    for (let i = NOMBRE_JOURS_TENDANCE - 1; i >= 0; i -= 1) {
      const jour = new Date(ancreTendance);
      jour.setUTCDate(jour.getUTCDate() - i);
      retenus7j.push(jours.get(jour.toISOString().slice(0, 10)) ?? 0);
    }

    return {
      id: row.id,
      providerId,
      providerIds,
      nom: row.name,
      config,
      schedule: row.schedule ?? 'every 6h',
      active: row.is_active,
      dernierPassage,
      prochainPassage,
      retenus7j,
      totalLu: resume?.total ?? 0,
      premierPassage: resume?.premier ?? null,
      collecteDisponible: !estTypeLinkedIn(providerId),
      campagneActive: idsAvecCampagneActive.has(row.id),
    };
  });
}

// ---------------------------------------------------------------------------
// creerSource / modifierSource / activerSource / lancerPassage
// ---------------------------------------------------------------------------

/**
 * `every Nh` (nouvelle convention) ou `daily` (valeur historique — R30 :
 * les deux sources de la campagne « Directeur commercial » sur la base OSS
 * en portent une, créées avant ce lot). Un enregistrement qui ne touche pas
 * la cadence doit pouvoir la renvoyer telle quelle sans être rejeté.
 */
const schemaSchedule = z.string().regex(/^(every \d+h|daily)$/);

export const schemaCreerSource = z.object({
  campagneId: z.string().uuid(),
  providerId: z.enum(TYPES_SOURCES),
  nom: z.string().min(1).max(120),
  config: z.record(z.unknown()),
  schedule: schemaSchedule.default('every 6h'),
});

async function verifierCampagne(ctx: Contexte, campagneId: string): Promise<{ personas: string[] }> {
  const res = await ctx.ex.query<{ id: string; entry_rules: { personas?: unknown } | null }>(
    `select id, entry_rules from campaigns /* jr:sources_campagne */ where id = $1 and organization_id = $2`,
    [campagneId, ctx.organisationId],
  );
  if (res.rowCount === 0) throw new ErreurIntrouvable('Campagne');
  const personas = res.rows[0]?.entry_rules?.personas;
  return { personas: Array.isArray(personas) ? personas.filter((p): p is string => typeof p === 'string') : [] };
}

/**
 * Identité d'un post, pour les comparer. LinkedIn sert le même post sous
 * plusieurs formes (`/posts/…_activity-7271…`, `/feed/update/urn:li:activity:7271…`,
 * `fr.linkedin.com`, `www.linkedin.com`) : quand l'adresse porte un identifiant
 * d'activité, c'est lui qui fait foi. À défaut, adresse normalisée : hôte en
 * minuscules sans `www.` (ni sous-domaine de pays pour LinkedIn), sans paramètres
 * de partage, sans ancre, sans barre finale ; chemin et casse conservés, donc
 * deux posts réellement distincts le restent.
 */
export function normaliserUrlPost(url: string): string {
  const brut = url.trim();
  let lisible = brut;
  try {
    lisible = decodeURIComponent(brut);
  } catch {
    // adresse mal encodée : on compare telle quelle
  }
  try {
    const u = new URL(brut);
    const hote = u.host.toLowerCase().replace(/^www\./, '');
    const linkedin = hote === 'linkedin.com' || hote.endsWith('.linkedin.com');
    if (linkedin) {
      const activite = /(?:activity|ugcPost|share)[-:](\d+)/i.exec(lisible);
      if (activite) return `linkedin:${activite[1]}`;
    }
    const hoteCanonique = linkedin ? 'linkedin.com' : hote;
    return `${u.protocol}//${hoteCanonique}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return brut.toLowerCase().replace(/\/+$/, '');
  }
}

/** Plusieurs personas : on demande lequel ; un persona donné doit toujours appartenir à la campagne (création, modification, réglages). */
export function personaSourceValide(personas: readonly string[], personaId: string | undefined): boolean {
  const manquant = personas.length > 1 && !personaId;
  const etranger = personaId !== undefined && !personas.includes(personaId);
  return !manquant && !etranger;
}

export function exigerPersonaSource(personas: readonly string[], personaId: string | undefined): void {
  if (!personaSourceValide(personas, personaId)) {
    const manquant = personas.length > 1 && !personaId;
    throw new ErreurEntree({
      formErrors: [],
      fieldErrors: {
        personaId: [
          manquant
            ? 'Cette campagne porte plusieurs personas : choisissez celui de la source.'
            : 'Ce persona ne fait pas partie de la campagne.',
        ],
      },
    });
  }
}

/**
 * Règle « un post ne sert qu'à une seule campagne » : sans elle,
 * `enqueueEnrollments` fait entrer la personne dans la campagne la plus
 * ancienne, sans trace, et l'autre campagne affiche « 0 nouveau ».
 * Les sources sont en N-N avec les campagnes (`campaign_sources`) : la règle
 * se pose donc ici, dans les fonctions qui écrivent le lien, jamais dans l'écran.
 *
 * Refuse si une AUTRE source de l'organisation (`sourceIgnoree` : la source
 * qu'on modifie) porte le même post et est reliée à une campagne, quelle
 * qu'elle soit, la même comprise : même règle à la création et à la modification.
 */
export async function exigerPostLibre(
  ctx: Contexte,
  urlPost: string,
  sourceIgnoree: string | null,
): Promise<void> {
  const res = await ctx.ex.query<{ url: string | null }>(
    `select s.config->>'urlPost' as url
       from sources s join campaign_sources cs on cs.source_id = s.id /* jr:post_deja_pris */
      where s.organization_id = $1
        and s.config->>'sourceType' = 'linkedin_post_engagers'
        and ($2::uuid is null or s.id <> $2::uuid)`,
    [ctx.organisationId, sourceIgnoree],
  );
  const cible = normaliserUrlPost(urlPost);
  if (res.rows.some((r) => r.url !== null && normaliserUrlPost(r.url) === cible)) {
    throw new ErreurEntree({
      formErrors: [],
      fieldErrors: { urlPost: ['Un post ne peut servir qu’à une seule campagne.'] },
    });
  }
}

/**
 * Crée un thème de veille pour une campagne : `sources` puis `campaign_sources`,
 * et — hors `linkedin_*` — le rattachement `source_providers` qui rend la
 * collecte réellement exécutable par le worker. `providerId` accepte
 * `TYPES_SOURCES` au complet dans le schéma (signature de la tâche), mais
 * `csv`/`list`/`directory` sont refusés ici : ces trois-là passent par leurs
 * propres fonctions (`importerCsv`, `ajouterDepuisListe`, `ajouterDepuisAnnuaire`),
 * qui ne créent pas de veille persistante.
 */
export async function creerSource(ctx: Contexte, entree: unknown): Promise<{ id: string }> {
  exiger(ctx, 'operator');
  const { campagneId, providerId, nom, config, schedule } = valider(schemaCreerSource, entree);
  if (!estTypeVeille(providerId)) {
    throw new ErreurEntree({
      formErrors: [],
      fieldErrors: { providerId: ['Ce type de source ne se crée pas par ce formulaire.'] },
    });
  }
  const { personas } = await verifierCampagne(ctx, campagneId);

  const configValide = valider(schemaConfigDuType(providerId), config) as Record<string, unknown>;
  if (providerId === 'linkedin_post_engagers') {
    const { urlPost, personaId } = configValide as ConfigLinkedInPost;
    exigerPersonaSource(personas, personaId);
    await exigerPostLibre(ctx, urlPost, null);
  }
  const configStocke = construireConfigStocke(providerId, configValide);
  const collecteDisponible = !estTypeLinkedIn(providerId);

  const sourceRes = await ctx.ex.query<{ id: string }>(
    `insert into sources (organization_id, name, config, schedule, is_active) /* jr:sources_creer */
     values ($1, $2, $3::jsonb, $4, true) returning id`,
    [ctx.organisationId, nom, JSON.stringify(configStocke), schedule],
  );
  const sourceId = sourceRes.rows[0]!.id;

  await ctx.ex.query(
    `insert into campaign_sources (campaign_id, source_id) /* jr:sources_rattacher */ values ($1, $2)`,
    [campagneId, sourceId],
  );

  if (collecteDisponible) {
    const providerReel = PROVIDER_ID_REEL[providerId as 'adzuna' | 'france_travail'];
    await ctx.ex.query(
      `insert into source_providers (source_id, provider_id, is_active) /* jr:sources_provider_creer */ values ($1, $2, true)`,
      [sourceId, providerReel],
    );
  }

  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'source',
      entityId: sourceId,
      action: 'source.created',
      diff: { libelle: `Source « ${nom} » créée.`, campagneId },
      actorId: ctx.utilisateurId,
    });
  } catch (err) {
    console.warn('[journal] source.created', err);
  }

  return { id: sourceId };
}

export const schemaModifierSource = z.object({
  sourceId: z.string().uuid(),
  nom: z.string().min(1).max(120),
  config: z.record(z.unknown()),
  schedule: schemaSchedule,
});

/** Modifie une source existante : le type (`sourceType`) ne change jamais, il vient de la config déjà stockée. */
export async function modifierSource(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { sourceId, nom, config, schedule } = valider(schemaModifierSource, entree);

  const [res, providersRes] = await Promise.all([
    ctx.ex.query<{ name: string; config: Record<string, unknown> | null }>(
      `select name, config from sources /* jr:sources_lire_pour_modifier */ where id = $1 and organization_id = $2`,
      [sourceId, ctx.organisationId],
    ),
    ctx.ex.query<{ provider_id: string }>(
      `select provider_id from source_providers /* jr:sources_provider_pour_modifier */
        where source_id = $1 order by provider_id`,
      [sourceId],
    ),
  ]);
  const ligne = res.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Source');
  const providerId = resoudreProviders(
    ligne.name ?? '',
    providersRes.rows.map((r) => r.provider_id),
    ligne.config,
  )[0]!;

  const configValide = valider(schemaConfigDuType(providerId), config) as Record<string, unknown>;
  if (providerId === 'linkedin_post_engagers') {
    const { urlPost, personaId } = configValide as ConfigLinkedInPost;
    const campagnesRes = await ctx.ex.query<{ personas: unknown }>(
      `select c.entry_rules->'personas' as personas
         from campaign_sources cs join campaigns c on c.id = cs.campaign_id /* jr:sources_personas_campagnes */
        where cs.source_id = $1 and c.organization_id = $2`,
      [sourceId, ctx.organisationId],
    );
    for (const c of campagnesRes.rows) {
      exigerPersonaSource(
        Array.isArray(c.personas) ? c.personas.filter((p): p is string => typeof p === 'string') : [],
        personaId,
      );
    }
    await exigerPostLibre(ctx, urlPost, sourceId);
  }
  // Fusionné à la config EXISTANTE, jamais remplacé en bloc : une source
  // créée avant ce lot porte des clés que ce formulaire ne gère pas
  // (`scoring_prompt`, `match_threshold`, `exclude_keywords` — R30, vérifié
  // sur la base OSS) et qu'un enregistrement ne doit jamais effacer.
  const configStocke = {
    ...(ligne.config ?? {}),
    ...construireConfigStocke(providerId, configValide),
  };
  // Le formulaire envoie la config complète : un `personaId` absent a été retiré, il ne doit pas survivre à la fusion.
  if (providerId === 'linkedin_post_engagers' && (configValide as ConfigLinkedInPost).personaId === undefined) {
    delete (configStocke as Record<string, unknown>).personaId;
  }

  const ecriture = await ctx.ex.query(
    `update sources /* jr:sources_modifier */ set name = $2, config = $3::jsonb, schedule = $4
      where id = $1 and organization_id = $5`,
    [sourceId, nom, JSON.stringify(configStocke), schedule, ctx.organisationId],
  );
  if (ecriture.rowCount === 0) throw new ErreurIntrouvable('Source');

  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'source',
      entityId: sourceId,
      action: 'source.updated',
      diff: { libelle: `Source « ${nom} » modifiée.` },
      actorId: ctx.utilisateurId,
    });
  } catch (err) {
    console.warn('[journal] source.updated', err);
  }
}

export const schemaActiverSource = z.object({ sourceId: z.string().uuid(), active: z.boolean() });

/**
 * Active/désactive une source. Répercute l'état sur `source_providers` :
 * `enqueueDiscoverForActiveSources` (`producer.ts`) n'enfile une collecte que
 * si LES DEUX tables sont actives — sans cette synchronisation, désactiver
 * une source depuis l'écran laisserait le worker continuer à l'interroger.
 */
export async function activerSource(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { sourceId, active } = valider(schemaActiverSource, entree);

  const res = await ctx.ex.query(
    `update sources /* jr:sources_activer */ set is_active = $2 where id = $1 and organization_id = $3`,
    [sourceId, active, ctx.organisationId],
  );
  if (res.rowCount === 0) throw new ErreurIntrouvable('Source');

  await ctx.ex.query(
    `update source_providers /* jr:sources_provider_activer */ set is_active = $2 where source_id = $1`,
    [sourceId, active],
  );

  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'source',
      entityId: sourceId,
      action: 'source.toggled',
      diff: { libelle: active ? 'Source réactivée.' : 'Source mise en pause.' },
      actorId: ctx.utilisateurId,
    });
  } catch (err) {
    console.warn('[journal] source.toggled', err);
  }
}

export const schemaLancerPassage = z.object({ sourceId: z.string().uuid() });

/**
 * Demande un passage immédiat (`run_requested_at`, mécanisme existant —
 * migration `20260828120000_source_run_on_demand`) : le worker relève cette
 * colonne dans sa boucle légère et la remet à `null` une fois le job enfilé.
 * Refuse une source inactive ou hors organisation (`ErreurIntrouvable`).
 */
export async function lancerPassage(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { sourceId } = valider(schemaLancerPassage, entree);

  const res = await ctx.ex.query(
    `update sources /* jr:sources_lancer_passage */ set run_requested_at = now()
      where id = $1 and organization_id = $2 and is_active = true`,
    [sourceId, ctx.organisationId],
  );
  if (res.rowCount === 0) throw new ErreurIntrouvable('Source active');

  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'source',
      entityId: sourceId,
      action: 'source.run_requested',
      diff: { libelle: 'Passage demandé par l’opérateur.' },
      actorId: ctx.utilisateurId,
    });
  } catch (err) {
    console.warn('[journal] source.run_requested', err);
  }
}

// ---------------------------------------------------------------------------
// importerCsv — réutilise le pipeline d'import existant (`../import/index.js`),
// derrière `apps/web/app/actions/import.ts`. Contrairement à `runImport`
// (destination liste/existante/campagne), toujours scopé à UNE campagne :
// les contacts entrent directement comme des personnes déjà qualifiées, sans
// scoring (maquette `tiroir-source-csv.html`).
// ---------------------------------------------------------------------------

export const schemaImporterCsv = z.object({
  campagneId: z.string().uuid(),
  nom: z.string().min(1).max(120),
  fileName: z.string().nullable().default(null),
  parsed: z.object({ headers: z.array(z.string()), rows: z.array(z.record(z.string())) }),
  mapping: z.record(z.string()),
});

export interface ResultatImportCsv {
  readonly lignesLues: number;
  readonly contactsNouveaux: number;
  readonly dejaConnus: number;
  readonly sansEmailValide: number;
}

function domaineDe(site: string | undefined): string | null {
  if (!site) return null;
  return (
    site
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/, '')
      .toLowerCase() || null
  );
}
const valeurDe = (r: MappedRow, k: keyof MappedRow): string | null => {
  const v = r[k];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/**
 * Résout le compte d'une ligne (SIREN → domaine → nom), même logique à trois
 * niveaux que l'import général (`apps/web/app/actions/import.ts`, avant
 * portage) : sans elle, deux personnes de la même société sans SIREN ni site
 * se retrouveraient sur deux comptes distincts.
 */
async function resoudreCompteImport(ctx: Contexte, row: MappedRow): Promise<string | null> {
  const company = valeurDe(row, 'company');
  const siren = valeurDe(row, 'siren');
  const domain = domaineDe(valeurDe(row, 'website') ?? undefined);
  if (siren) {
    const a = await ctx.ex.query<{ id: string }>(
      `insert into accounts (organization_id, name, siren, city, postal_code, country, domain, resolution_status) /* jr:sources_csv_compte_siren */
       values ($1, $2, $3, $4, $5, $6, $7, 'resolved')
       on conflict (organization_id, siren) where siren is not null
       do update set name = coalesce(accounts.name, excluded.name), domain = coalesce(accounts.domain, excluded.domain)
       returning id`,
      [
        ctx.organisationId,
        company ?? siren,
        siren,
        valeurDe(row, 'city'),
        valeurDe(row, 'postal_code'),
        valeurDe(row, 'country'),
        domain,
      ],
    );
    return a.rows[0]?.id ?? null;
  }
  if (domain) {
    const a = await ctx.ex.query<{ id: string }>(
      `insert into accounts (organization_id, name, domain, city, postal_code, country, resolution_status) /* jr:sources_csv_compte_domaine */
       values ($1, $2, $3, $4, $5, $6, 'resolved')
       on conflict (organization_id, domain)
       do update set name = coalesce(accounts.name, excluded.name)
       returning id`,
      [
        ctx.organisationId,
        company ?? domain,
        domain,
        valeurDe(row, 'city'),
        valeurDe(row, 'postal_code'),
        valeurDe(row, 'country'),
      ],
    );
    return a.rows[0]?.id ?? null;
  }
  if (company) {
    const existant = await ctx.ex.query<{ id: string }>(
      `select id from accounts /* jr:sources_csv_compte_nom */
        where organization_id = $1 and lower(btrim(name)) = lower(btrim($2))
        order by created_at limit 1`,
      [ctx.organisationId, company],
    );
    if (existant.rows[0]) return existant.rows[0].id;
    const a = await ctx.ex.query<{ id: string }>(
      `insert into accounts (organization_id, name, resolution_status) /* jr:sources_csv_compte_creer */
       values ($1, $2, 'unresolved') returning id`,
      [ctx.organisationId, company],
    );
    return a.rows[0]?.id ?? null;
  }
  return null;
}

export async function importerCsv(ctx: Contexte, entree: unknown): Promise<ResultatImportCsv> {
  exiger(ctx, 'operator');
  const { campagneId, nom, fileName, parsed, mapping } = valider(schemaImporterCsv, entree);
  await verifierCampagne(ctx, campagneId);

  const outcome = processImport(parsed as ParsedRows, mapping as ColumnMapping);
  if (outcome.rows.length === 0) {
    return {
      lignesLues: outcome.report.rowsTotal,
      contactsNouveaux: 0,
      dejaConnus: 0,
      sansEmailValide: outcome.report.emailsMissing,
    };
  }

  const listeRes = await ctx.ex.query<{ id: string }>(
    `insert into lists (organization_id, name, context_note, origin, source_file_name) /* jr:sources_csv_liste */
     values ($1, $2, $2, 'import', $3) returning id`,
    [ctx.organisationId, nom, fileName],
  );
  const listId = listeRes.rows[0]!.id;

  let contactsNouveaux = 0;
  let dejaConnus = 0;
  for (const row of outcome.rows) {
    const accountId = await resoudreCompteImport(ctx, row);
    const email = valeurDe(row, 'email');
    let contactId: string;
    if (email) {
      const c = await ctx.ex.query<{ id: string; inserted: boolean }>(
        `insert into contacts (organization_id, first_name, last_name, email, job_title, linkedin_url, account_id, source_list_id) /* jr:sources_csv_contact_email */
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (organization_id, lower(email)) where email is not null
         do update set
           first_name = coalesce(contacts.first_name, excluded.first_name),
           last_name = coalesce(contacts.last_name, excluded.last_name),
           job_title = coalesce(contacts.job_title, excluded.job_title),
           linkedin_url = coalesce(contacts.linkedin_url, excluded.linkedin_url),
           account_id = coalesce(contacts.account_id, excluded.account_id),
           source_list_id = coalesce(contacts.source_list_id, excluded.source_list_id)
         returning id, (xmax = 0) as inserted`,
        [
          ctx.organisationId,
          valeurDe(row, 'first_name'),
          valeurDe(row, 'last_name'),
          email,
          valeurDe(row, 'job_title'),
          valeurDe(row, 'linkedin_url'),
          accountId,
          listId,
        ],
      );
      contactId = c.rows[0]!.id;
      if (c.rows[0]!.inserted) contactsNouveaux += 1;
      else dejaConnus += 1;
    } else {
      const c = await ctx.ex.query<{ id: string }>(
        `insert into contacts (organization_id, first_name, last_name, job_title, linkedin_url, account_id, source_list_id) /* jr:sources_csv_contact_sans_email */
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [
          ctx.organisationId,
          valeurDe(row, 'first_name'),
          valeurDe(row, 'last_name'),
          valeurDe(row, 'job_title'),
          valeurDe(row, 'linkedin_url'),
          accountId,
          listId,
        ],
      );
      contactId = c.rows[0]!.id;
      contactsNouveaux += 1;
    }

    await ctx.ex.query(
      `insert into list_members (list_id, contact_id, raw_row) /* jr:sources_csv_membre */ values ($1, $2, $3::jsonb)
       on conflict (list_id, contact_id) do nothing`,
      [listId, contactId, JSON.stringify(row.raw)],
    );

    await ctx.ex.query(
      `insert into enrollments (organization_id, campaign_id, contact_id, list_id, status, current_step, next_action_at, started_at) /* jr:sources_csv_inscrire */
       values ($1, $2, $3, $4, 'active', 0, now(), now())
       on conflict (contact_id) where status in ('active','paused','paused_absence') do nothing`,
      [ctx.organisationId, campagneId, contactId, listId],
    );
  }

  await ctx.ex.query(
    `insert into imports (organization_id, file_name, rows_total, rows_unique, rows_merged, mapping, status, list_id) /* jr:sources_csv_audit */
     values ($1, $2, $3, $4, $5, $6::jsonb, 'done', $7)`,
    [
      ctx.organisationId,
      fileName ?? 'import.csv',
      outcome.report.rowsTotal,
      outcome.report.rowsUnique,
      outcome.report.rowsMerged,
      JSON.stringify(mapping),
      listId,
    ],
  );

  return {
    lignesLues: outcome.report.rowsTotal,
    contactsNouveaux,
    dejaConnus,
    sansEmailValide: outcome.report.emailsMissing,
  };
}

// ---------------------------------------------------------------------------
// ajouterDepuisAnnuaire — R41 : verse des entreprises dans `accounts`
// (l'organisation), JAMAIS de contact. Reçoit les entreprises déjà trouvées
// et cochées côté écran (recherche faite par
// `apps/web/lib/directory.ts::searchCompanies`, une API publique sans état —
// hors de `packages/core`, qui ne dépend pas du web).
//
// R42 (tour de correction 1) : aucune table ne porte de lien entreprise ↔
// campagne — `campagneId` ne sert ici qu'à vérifier l'organisation, jamais à
// rattacher les comptes créés à cette campagne précise. L'écran ne doit donc
// jamais dire « ajoutées à la campagne » ou « reliées à la campagne ».
// ---------------------------------------------------------------------------

const schemaEntrepriseAnnuaire = z.object({
  siren: z.string().min(1),
  name: z.string().min(1),
  naf: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
});

export const schemaAjouterDepuisAnnuaire = z.object({
  campagneId: z.string().uuid(),
  entreprises: z.array(schemaEntrepriseAnnuaire).min(1).max(500),
});

export interface ResultatAjouterDepuisAnnuaire {
  readonly entreprisesRetenues: number;
  readonly dejaConnues: number;
}

export async function ajouterDepuisAnnuaire(
  ctx: Contexte,
  entree: unknown,
): Promise<ResultatAjouterDepuisAnnuaire> {
  exiger(ctx, 'operator');
  const { campagneId, entreprises } = valider(schemaAjouterDepuisAnnuaire, entree);
  await verifierCampagne(ctx, campagneId);

  let entreprisesRetenues = 0;
  let dejaConnues = 0;
  for (const e of entreprises) {
    const res = await ctx.ex.query<{ inserted: boolean }>(
      `insert into accounts (organization_id, name, siren, naf_code, city, postal_code, resolution_status) /* jr:sources_annuaire_upsert */
       values ($1, $2, $3, $4, $5, $6, 'resolved')
       on conflict (organization_id, siren) where siren is not null
       do update set name = coalesce(accounts.name, excluded.name)
       returning (xmax = 0) as inserted`,
      [ctx.organisationId, e.name, e.siren, e.naf, e.city, e.postalCode],
    );
    if (res.rows[0]?.inserted) entreprisesRetenues += 1;
    else dejaConnues += 1;
  }
  // Pas d'écriture au journal ici : aucune `sources` créée (R41), et l'audit
  // de chaque compte tient déjà dans `accounts.created_at`.
  return { entreprisesRetenues, dejaConnues };
}

export const schemaSirensConnus = z.object({
  sirens: z.array(z.string().min(1)).max(500),
});

/**
 * SIREN parmi ceux donnés déjà présents dans `accounts` de l'organisation —
 * pour annoter un résultat de recherche annuaire AVANT l'ajout (R42, tour de
 * correction 1) : l'écran doit pouvoir dire « déjà dans votre base » sans
 * attendre que l'opérateur clique, plutôt que de laisser croire que toute
 * ligne cochée sera une entreprise neuve.
 */
export async function sirensConnus(ctx: Contexte, entree: unknown): Promise<string[]> {
  exiger(ctx, 'viewer');
  const { sirens } = valider(schemaSirensConnus, entree);
  if (sirens.length === 0) return [];
  const res = await ctx.ex.query<{ siren: string }>(
    `select siren from accounts /* jr:sources_annuaire_connus */
      where organization_id = $1 and siren = any($2::text[])`,
    [ctx.organisationId, sirens],
  );
  return res.rows.map((r) => r.siren);
}

// ---------------------------------------------------------------------------
// ajouterDepuisListe — verse dans la campagne les contacts d'une liste déjà
// constituée (import général, `lists`/`list_members`). Ceux déjà inscrits
// ailleurs (activement) sont protégés par `enrollments_one_active_uidx` (le
// conflit ne fait rien) ; `ignorerDejaContactes` exclut en amont ceux qui ont
// ne serait-ce qu'un historique dans une autre campagne.
// ---------------------------------------------------------------------------

export interface ListeResume {
  readonly id: string;
  readonly nom: string;
  readonly nombreContacts: number;
}

/** Listes existantes de l'organisation, pour le sélecteur du tiroir « Liste existante ». */
export async function listerListesOrganisation(
  ctx: Contexte,
  _entree: unknown,
): Promise<ListeResume[]> {
  exiger(ctx, 'viewer');
  const res = await ctx.ex.query<{ id: string; name: string; n: number }>(
    `select l.id, l.name, count(lm.contact_id)::int as n /* jr:sources_listes_organisation */
       from lists l
       left join list_members lm on lm.list_id = l.id
      where l.organization_id = $1
      group by l.id, l.name
      order by l.created_at desc`,
    [ctx.organisationId],
  );
  return res.rows.map((r) => ({ id: r.id, nom: r.name, nombreContacts: r.n }));
}

export const schemaAjouterDepuisListe = z.object({
  campagneId: z.string().uuid(),
  listId: z.string().uuid(),
  seulementEmailVerifie: z.boolean().default(false),
  ignorerDejaContactes: z.boolean().default(false),
});

export async function ajouterDepuisListe(
  ctx: Contexte,
  entree: unknown,
): Promise<{ ajoutes: number }> {
  exiger(ctx, 'operator');
  const { campagneId, listId, seulementEmailVerifie, ignorerDejaContactes } = valider(
    schemaAjouterDepuisListe,
    entree,
  );
  await verifierCampagne(ctx, campagneId);

  const listeRes = await ctx.ex.query<{ id: string }>(
    `select id from lists /* jr:sources_liste_verifier */ where id = $1 and organization_id = $2`,
    [listId, ctx.organisationId],
  );
  if (listeRes.rowCount === 0) throw new ErreurIntrouvable('Liste');

  const filtreEmail = seulementEmailVerifie
    ? `and c.email_status = 'valid'`
    : `and c.email is not null`;
  const filtreDejaContacte = ignorerDejaContactes
    ? `and not exists (select 1 from enrollments e2 where e2.contact_id = c.id and e2.campaign_id <> $2)`
    : '';

  const candidats = await ctx.ex.query<{ id: string }>(
    `select c.id
       from list_members lm /* jr:sources_liste_candidats */
       join contacts c on c.id = lm.contact_id
      where lm.list_id = $1 and c.organization_id = $3
        and c.status = 'active'
        ${filtreEmail}
        ${filtreDejaContacte}`,
    [listId, campagneId, ctx.organisationId],
  );

  let ajoutes = 0;
  for (const c of candidats.rows) {
    const res = await ctx.ex.query(
      `insert into enrollments (organization_id, campaign_id, contact_id, list_id, status, current_step, next_action_at, started_at) /* jr:sources_liste_inscrire */
       values ($1, $2, $3, $4, 'active', 0, now(), now())
       on conflict (contact_id) where status in ('active','paused','paused_absence') do nothing`,
      [ctx.organisationId, campagneId, c.id, listId],
    );
    if ((res.rowCount ?? 0) > 0) ajoutes += 1;
  }
  return { ajoutes };
}
