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
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider } from './contexte.js';
import { normaliserPlafond } from '../plafonds.js';

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
      const n = valeurNumeriqueValide(brut);
      sortie[cle] = n ?? (env ? normaliserPlafond(process.env[env] ?? null, defaut) : defaut);
      continue;
    }
    sortie[cle] = valeurTexteValide(brut) ?? defaut;
  }

  // R78 (tour de correction 1, tâche 17) : `enrichissements_par_jour` a un
  // second repli historique — `credentials.config.daily_cap`, l'ancien
  // réglage v1 que lisait `enrichirMaintenant` avant ce correctif — consulté
  // SEULEMENT si la ligne `organization_settings` est absente ou invalide.
  // `parCle` est déjà en main (une seule lecture d'`organization_settings`
  // au total, même avec ce repli) : aucune requête de plus dans le cas
  // courant où l'organisation a réglé son plafond dans l'app.
  if (valeurNumeriqueValide(parCle.get('enrichissements_par_jour')) === null) {
    const credRes = await ctx.ex.query<{ config: unknown }>(
      `select config from credentials /* jr:plafond_enrichissement_credentials */
        where organization_id = $1 and provider_id = 'fullenrich'`,
      [ctx.organisationId],
    );
    const saisi = Number((credRes.rows[0]?.config as { daily_cap?: unknown } | null)?.daily_cap);
    if (Number.isFinite(saisi) && saisi >= 0) sortie.enrichissements_par_jour = saisi;
  }

  return sortie;
}

/**
 * La `valeur` doit correspondre au type attendu de la `cle` visée (un entier pour un plafond, une
 * chaîne non vide pour `fuseau`) — sinon `organization_settings` accumulerait des lignes du mauvais
 * type que `lireReglages` devrait ensuite écarter silencieusement.
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
 * appliquer le même nombre (R78, tour de correction 1 de la tâche 17).
 * Simple projection de `lireReglages` (qui porte déjà, depuis ce correctif,
 * le repli `credentials.config.daily_cap` pour cette seule clé) — pas de
 * requête en plus pour un appelant qui a déjà ses `reglages` en main.
 */
export async function plafondEnrichissementDuJour(ctx: Contexte): Promise<number> {
  const reglages = await lireReglages(ctx);
  return Number(reglages.enrichissements_par_jour);
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
 * Chaque jauge garde la fraîcheur de son propre mécanisme d'origine (scoring et
 * enrichissement : `usage_date = current_date`, en UTC comme `provider_daily_usage` ;
 * envois : le fuseau de l'organisation) — décision du coordinateur, pas une omission.
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

  const scoringRes = await ctx.ex.query<{ n: number }>(
    `select coalesce(used, 0)::int as n /* scored_today */
       from provider_daily_usage
      where organization_id = $1 and provider_id = 'anthropic' and usage_date = current_date`,
    [ctx.organisationId],
  );
  const enrichRes = await ctx.ex.query<{ n: number }>(
    `select coalesce(used, 0)::int as n /* enrich_today */
       from provider_daily_usage
      where organization_id = $1 and provider_id = 'fullenrich' and usage_date = current_date`,
    [ctx.organisationId],
  );
  const envoisUtiliseRes = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n
       from actions a
      where a.organization_id = $1
        and a.channel = 'email'
        and a.status in ('dispatched', 'delivered')
        and a.dispatched_at >= date_trunc('day', now() at time zone $2)`,
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
