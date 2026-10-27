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
import { HARD_CAP_7_DAYS } from '../linkedin/pacing.js';
import type { Executeur } from '../executeur.js';
import { enregistrerHeuresEnvoiLinkedIn, lireHeuresEnvoiLinkedIn } from '../linkedin/reglages-envoi.js';

export type ClePlafond =
  | 'scoring_par_jour'
  | 'enrichissements_par_jour'
  | 'linkedin_posts_par_jour'
  | 'linkedin_requetes_par_heure'
  | 'linkedin_personnes_par_passage'
  | 'linkedin_invitations_par_semaine'
  | 'linkedin_messages_par_semaine'
  | 'linkedin_visites_profil_par_semaine'
  | 'linkedin_fiches_post_par_jour'
  | 'linkedin_fenetre_validation_post_jours'
  | 'linkedin_releve_intervalle_min'
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
  'linkedin_visites_profil_par_semaine',
  'linkedin_fiches_post_par_jour',
  'linkedin_fenetre_validation_post_jours',
  'linkedin_releve_intervalle_min',
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
  // Les VUES DE PROFIL sont ce que LinkedIn limite le plus durement (80 à 100 par jour sans
  // Premium ni Sales Navigator, ordre de grandeur connu). Elles ne figurent ni dans les envois ni
  // dans le plafond horaire de requêtes, qui ne distingue pas une vue d'une lecture de réactions :
  // la source « changement de poste » relit des profils par roulement et pouvait en consommer
  // sans que rien l'arrête. Ce plafond compte aussi les profils que la RELÈVE des messages ouvre pour
  // résoudre l'URN d'un contact (`kind = 'resolution_profil'`) : c'est la même page vue par LinkedIn.
  // Il ne compte PAS la résolution faite par l'envoi, qui part sous le plafond d'envoi de l'action. 100 par semaine, comme le siège de Gojiberry, soit bien en deçà du
  // seuil quotidien ; pas de `HARD_CAP_7_DAYS` ici, qui ne borne que les envois.
  { cle: 'linkedin_visites_profil_par_semaine', defaut: 100, env: 'LINKEDIN_PROFILE_VIEWS_WEEKLY_CAP' },
  // Le RATTRAPAGE des fiches de post : la collecte capture déjà chaque fiche gratuitement, ce travail
  // de fond ne rouvre un post que pour une fiche restée incomplète. Chaque lecture est une page
  // LinkedIn de plus : 20 par jour est large pour un rattrapage, et très en deçà du seuil des vues.
  { cle: 'linkedin_fiches_post_par_jour', defaut: 20, env: 'LINKEDIN_POST_SHEETS_DAILY_CAP' },
  // Les jours pendant lesquels une fiche de post attend la relecture d'un humain, et pendant
  // lesquels les personnes qui ont réagi à ce post sont ÉPARGNÉES par la purge d'ancienneté.
  // 28 parce qu'il faut qu'elle DÉPASSE le délai d'ancienneté des signaux (14 par défaut) :
  // les personnes sont collectées le jour où le post est découvert, donc une fenêtre plus
  // courte les ferait effacer avant que l'opérateur ait pu valider leur post — la branche
  // d'épargne n'épargnerait jamais rien et l'écran afficherait une échéance sans effet.
  // `schemaEcrireReglage` refuse une valeur sous ce seuil, en le disant.
  { cle: 'linkedin_fenetre_validation_post_jours', defaut: 28, env: 'LINKEDIN_POST_REVIEW_WINDOW_DAYS' },
  // Intervalle entre deux relèves de la messagerie LinkedIn, en minutes. Chaque relève est une
  // requête de plus vers LinkedIn : 30 laisse une réponse visible en moins d'une heure sans
  // fréquenter la messagerie en continu. Bornes [5, 1440] posées par `schemaEcrireReglage`.
  { cle: 'linkedin_releve_intervalle_min', defaut: 30, env: 'LINKEDIN_RELEVE_INTERVAL_MIN' },
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

/** Repli de `SIGNAL_MAX_AGE_DAYS`, le même que celui du moteur (`lireAgeMaxSignalJours`). */
const AGE_MAX_SIGNAL_JOURS_PAR_DEFAUT = 14;

/**
 * Délai d'ancienneté des signaux, en jours, tel que le moteur l'applique.
 *
 * COPIE DÉLIBÉRÉE de `AGE_MAX_SIGNAL_JOURS` (`apps/worker/src/producer.ts`), et non un import :
 * `packages/core` ne dépend pas du worker, et ce délai est volontairement une constante de
 * module du moteur, globale et non réglable par organisation. Seule la VALIDATION ci-dessous en
 * a besoin — jamais le comportement, qui reste entièrement côté moteur.
 *
 * Conséquence à connaître : si `SIGNAL_MAX_AGE_DAYS` est posé sur le worker mais pas sur le
 * processus web, la validation compare à 14 alors que le moteur applique autre chose. Elle
 * refuserait alors moins qu'il ne faudrait (le moteur, lui, le dit dans ses journaux —
 * `fenetreValidationPost`). Poser la variable des deux côtés, ou ne la poser nulle part, est ce
 * qui garde les deux d'accord.
 */
function ageMaxSignalJours(): number {
  const brut = process.env.SIGNAL_MAX_AGE_DAYS;
  if (brut === undefined || brut.trim() === '') return AGE_MAX_SIGNAL_JOURS_PAR_DEFAUT;
  const valeur = Number(brut);
  return Number.isFinite(valeur) && valeur > 0 ? Math.trunc(valeur) : AGE_MAX_SIGNAL_JOURS_PAR_DEFAUT;
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
    // Les deux plafonds d'envoi LinkedIn sont rabotés par le moteur à `HARD_CAP_7_DAYS`
    // (`jugerRythme`). Sans borne ici, l'écran accepterait 400, afficherait 400, et le
    // moteur en appliquerait 200 : le réglage visible mentirait sur ce qui part, ce qui
    // est pire que pas de réglage du tout. La colonne `linkedin_settings.weekly_cap`
    // portait cette garde par un `check` ; en déménageant dans `organization_settings`,
    // elle s'était perdue.
    if (
      (entree.cle === 'linkedin_invitations_par_semaine' || entree.cle === 'linkedin_messages_par_semaine') &&
      typeof entree.valeur === 'number' &&
      entree.valeur > HARD_CAP_7_DAYS
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valeur'],
        message: `Ce plafond ne peut pas dépasser ${HARD_CAP_7_DAYS} par semaine : au-delà, le moteur appliquerait ${HARD_CAP_7_DAYS} sans le dire.`,
      });
    }
    // La fenêtre de décision d'un post doit DÉPASSER le délai d'ancienneté des signaux, sinon
    // elle ne sert à rien : les personnes qui ont réagi au post sont collectées le jour où il est
    // découvert, et la purge les efface au bout de ce délai. Une fenêtre égale ou plus courte
    // laisserait donc l'écran annoncer une échéance pendant que la purge a déjà tout emporté —
    // un mécanisme d'épargne qui n'épargne jamais rien, avec l'air de fonctionner.
    if (entree.cle === 'linkedin_fenetre_validation_post_jours' && typeof entree.valeur === 'number') {
      const anciennete = ageMaxSignalJours();
      if (entree.valeur <= anciennete) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['valeur'],
          message: `La fenêtre de validation doit dépasser le délai d'ancienneté des signaux (${anciennete} jours) : en deçà, les personnes qui ont réagi au post sont effacées avant d'avoir pu être validées.`,
        });
      }
    }
    if (entree.cle === 'linkedin_releve_intervalle_min' && typeof entree.valeur === 'number') {
      if (entree.valeur < 5 || entree.valeur > 1440) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['valeur'],
          message: "L'intervalle de relève doit être compris entre 5 et 1440 minutes.",
        });
      }
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

export type Rythme = 'prudent' | 'normal' | 'soutenu' | 'personnalise';

/**
 * Les trois crans du rythme d'envoi LinkedIn (spec §4.2) : un choix qui pose d'un coup les quatre
 * valeurs qui doivent rester cohérentes entre elles (deux plafonds hebdomadaires, la fenêtre, les
 * jours). Chaque cran reste au-dessous de `HARD_CAP_7_DAYS` et laisse au moins
 * `SEUIL_MINUTES_PAR_ACTION` minutes par action, sans quoi l'alerte « fenêtre trop étroite »
 * dénoncerait un cran que l'écran propose (test dans `plafonds.test.ts`).
 */
export const RYTHMES: Record<
  Exclude<Rythme, 'personnalise'>,
  { invitations: number; messages: number; debutHeure: number; finHeure: number; jours: number[] }
> = {
  prudent: { invitations: 50, messages: 100, debutHeure: 9, finHeure: 18, jours: [1, 2, 3, 4, 5] },
  normal: { invitations: 100, messages: 200, debutHeure: 9, finHeure: 18, jours: [1, 2, 3, 4, 5] },
  soutenu: { invitations: 150, messages: 200, debutHeure: 8, finHeure: 19, jours: [1, 2, 3, 4, 5] },
};

/** Échec d'écriture en base d'un cran ; `ecrites` = nombre d'écritures déjà réussies (0 = rien n'a changé). */
export class ErreurRythme extends Error {
  constructor(
    message: string,
    readonly ecrites: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ErreurRythme';
  }
}

const schemaRythme = z.enum(['prudent', 'normal', 'soutenu']);

/**
 * Cran correspondant aux valeurs APPLIQUÉES (`lireReglages` : base, sinon environnement, sinon
 * défaut ; `lireHeuresEnvoiLinkedIn` : base, sinon fenêtre par défaut), `personnalise` quand aucun
 * cran ne les reproduit toutes les quatre. Une organisation qui n'a rien réglé applique exactement
 * le cran « normal » et le lit donc : c'est ce qui part réellement.
 */
export async function lireRythme(ctx: Contexte): Promise<Rythme> {
  const [reglages, heures] = await Promise.all([lireReglages(ctx), lireHeuresEnvoiLinkedIn(ctx)]);
  const jours = [...heures.jours].sort((a, b) => a - b);
  for (const [nom, c] of Object.entries(RYTHMES) as [Exclude<Rythme, 'personnalise'>, (typeof RYTHMES)['normal']][]) {
    if (
      reglages.linkedin_invitations_par_semaine === c.invitations &&
      reglages.linkedin_messages_par_semaine === c.messages &&
      heures.debutHeure === c.debutHeure &&
      heures.finHeure === c.finHeure &&
      jours.length === c.jours.length &&
      jours.every((j, i) => j === c.jours[i])
    ) {
      return nom;
    }
  }
  return 'personnalise';
}

/**
 * Pose un cran : deux plafonds hebdomadaires (`organization_settings`) puis la fenêtre et les jours
 * (`linkedin_settings`), toujours explicitement, « normal » compris.
 *
 * NON atomique : trois écritures successives, sans transaction (`Contexte.ex` n'en expose pas). Le
 * rôle admin et le cran sont vérifiés AVANT la première (erreurs sèches : `ForbiddenError`,
 * `ErreurEntree`), et le fuseau est lu avant elle (dans le même `try`, donc un échec de lecture se dit « rien n'a changé »). Si une lecture ou une écriture échoue en base, une `ErreurRythme`
 * au message lisible remonte (partielle ou non, selon `ecrites`) et l'organisation garde un mélange des anciennes et des nouvelles
 * valeurs ; `lireRythme` lit alors `personnalise` (ou, par coïncidence, un cran dont les valeurs
 * se trouvent réunies), jamais un cran qui ne serait pas celui appliqué. Rejouer l'écriture répare.
 */
export async function ecrireRythme(ctx: Contexte, rythme: Exclude<Rythme, 'personnalise'>): Promise<void> {
  exiger(ctx, 'admin');
  const c = RYTHMES[valider(schemaRythme, rythme)];
  // Dès ici les échecs (lecture du fuseau comprise) viennent de la base. Le message dit à l'opérateur ce qui est vrai (rien posé,
  // ou posé en partie) et qu'il peut réessayer ; le texte brut de la base n'est jamais montré.
  let ecrites = 0;
  try {
    const { fuseau } = await lireHeuresEnvoiLinkedIn(ctx);
    await ecrireReglage(ctx, { cle: 'linkedin_invitations_par_semaine', valeur: c.invitations });
    ecrites += 1;
    await ecrireReglage(ctx, { cle: 'linkedin_messages_par_semaine', valeur: c.messages });
    ecrites += 1;
    await enregistrerHeuresEnvoiLinkedIn(ctx, { debutHeure: c.debutHeure, finHeure: c.finHeure, jours: [...c.jours], fuseau });
  } catch (cause) {
    throw new ErreurRythme(
      ecrites === 0
        ? "Le rythme n'a pas pu être enregistré : rien n'a changé. Réessayez."
        : "Le rythme n'a été appliqué qu'en partie : une partie des réglages a changé, pas tous. Réessayez pour terminer.",
      ecrites,
      { cause },
    );
  }
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
export type ClePlafondLinkedIn =
  | 'linkedin_posts_par_jour'
  | 'linkedin_requetes_par_heure'
  | 'linkedin_personnes_par_passage'
  | 'linkedin_invitations_par_semaine'
  | 'linkedin_messages_par_semaine'
  | 'linkedin_visites_profil_par_semaine'
  | 'linkedin_fiches_post_par_jour'
  | 'linkedin_fenetre_validation_post_jours'
  | 'linkedin_releve_intervalle_min';

/** Plafond LinkedIn d'une clé : même chaîne de repli que les autres (`plafondDuJour`), valeur en base d'abord. */
export async function lirePlafondLinkedIn(ctx: Contexte, cle: ClePlafondLinkedIn): Promise<number> {
  return plafondDuJour(ctx.ex, ctx.organisationId, cle);
}

/**
 * Nature d'une requête tracée. `null` (absent) = non qualifiée : toutes les requêtes d'avant la
 * colonne, et celles qui ne relèvent d'aucun plafond propre. `compterVisitesProfilLinkedIn` lit
 * 'profil' (la collecte ouvre un profil) ET 'resolution_profil' (la relève résout l'URN d'un contact :
 * même requête vers LinkedIn, donc même visite).
 */
export type KindRequeteLinkedIn = 'profil' | 'fiche' | 'messagerie' | 'resolution_profil';

/**
 * Consigne UNE requête émise vers LinkedIn, au moment où elle part. Le passage
 * doit appartenir à l'organisation : sans cette jointure, un identifiant de
 * passage d'une autre organisation serait accepté (le worker écrit avec la clé
 * de service, que la RLS ne borne pas).
 */
export async function tracerRequeteLinkedIn(ctx: Contexte, sourceRunId: string, kind?: KindRequeteLinkedIn): Promise<void> {
  const res = await ctx.ex.query(
    `insert into linkedin_requetes (organization_id, source_run_id, kind) /* jr:linkedin_requete_tracer */
     select so.organization_id, sr.id, $3::text
       from source_runs sr
       join sources so on so.id = sr.source_id
      where sr.id = $2 and so.organization_id = $1`,
    [ctx.organisationId, sourceRunId, kind ?? null],
  );
  if (res.rowCount === 0) throw new Error("Passage de collecte introuvable pour cette organisation.");
}

const KIND_MESSAGERIE: KindRequeteLinkedIn = 'messagerie';

/**
 * Consigne UNE requête de la relève de messagerie, au moment où elle part : même table, même fenêtre
 * horaire que la collecte, donc le même budget. Elle ne se rattache à aucun passage, action ni
 * fiche (`kind = 'messagerie'` est le seul cas sans origine que la contrainte accepte).
 */
export async function tracerRequeteMessagerie(ctx: Pick<Contexte, 'ex' | 'organisationId'>): Promise<void> {
  await ctx.ex.query(
    `insert into linkedin_requetes (organization_id, kind) /* jr:linkedin_messagerie_tracer */
     values ($1, $2)`,
    [ctx.organisationId, KIND_MESSAGERIE],
  );
}

const KIND_RESOLUTION_PROFIL: KindRequeteLinkedIn = 'resolution_profil';

/**
 * Consigne UNE résolution d'URN de la relève (une page de profil ouverte pour lire l'identifiant d'un
 * contact), au moment où elle part. Même table et même fenêtre horaire que la collecte, donc le même
 * budget ; et elle compte comme une VISITE DE PROFIL dans le plafond hebdomadaire
 * (`compterVisitesProfilLinkedIn`). Comme la messagerie, elle ne se rattache à aucun passage, action ni
 * fiche : `kind = 'resolution_profil'` est le second cas sans origine que la contrainte accepte.
 * L'envoi, qui résout aussi un profil, trace sa requête sous l'action (`tracerEnvoiLinkedIn`), pas ici.
 */
export async function tracerResolutionProfil(ctx: Pick<Contexte, 'ex' | 'organisationId'>): Promise<void> {
  await ctx.ex.query(
    `insert into linkedin_requetes (organization_id, kind) /* jr:linkedin_resolution_tracer */
     values ($1, $2)`,
    [ctx.organisationId, KIND_RESOLUTION_PROFIL],
  );
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
 * Consigne UNE lecture de fiche de post (le rattrapage), au moment où la page s'ouvre : même table,
 * même fenêtre horaire que la collecte, donc le même budget. Rattachée à la FICHE lue, qui doit
 * appartenir à l'organisation (même raison que `tracerRequeteLinkedIn`).
 */
export async function tracerLectureFichePost(ctx: Pick<Contexte, 'ex' | 'organisationId'>, postId: string): Promise<void> {
  const res = await ctx.ex.query(
    `insert into linkedin_requetes (organization_id, post_id, kind) /* jr:linkedin_fiche_tracer */
     select p.organization_id, p.id, 'fiche'
       from linkedin_posts p
      where p.id = $2 and p.organization_id = $1`,
    [ctx.organisationId, postId],
  );
  if (res.rowCount === 0) throw new Error("Fiche de post introuvable pour cette organisation.");
}

/** Lectures de fiche du jour (dans le fuseau de l'organisation) : ce que le plafond du jour consomme. */
export async function compterFichesPostLinkedInDuJour(
  ctx: Pick<Contexte, 'ex' | 'organisationId'>,
  jour: string,
  fuseau: string,
): Promise<number> {
  const res = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n /* jr:linkedin_fiches_du_jour */
       from linkedin_requetes
      where organization_id = $1 and kind = 'fiche'
        and requested_at >= ($2::date::timestamp at time zone $3)
        and requested_at < (($2::date + 1)::timestamp at time zone $3)`,
    [ctx.organisationId, jour, fuseau],
  );
  return res.rows[0]?.n ?? 0;
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
 * Visites de profil depuis `depuis` (inclus) : les requêtes tracées en `kind = 'profil'` (la collecte)
 * et en `kind = 'resolution_profil'` (la résolution d'URN de la relève). Même
 * principe que `compterRequetesLinkedIn` (l'horodatage de chaque requête, jamais le démarrage du
 * passage), sur une fenêtre que l'appelant fixe à sept jours glissants. Les requêtes d'avant la
 * colonne ne sont pas requalifiables et ne comptent pas.
 */
export async function compterVisitesProfilLinkedIn(ctx: Pick<Contexte, 'ex' | 'organisationId'>, depuis: Date): Promise<number> {
  const res = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n /* jr:linkedin_visites_profil_compter */
       from linkedin_requetes
      where organization_id = $1
        and kind in ('profil', 'resolution_profil')
        and requested_at >= $2`,
    [ctx.organisationId, depuis],
  );
  return res.rows[0]?.n ?? 0;
}

/**
 * Posts RÉELLEMENT OUVERTS chez LinkedIn pendant `jour` (AAAA-MM-JJ) dans `fuseau`,
 * TOUS TYPES DE SOURCE LINKEDIN CONFONDUS. Une source LinkedIn n'a pas de ligne
 * `source_providers` : le repère est `config.sourceType` (cf. `construireConfigStocke`,
 * `sources.ts`), et le préfixe `linkedin%` est le même critère que celui par lequel
 * `producer.ts` les écarte de la planification.
 *
 * Le filtre portait sur le seul `linkedin_post_engagers`, parce qu'il était le seul type
 * collecté. Ce plafond protège le COMPTE LinkedIn, pas un type de source : laisser ce
 * filtre en branchant un deuxième type le ferait échapper au plafond, c'est-à-dire
 * exactement sur la source la plus volumineuse. La borne s'écrit `::date::timestamp at time zone` : sans le cast
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
    // Somme des posts RÉELLEMENT ouverts, pas un par passage : depuis que le collecteur boucle
    // sur plusieurs posts dans un seul passage, compter les lignes laissait passer N(N+1)/2 posts
    // pour un plafond de N. `coalesce(…, 1)` ramène à un les passages antérieurs à cette colonne,
    // qui en ouvraient exactement un.
    `select coalesce(sum(coalesce(sr.posts, 1)), 0)::int as n /* jr:linkedin_posts_du_jour */
       from source_runs sr
       join sources so on so.id = sr.source_id
      where so.organization_id = $1
        and so.config->>'sourceType' like 'linkedin%'
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

/**
 * La collecte LinkedIn part-elle toute seule ?
 *
 * Faux par défaut, y compris pour une organisation qui n'a aucune ligne de réglages : ce
 * réglage fait sortir du trafic vers LinkedIn tous les jours sans que personne ne clique, et ce
 * n'est pas au produit d'en décider à la place de l'opérateur.
 *
 * Lu sur la TABLE, jamais sur une vue : une vue soumise à RLS interrogée par le pool de service
 * du worker rend zéro ligne sans lever, et le tour croirait le réglage éteint partout.
 */
export async function lireCollecteAutoLinkedIn(ctx: Contexte): Promise<boolean> {
  const res = await ctx.ex.query<{ collect_auto: boolean }>(
    `select collect_auto from linkedin_settings /* jr:linkedin_collecte_auto_lire */ where organization_id = $1`,
    [ctx.organisationId],
  );
  return res.rows[0]?.collect_auto ?? false;
}

/**
 * Allume ou éteint la collecte automatique.
 *
 * `insert … on conflict` plutôt qu'un `update` : une organisation qui n'a jamais ouvert l'écran
 * des réglages n'a pas de ligne, et un `update` n'aurait rien écrit — en rendant « enregistré »
 * à un opérateur dont le réglage n'aurait jamais pris.
 */
export async function ecrireCollecteAutoLinkedIn(ctx: Contexte, actif: boolean): Promise<void> {
  exiger(ctx, 'admin');
  await ctx.ex.query(
    `insert into linkedin_settings (organization_id, collect_auto) /* jr:linkedin_collecte_auto_ecrire */
     values ($1, $2)
     on conflict (organization_id) do update set collect_auto = excluded.collect_auto, updated_at = now()`,
    [ctx.organisationId, actif],
  );
}
