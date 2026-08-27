/**
 * Pattern d'adresse dominant par domaine.
 *
 * Le gate de délivrabilité ne laisse passer un email `risky` — dont tous les
 * `CATCH_ALL`, très courants en entreprise — que si le domaine a un pattern
 * solide. Sans cette table alimentée, cette voie est fermée et ces contacts sont
 * tous bloqués, quel que soit leur intérêt.
 *
 * Le pattern se déduit des adresses déjà connues du domaine : la détection est
 * pure (`detectPattern`, porté du socle), on ne fait ici que rassembler les
 * échantillons et ranger le résultat.
 */
import type { Pool } from 'pg';
import { detectPattern, type EmailSample } from '@jay-reach/providers/email-validation';

/** Ce que le gate attend pour juger un email non explicitement valide. */
export interface DomainPattern {
  readonly pattern: string;
  readonly confidence: number;
  readonly tier: 'high' | 'medium' | 'low' | 'skip';
  readonly sample_count: number;
  readonly empirical_sends: number;
  readonly empirical_bounces: number;
  readonly downgraded_at: string | null;
}

/** Domaine d'une adresse, en minuscules, ou null si l'adresse est inexploitable. */
export function domainOf(email: string | null | undefined): string | null {
  const at = (email ?? '').trim().toLowerCase().lastIndexOf('@');
  if (at < 1) return null;
  const domain = (email ?? '').trim().toLowerCase().slice(at + 1);
  return domain.includes('.') ? domain : null;
}

/**
 * Recalcule le pattern d'un domaine à partir des contacts de l'organisation qui
 * y ont une adresse, et le range.
 *
 * Recalcul complet plutôt qu'incrémental : la détection pondère l'ensemble des
 * échantillons, et un pattern qui se dégrade doit pouvoir redescendre de tier.
 * Le coût est une requête sur les contacts d'un domaine, pas de quoi optimiser
 * avant d'avoir mesuré.
 *
 * Les compteurs empiriques ne sont pas touchés : ils viennent des retours
 * d'envoi, pas de la détection, et un recalcul ne doit pas effacer l'historique
 * de rebonds d'un domaine.
 */
export async function refreshDomainPattern(
  pool: Pool,
  organizationId: string,
  domain: string,
): Promise<DomainPattern | null> {
  const cible = domain.trim().toLowerCase();
  if (!cible.includes('.')) return null;

  const res = await pool.query<{ first_name: string | null; last_name: string | null; email: string | null }>(
    `select first_name, last_name, email
       from contacts
      where organization_id = $1
        and email is not null
        and lower(split_part(email, '@', 2)) = $2`,
    [organizationId, cible],
  );

  const samples: EmailSample[] = res.rows;
  const detection = detectPattern(samples);
  if (!detection.pattern) {
    // Pas de pattern dominant : on ne range rien plutôt que d'écrire un pattern
    // faible que le gate refuserait de toute façon.
    return null;
  }

  const stored = await pool.query<DomainPattern>(
    `insert into domain_patterns
       (organization_id, domain, pattern, confidence, tier, sample_count, hits,
        secondary_pattern, secondary_hits, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (organization_id, domain) do update
       set pattern = excluded.pattern,
           confidence = excluded.confidence,
           tier = excluded.tier,
           sample_count = excluded.sample_count,
           hits = excluded.hits,
           secondary_pattern = excluded.secondary_pattern,
           secondary_hits = excluded.secondary_hits,
           updated_at = now()
     returning pattern, confidence::float8 as confidence, tier, sample_count,
               empirical_sends, empirical_bounces,
               to_char(downgraded_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as downgraded_at`,
    [
      organizationId,
      cible,
      detection.pattern,
      detection.confidence,
      detection.tier,
      detection.total,
      detection.hits,
      detection.secondary?.pattern ?? null,
      detection.secondary?.hits ?? null,
    ],
  );
  return stored.rows[0] ?? null;
}

/**
 * Recalcule les patterns de plusieurs domaines. Appelé après un enrichissement :
 * de nouvelles adresses viennent d'arriver, le pattern a pu changer de tier.
 */
export async function refreshDomainPatterns(
  pool: Pool,
  organizationId: string,
  domains: readonly (string | null | undefined)[],
): Promise<number> {
  const uniques = [...new Set(domains.map((d) => d?.trim().toLowerCase()).filter((d): d is string => !!d))];
  let n = 0;
  for (const domain of uniques) {
    try {
      if (await refreshDomainPattern(pool, organizationId, domain)) n += 1;
    } catch (err) {
      // Un pattern manquant coûte un contact bloqué, pas un enrichissement perdu.
      console.warn(`[patterns] recalcul impossible pour ${domain} : ${(err as Error).message}`);
    }
  }
  return n;
}

/** Patterns des domaines demandés, pour alimenter le gate au moment du tick. */
export async function loadDomainPatterns(
  pool: Pool,
  organizationId: string,
  domains: readonly string[],
): Promise<Map<string, DomainPattern>> {
  const parDomaine = new Map<string, DomainPattern>();
  const uniques = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  if (uniques.length === 0) return parDomaine;

  const res = await pool.query<DomainPattern & { domain: string }>(
    `select domain, pattern, confidence::float8 as confidence, tier, sample_count,
            empirical_sends, empirical_bounces,
            to_char(downgraded_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as downgraded_at
       from domain_patterns
      where organization_id = $1 and domain = any($2::text[])`,
    [organizationId, uniques],
  );
  for (const row of res.rows) parDomaine.set(row.domain, row);
  return parDomaine;
}
