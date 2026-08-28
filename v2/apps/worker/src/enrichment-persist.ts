/**
 * Persistance de l'enrichissement sur le NOUVEAU schéma (accounts / contacts).
 * On réutilise le vrai moteur FullEnrich (appels API) mais on réécrit ici la
 * couche base : le code legacy pointait sur d'anciennes tables (enrichment_cache,
 * domain_email_patterns…). Ici, tout atterrit dans accounts.enrichment /
 * contacts (+ colonnes email/email_status/email_confidence) du cahier des charges.
 */
import type { Pool } from 'pg';

/**
 * Verdict de délivrabilité stocké dans `contacts.email_status`, et lu par le gate.
 * Défini une seule fois : la même liste vivait en double dans le tick, où elle a
 * divergé de l'enum en base après l'ajout de `disposable` et `role`.
 */
export type EmailStatus = 'unknown' | 'valid' | 'risky' | 'invalid' | 'disposable' | 'role';

/** Statut brut FullEnrich → enum email_status du schéma + confiance numérique. */
const STATUS_MAP: Record<string, EmailStatus> = {
  DELIVERABLE: 'valid',
  VALID: 'valid',
  CATCH_ALL: 'risky',
  RISKY: 'risky',
  DEDUCED_HIGH: 'risky',
  DEDUCED_MEDIUM: 'risky',
  UNDELIVERABLE: 'invalid',
  INVALID: 'invalid',
  UNKNOWN: 'unknown',
};

const CONFIDENCE: Record<EmailStatus, number> = {
  valid: 0.9,
  risky: 0.5,
  role: 0.3,
  disposable: 0.1,
  invalid: 0.1,
  unknown: 0.2,
};

export function mapEmailStatus(raw: string | null | undefined): { status: EmailStatus; confidence: number } {
  const status = (raw && STATUS_MAP[raw.toUpperCase()]) || 'unknown';
  return { status, confidence: CONFIDENCE[status] };
}

export interface CompanyEnrichment {
  readonly domain?: string | null;
  readonly headcount?: number | null;
  readonly linkedinUrl?: string | null;
  readonly city?: string | null;
  readonly industry?: string | null;
  /** Identifiant canonique FullEnrich de l'entreprise. */
  readonly providerId?: string | null;
  readonly matchScore?: number | null;
}

/**
 * Écrit l'enrichissement firmographique sur le compte. Le domaine est soumis à
 * un index unique (org, domain) : en cas de collision (un autre compte a déjà
 * ce domaine), on garde le reste de l'enrichissement sans écraser le domaine.
 */
export async function persistCompanyEnrichment(
  pool: Pool,
  organizationId: string,
  accountId: string,
  e: CompanyEnrichment,
): Promise<void> {
  const enrichment = JSON.stringify({
    industry: e.industry ?? null,
    providerId: e.providerId ?? null,
    matchScore: e.matchScore ?? null,
  });
  try {
    await pool.query(
      `update accounts set
          domain = coalesce($3, domain),
          headcount = coalesce($4, headcount),
          linkedin_url = coalesce($5, linkedin_url),
          city = coalesce($6, city),
          enrichment = $7::jsonb,
          enriched_at = now()
        where id = $1 and organization_id = $2`,
      [accountId, organizationId, e.domain ?? null, e.headcount ?? null, e.linkedinUrl ?? null, e.city ?? null, enrichment],
    );
  } catch (err) {
    // 23505 = violation d'unicité (org, domain) : on réécrit sans le domaine.
    if ((err as { code?: string }).code === '23505') {
      await pool.query(
        `update accounts set
            headcount = coalesce($3, headcount),
            linkedin_url = coalesce($4, linkedin_url),
            city = coalesce($5, city),
            enrichment = $6::jsonb,
            enriched_at = now()
          where id = $1 and organization_id = $2`,
        [accountId, organizationId, e.headcount ?? null, e.linkedinUrl ?? null, e.city ?? null, enrichment],
      );
      return;
    }
    throw err;
  }
}

export interface EnrichedContact {
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly jobTitle?: string | null;
  readonly email: string | null;
  /** Statut brut FullEnrich (DELIVERABLE, CATCH_ALL…). */
  readonly emailStatusRaw?: string | null;
  readonly linkedinUrl?: string | null;
  readonly linkedinProviderId?: string | null;
  readonly personaId?: string | null;
  readonly sourceSignalId?: string | null;
}

/**
 * Insère/actualise un contact enrichi. On ne persiste QUE les contacts avec un
 * email (le but de l'enrichissement) : dédup propre via l'index unique
 * (org, lower(email)). Retourne l'id du contact, ou null si pas d'email.
 */
export async function persistEnrichedContact(
  pool: Pool,
  organizationId: string,
  accountId: string,
  c: EnrichedContact,
  verified?: { status: EmailStatus; confidence: number } | null,
): Promise<string | null> {
  if (!c.email) {
    return null;
  }
  // Une vérification directe (Reoon) prime sur le statut déclaratif de
  // FullEnrich : le premier a interrogé le serveur de messagerie, le second
  // rapporte ce qu'il croit savoir.
  const { status, confidence } = verified ?? mapEmailStatus(c.emailStatusRaw);
  const res = await pool.query<{ id: string }>(
    `insert into contacts
       (organization_id, account_id, persona_id, first_name, last_name, job_title,
        email, email_status, email_confidence, linkedin_url, linkedin_provider_id,
        enrichment, enriched_at, source_signal_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8::email_status, $9, $10, $11, $12::jsonb, now(), $13)
     on conflict (organization_id, lower(email)) where email is not null
     do update set
        account_id = coalesce(excluded.account_id, contacts.account_id),
        persona_id = coalesce(excluded.persona_id, contacts.persona_id),
        first_name = coalesce(excluded.first_name, contacts.first_name),
        last_name = coalesce(excluded.last_name, contacts.last_name),
        job_title = coalesce(excluded.job_title, contacts.job_title),
        email_status = excluded.email_status,
        email_confidence = excluded.email_confidence,
        linkedin_url = coalesce(excluded.linkedin_url, contacts.linkedin_url),
        linkedin_provider_id = coalesce(excluded.linkedin_provider_id, contacts.linkedin_provider_id),
        enriched_at = now()
     returning id`,
    [
      organizationId,
      accountId,
      c.personaId ?? null,
      c.firstName ?? null,
      c.lastName ?? null,
      c.jobTitle ?? null,
      c.email,
      status,
      confidence,
      c.linkedinUrl ?? null,
      c.linkedinProviderId ?? null,
      JSON.stringify({ emailStatusRaw: c.emailStatusRaw ?? null }),
      c.sourceSignalId ?? null,
    ],
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Aligne le domaine du compte sur celui des adresses réellement trouvées.
 *
 * Le domaine renvoyé par le provider n'est pas toujours celui des courriels :
 * Léa Nature ressort en `recrutement-leanature.com`, son site de recrutement,
 * alors que ses adresses sont en `@leanature.com`. Constaté en recette le
 * 2026-08-28 — la recherche de contacts par domaine échouait, et le champ
 * `website` envoyé à Smartlead pointait au mauvais endroit.
 *
 * On retient le domaine MAJORITAIRE des contacts du compte : une adresse
 * personnelle isolée (gmail, yahoo) ne doit pas emporter la décision. Les
 * courriels sont une observation, le domaine du provider une supposition.
 *
 * Retourne le domaine retenu, ou null si rien n'a changé.
 */
export async function alignAccountDomainOnContacts(
  pool: Pool,
  organizationId: string,
  accountId: string,
): Promise<string | null> {
  const res = await pool.query<{ domaine: string; n: number }>(
    `select lower(split_part(email, '@', 2)) as domaine, count(*)::int as n
       from contacts
      where organization_id = $1 and account_id = $2 and email is not null
      group by 1 order by n desc, domaine asc limit 1`,
    [organizationId, accountId],
  );
  const majoritaire = res.rows[0]?.domaine;
  if (!majoritaire || !majoritaire.includes('.')) return null;

  try {
    const maj = await pool.query(
      `update accounts set domain = $3
        where id = $1 and organization_id = $2 and domain is distinct from $3`,
      [accountId, organizationId, majoritaire],
    );
    return (maj.rowCount ?? 0) > 0 ? majoritaire : null;
  } catch (err) {
    // 23505 : un autre compte de l'organisation porte déjà ce domaine. On garde
    // celui du provider plutôt que d'écraser une correspondance existante.
    if ((err as { code?: string }).code === '23505') {
      console.warn(`[enrich] domaine ${majoritaire} déjà pris par un autre compte — inchangé`);
      return null;
    }
    throw err;
  }
}
