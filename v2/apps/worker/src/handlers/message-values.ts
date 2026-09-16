/**
 * Table des valeurs de rendu des messages et résolution des gabarits par
 * langue. Partagées entre l'avancement des inscriptions (`tickDueEnrollments`,
 * qui rend les canaux dont Jay Reach possède le corps : LinkedIn, courrier) et
 * l'envoi effectif d'un email par SalesBlink, qui recharge la ligne d'une
 * inscription précise au moment d'envoyer plutôt que de porter un corps déjà
 * rendu depuis le tick jusqu'à la file de dispatch.
 */
import type { Pool } from 'pg';
import { normalizeListColumnName } from '@jay-reach/core';
import type { EmailStatus } from '../enrichment-persist.js';

export interface DueRow {
  readonly id: string;
  readonly organization_id: string;
  readonly campaign_id: string;
  readonly contact_id: string;
  readonly signal_id: string | null;
  readonly current_step: number;
  readonly linkedin_url: string | null;
  readonly email: string | null;
  readonly email_status: EmailStatus | null;
  readonly account_id: string | null;
  readonly persona_id: string | null;
  readonly approval_policy: unknown;
  /** Arrêt global des envois de l'organisation (garde-fou prioritaire). */
  readonly sending_paused_at: string | null;
  readonly lk_mode: 'auto' | 'hybrid' | 'manual' | null;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly company_name: string | null;
  readonly domain: string | null;
  // Résolution des variables du message (T19) : langue du contact + données
  // source pour substituer {{prenom}}, {{entreprise}}, {{signal_titre}}, etc.
  readonly locale: string | null;
  readonly job_title: string | null;
  readonly city: string | null;
  readonly headcount: number | null;
  readonly persona_angle: string | null;
  readonly signal_title: string | null;
  readonly signal_occurred_at: string | null;
  readonly signal_location: string | null;
  readonly signal_url: string | null;
  readonly postal_code: string | null;
  readonly country: string | null;
  readonly context_note: string | null;
  /**
   * Ligne brute du CSV importé (`list_members.raw_row`), clés = en-têtes tels
   * quels. Alimente les variables `{{liste_<colonne>}}` (spec import de
   * listes). `null` si l'inscription n'a pas de liste (`enrollments.list_id`
   * nul, ex. campagne signal) — jamais de repli sur une autre liste.
   */
  readonly raw_row: Record<string, unknown> | null;
}

/**
 * Corps commun de `DueRow`, sans le `where`/`order`/`limit` : le tick (lot
 * d'inscriptions dues) et le rechargement d'une inscription précise pour
 * l'envoi email en partagent les jointures, pour qu'un champ ajouté un jour à
 * l'un ne se retrouve pas silencieusement absent de l'autre.
 */
export const REQUETE_LIGNE_INSCRIPTION = `
  select e.id, e.organization_id, e.campaign_id, e.contact_id, e.signal_id, e.current_step,
         c.linkedin_url, c.email, c.email_status, c.account_id, c.persona_id, c.first_name, c.last_name,
         c.locale, c.job_title,
         camp.approval_policy,
         org.sending_paused_at,
         a.name as company_name, a.domain, a.city, a.headcount,
         a.postal_code, a.country,
         p.angle as persona_angle,
         sig.title as signal_title, sig.occurred_at as signal_occurred_at, sig.location as signal_location,
         sig.url as signal_url,
         lst.context_note,
         ls.mode as lk_mode,
         lm.raw_row
    from enrollments e
    join contacts c on c.id = e.contact_id
    join campaigns camp on camp.id = e.campaign_id
    join organizations org on org.id = e.organization_id
    left join accounts a on a.id = c.account_id
    left join personas p on p.id = c.persona_id
    left join signals sig on sig.id = e.signal_id
    left join lists lst on lst.id = camp.list_id
    left join linkedin_settings ls on ls.organization_id = e.organization_id
    -- Colonnes du CSV importé (variables liste_<colonne>) : jointe sur
    -- l'inscription elle-même, jamais sur contacts.source_list_id — un
    -- contact peut venir d'une liste et être réinscrit via une autre ; seule
    -- la liste de CETTE inscription doit nourrir son rendu. e.list_id nul
    -- (campagne signal) laisse raw_row nul, sans repli.
    left join list_members lm on lm.list_id = e.list_id and lm.contact_id = e.contact_id
`;

/**
 * Recharge la ligne d'UNE inscription précise (par opposition au lot des
 * inscriptions dues du tick) : c'est ce que fait l'envoi email au moment de
 * partir, puisque la file de dispatch ne porte que des identifiants, jamais
 * un corps déjà rendu.
 */
export async function chargerLigneInscription(pool: Pool, enrollmentId: string): Promise<DueRow | null> {
  const res = await pool.query<DueRow>(`${REQUETE_LIGNE_INSCRIPTION} where e.id = $1`, [enrollmentId]);
  return res.rows[0] ?? null;
}

/**
 * Table des valeurs pour le rendu des variables d'un message, assemblée depuis le
 * contact, son compte, sa persona, le signal et la liste. Une valeur absente reste
 * `undefined` → `renderTemplate` la remonte dans `missing` (→ blocage, jamais un
 * champ vide envoyé). Dates via `Intl` (spec §90).
 */
export function buildMessageValues(
  row: DueRow,
  /** Extraits de l'organisation, résolus comme des variables. */
  extraits: ReadonlyMap<string, string> = new Map(),
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {
    prenom: row.first_name ?? undefined,
    // Porte le cas que `prenom` refuse d'affronter : sans prénom connu, on
    // salue quand même, au lieu de bloquer l'envoi.
    salutation: row.first_name ? `Bonjour ${row.first_name}` : 'Bonjour',
    nom: row.last_name ?? undefined,
    poste: row.job_title ?? undefined,
    entreprise: row.company_name ?? undefined,
    ville: row.city ?? undefined,
    effectif: row.headcount != null ? String(row.headcount) : undefined,
    persona_angle: row.persona_angle ?? undefined,
    signal_titre: row.signal_title ?? undefined,
    signal_zone: row.signal_location ?? undefined,
    lien_offre: row.signal_url ?? undefined,
    contexte: row.context_note ?? undefined,
    site: row.domain ?? undefined,
    // Le département se lit sur les deux premiers chiffres du code postal.
    departement: row.postal_code ? row.postal_code.slice(0, 2) : undefined,
    pays: row.country ?? undefined,
  };
  // Colonnes du CSV importé : chaque clé de `raw_row` devient
  // `liste_<colonne normalisée>` (même règle que `validateTemplateVariables`,
  // `normalizeListColumnName`). Une valeur vide, nulle ou blanche N'EST PAS
  // ajoutée — la variable reste manquante, ce qui bloque l'envoi de CE
  // contact plutôt que de partir avec un champ vide.
  if (row.raw_row) {
    for (const [cle, brut] of Object.entries(row.raw_row)) {
      const colonne = normalizeListColumnName(cle);
      if (!colonne) continue; // colonne qui normalise vers une clé vide : ignorée
      if (brut === null || brut === undefined) continue;
      const texte = String(brut).trim();
      if (!texte) continue;
      values[`liste_${colonne}`] = texte;
    }
  }
  // Les extraits en dernier : leur valeur vient de l'organisation, et l'on ne
  // veut pas qu'un extrait nommé « prenom » masque le prospect.
  for (const [nom, texte] of extraits) {
    if (!(nom in values)) values[nom] = texte;
  }
  if (row.signal_occurred_at) {
    const d = new Date(row.signal_occurred_at);
    values.signal_date = d.toLocaleDateString('fr-FR');
    values.signal_mois = d.toLocaleDateString('fr-FR', { month: 'long' });
  }
  return values;
}

export interface TemplateResolu {
  readonly id: string | null;
  readonly body: string | null;
  readonly subject: string | null;
  /** Nom du gabarit — repli quand `subject` est nul (email SalesBlink). */
  readonly name: string | null;
  readonly missingLocale: boolean;
}

/**
 * Résout la variante de template pour la langue du contact (T19). Choisit la
 * dernière version de la famille pour cette `locale`. Si la langue est connue mais
 * qu'aucune variante n'existe alors que la famille en a d'autres → `missingLocale`
 * (spec §84-88 : bloqué `missing_locale`). Sans locale connue, on prend la dernière
 * version (repli, pas de blocage de langue).
 */
export async function resolveTemplate(pool: Pool, familyId: string, locale: string | null): Promise<TemplateResolu> {
  if (locale) {
    // Version EN VIGUEUR (`is_active`) pour cette langue — permet le retour arrière
    // (une version antérieure réactivée prime sur une plus récente désactivée).
    const byLocale = await pool.query<{ id: string; body: string; subject: string | null; name: string }>(
      `select id, body, subject, name from message_templates
        where (id = $1 or parent_id = $1) and locale = $2 and is_active
        order by version desc limit 1`,
      [familyId, locale],
    );
    const found = byLocale.rows[0];
    if (found) {
      return { id: found.id, body: found.body, subject: found.subject, name: found.name, missingLocale: false };
    }
    const any = await pool.query(
      `select 1 from message_templates where id = $1 or parent_id = $1 limit 1`,
      [familyId],
    );
    return { id: null, body: null, subject: null, name: null, missingLocale: (any.rowCount ?? 0) > 0 };
  }
  const latest = await pool.query<{ id: string; body: string; subject: string | null; name: string }>(
    `select id, body, subject, name from message_templates
      where (id = $1 or parent_id = $1) and is_active order by version desc limit 1`,
    [familyId],
  );
  const found = latest.rows[0];
  return {
    id: found?.id ?? null,
    body: found?.body ?? null,
    subject: found?.subject ?? null,
    name: found?.name ?? null,
    missingLocale: false,
  };
}

/**
 * Extraits réutilisables, par organisation.
 *
 * Chargés avec le lot plutôt qu'à chaque message : ils ne dépendent pas du
 * prospect, et les relire par action coûterait une requête pour rien.
 */
export async function loadSnippets(
  pool: Pool,
  organizationIds: string[],
): Promise<Map<string, Map<string, string>>> {
  const parOrg = new Map<string, Map<string, string>>();
  if (organizationIds.length === 0) return parOrg;
  const res = await pool.query<{ organization_id: string; name: string; body: string }>(
    'select organization_id, name, body from message_snippets where organization_id = any($1::uuid[])',
    [organizationIds],
  );
  for (const r of res.rows) {
    const m = parOrg.get(r.organization_id) ?? new Map<string, string>();
    m.set(r.name, r.body);
    parOrg.set(r.organization_id, m);
  }
  return parOrg;
}
