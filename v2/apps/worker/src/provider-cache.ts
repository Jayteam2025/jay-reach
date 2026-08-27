/**
 * Cache des réponses de providers facturés à l'appel, adossé à `provider_cache`.
 *
 * Le moteur d'enrichissement porté du socle actuel parle à un client Supabase
 * (`SupabaseLike`) et nomme la table `enrichment_cache` en dur. Le worker, lui,
 * parle à Postgres via `pg`, et la table du v2 s'appelle `provider_cache` — celle
 * du socle existe déjà sous l'ancien nom, sans `organization_id`.
 *
 * Plutôt que de retoucher un moteur éprouvé (CLAUDE.md : migrer, ne pas réécrire),
 * on lui présente ici l'interface qu'il attend et on traduit : le nom de table, le
 * dialecte, et le cloisonnement par organisation qu'il ne connaît pas.
 *
 * Un cache ne doit jamais faire échouer ce qu'il accélère : toute erreur est
 * journalisée et traitée comme un miss, l'appel provider a lieu normalement.
 */
import type { Pool } from 'pg';
import type { SupabaseLike } from '@jay-reach/providers/enrichment';

/** Le moteur porté connaît ce nom ; il désigne `provider_cache` côté v2. */
const TABLE_ATTENDUE = 'enrichment_cache';

interface LigneCache {
  readonly data: unknown;
  readonly expires_at: string | null;
}

/**
 * Adaptateur `SupabaseLike` pour une organisation donnée. Chaque instance est liée
 * à une organisation : le cloisonnement ne dépend pas de l'appelant, qui n'a aucun
 * moyen de lire les entrées d'une autre organisation même s'il le voulait.
 */
export function providerCache(pool: Pool, organizationId: string): SupabaseLike {
  return {
    from(table: string) {
      if (table !== TABLE_ATTENDUE) {
        // Le moteur ne devrait interroger que cette table. Si un portage futur en
        // vise une autre, mieux vaut un miss bruyant qu'une lecture silencieuse
        // dans la mauvaise table.
        console.warn(`[cache] table inattendue « ${table} » — traité comme un miss`);
      }
      return {
        select(_cols: string) {
          const filtres: Record<string, string> = {};
          // Le moteur enchaîne deux `.eq` (cache_type puis cache_key). On accumule
          // les filtres par nom plutôt que par position : l'ordre n'est pas un
          // contrat, et une inversion passerait inaperçue.
          const etage = {
            eq(col: string, val: string) {
              filtres[col] = val;
              return {
                ...etage,
                async maybeSingle(): Promise<{ data: LigneCache | null; error: unknown }> {
                  try {
                    const res = await pool.query<LigneCache>(
                      `select data, expires_at from provider_cache
                        where organization_id = $1 and cache_type = $2 and cache_key = $3`,
                      [organizationId, filtres.cache_type ?? '', filtres.cache_key ?? ''],
                    );
                    return { data: res.rows[0] ?? null, error: null };
                  } catch (err) {
                    console.warn(`[cache] lecture impossible : ${(err as Error).message}`);
                    return { data: null, error: null };
                  }
                },
              };
            },
          };
          return etage;
        },
        async upsert(
          values: Record<string, unknown>,
          _options?: { onConflict?: string },
        ): Promise<{ error: unknown }> {
          try {
            await pool.query(
              `insert into provider_cache (organization_id, cache_type, cache_key, data, expires_at)
               values ($1, $2, $3, $4::jsonb, $5)
               on conflict (organization_id, cache_type, cache_key) do update
                 set data = excluded.data, expires_at = excluded.expires_at, updated_at = now()`,
              [
                organizationId,
                String(values.cache_type ?? ''),
                String(values.cache_key ?? ''),
                JSON.stringify(values.data ?? {}),
                String(values.expires_at ?? new Date().toISOString()),
              ],
            );
            return { error: null };
          } catch (err) {
            // Ne pas propager : rater une écriture de cache coûte un appel de plus
            // la prochaine fois, faire échouer l'enrichissement coûte le contact.
            console.warn(`[cache] écriture impossible : ${(err as Error).message}`);
            return { error: null };
          }
        },
      };
    },
  };
}

/**
 * Supprime les entrées périmées. Appelé par le worker au démarrage puis
 * périodiquement : sans ça, la table grossit indéfiniment avec des lignes que
 * personne ne lira plus (le moteur écarte déjà celles qui ont expiré).
 */
export async function purgeExpiredCache(pool: Pool): Promise<number> {
  try {
    const res = await pool.query(`delete from provider_cache where expires_at < now()`);
    return res.rowCount ?? 0;
  } catch (err) {
    console.warn(`[cache] purge impossible : ${(err as Error).message}`);
    return 0;
  }
}
