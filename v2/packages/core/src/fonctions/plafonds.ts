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

/** Lit les réglages de l'organisation : ligne en base en premier, sinon l'environnement (repli numérique), sinon le défaut. */
export async function lireReglages(ctx: Contexte): Promise<Record<ClePlafond, number | string>> {
  const res = await ctx.ex.query<{ key: string; value: unknown }>(
    `select key, value from organization_settings where organization_id = $1`,
    [ctx.organisationId],
  );
  const parCle = new Map(res.rows.map((r) => [r.key, r.value]));

  const sortie = {} as Record<ClePlafond, number | string>;
  for (const { cle, defaut, env } of CLES_REGLAGES) {
    const enBase = parCle.get(cle);
    if (enBase !== undefined) {
      sortie[cle] = typeof defaut === 'number' ? Number(enBase) : String(enBase);
      continue;
    }
    if (typeof defaut === 'number' && env) {
      sortie[cle] = normaliserPlafond(process.env[env] ?? null, defaut);
      continue;
    }
    sortie[cle] = defaut;
  }
  return sortie;
}

export const schemaEcrireReglage = z.object({
  cle: z.enum(CLE_PLAFOND_VALUES),
  valeur: z.union([z.number().int().min(0), z.string().min(1)]),
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
 * Consommation du jour, pour l'écran comme pour le MCP : scoring et
 * enrichissement lus dans `provider_daily_usage` (le compteur atomique que le
 * moteur incrémente déjà via `app.consume_provider_credit`, cf.
 * `apps/worker/src/traitements.ts` et `producer.ts`) ; les envois comptés sur
 * les actions réellement parties (mêmes statuts que `chargerContraintesSender`
 * dans `apps/worker/src/handlers/sequence.ts`), plafonnés par la somme des
 * quotas des expéditeurs email actifs.
 */
export async function lireConsommationDuJour(
  ctx: Contexte,
): Promise<{ scoring: Jauge; enrichissement: Jauge; envois: Jauge }> {
  const reglages = await lireReglages(ctx);
  const fuseau = String(reglages.fuseau);

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
    scoring: { utilise: scoringRes.rows[0]?.n ?? 0, plafond: Number(reglages.scoring_par_jour) },
    enrichissement: { utilise: enrichRes.rows[0]?.n ?? 0, plafond: Number(reglages.enrichissements_par_jour) },
    envois: { utilise: envoisUtiliseRes.rows[0]?.n ?? 0, plafond: envoisPlafondRes.rows[0]?.plafond ?? 0 },
  };
}
