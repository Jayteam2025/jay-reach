/**
 * Accès à la blacklist des cabinets/intermédiaires
 * (`recruitment_agencies_blacklist`). Le worker charge le global + l'org pour le
 * pré-filtrage du scoring, et INSCRIT les cabinets détectés par le scoring
 * (auto-apprentissage), fidèlement au v1 qui avait sorti cette liste du code.
 *
 * Le worker utilise la clé de service (bypass RLS) : il DOIT donc filtrer par
 * organisation lui-même (règle CLAUDE.md #5).
 */
import type { Pool } from 'pg';
import { normalizeAgencyName } from '@jay-reach/core';

/**
 * Charge l'ensemble des noms normalisés à exclure pour une organisation :
 * le seed GLOBAL (organization_id IS NULL) + les entrées propres à l'org.
 * À passer à `passesRules` / `isRecruitmentAgency` du cœur.
 */
export async function loadRecruitmentBlacklist(pool: Pool, organizationId: string): Promise<Set<string>> {
  const res = await pool.query<{ name_normalized: string }>(
    `select name_normalized
       from public.recruitment_agencies_blacklist
      where organization_id is null or organization_id = $1`,
    [organizationId],
  );
  return new Set(res.rows.map((r) => r.name_normalized));
}

/**
 * Auto-apprentissage : le scoring a jugé cette entreprise cabinet/intermédiaire
 * (score 0 + motif). On l'ajoute à la blacklist de l'organisation. Ré-occurrence
 * du même nom → incrément de `detected_count` (signal de fiabilité, comme le v1).
 * `source = 'auto_score'`. Idempotent.
 */
export async function learnRecruitmentAgency(
  pool: Pool,
  organizationId: string,
  displayName: string,
): Promise<void> {
  const normalized = normalizeAgencyName(displayName);
  if (!normalized) return;
  await pool.query(
    `insert into public.recruitment_agencies_blacklist
       (organization_id, name_normalized, name_display, source)
     values ($1, $2, $3, 'auto_score')
     on conflict (organization_id, name_normalized) where organization_id is not null
     do update set detected_count = public.recruitment_agencies_blacklist.detected_count + 1,
                   last_detected_at = now()`,
    [organizationId, normalized, displayName],
  );
}
