/**
 * Table des valeurs de rendu d'un message pour UN contact (spec
 * `messages/variables.ts`) : partie pure (`construireValeursContact`,
 * déplacée ici depuis `apps/worker/src/handlers/message-values.ts`, R32,
 * tâche 10) et lecture (`lireValeursContact`), utilisées par le worker au
 * moment d'envoyer un email ET par `apercuEnvoi` (`fonctions/file-du-jour.ts`)
 * pour la relecture avant envoi — même logique des deux côtés, jamais deux
 * rendus qui divergent entre l'aperçu montré à l'opérateur et l'email qui
 * part réellement.
 */
import type { Executeur } from '../executeur.js';

/**
 * Champs nécessaires à `construireValeursContact`, sous-ensemble volontaire
 * de ce que porte une ligne d'inscription complète (`DueRow` du worker) —
 * une ligne qui a plus de colonnes que celles-ci lui reste assignable
 * (typage structurel), donc `buildMessageValues` (worker) peut continuer à
 * lui passer sa `DueRow` telle quelle.
 */
export interface LigneValeursContact {
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly job_title: string | null;
  readonly company_name: string | null;
  readonly city: string | null;
  readonly headcount: number | null;
  readonly persona_angle: string | null;
  readonly signal_title: string | null;
  readonly signal_location: string | null;
  readonly signal_url: string | null;
  readonly context_note: string | null;
  readonly domain: string | null;
  readonly postal_code: string | null;
  readonly country: string | null;
  readonly signal_occurred_at: string | null;
}

/**
 * Table des valeurs pour le rendu des variables d'un message, assemblée depuis le
 * contact, son compte, sa persona, le signal et la liste. Une valeur absente reste
 * `undefined` → `renderTemplate` la remonte dans `missing` (→ blocage, jamais un
 * champ vide envoyé). Dates via `Intl` (spec §90).
 */
export function construireValeursContact(
  row: LigneValeursContact,
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

export interface ValeursContact {
  readonly valeurs: Record<string, string | undefined>;
  readonly email: string | null;
  readonly nom: string;
  readonly locale: string | null;
}

interface LigneLectureValeursContact extends LigneValeursContact {
  readonly email: string | null;
  readonly locale: string | null;
}

/**
 * Lit et assemble les valeurs de rendu d'UN contact, pour l'aperçu avant
 * envoi (`apercuEnvoi`). `campagneId`, s'il est fourni, résout le signal et
 * la liste au travers de l'inscription de ce contact dans CETTE campagne
 * (le signal d'origine du contact peut différer du signal qui l'a fait
 * entrer dans une autre campagne) ; sans lui, on retombe sur le signal
 * d'origine du contact (`contacts.source_signal_id`).
 */
export async function lireValeursContact(
  ex: Executeur,
  organisationId: string,
  contactId: string,
  campagneId?: string,
): Promise<ValeursContact | null> {
  const res = await ex.query<LigneLectureValeursContact>(
    `select c.first_name, c.last_name, c.job_title, c.email, c.locale,
            a.name as company_name, a.domain, a.city, a.headcount, a.postal_code, a.country,
            p.angle as persona_angle,
            sig.title as signal_title, sig.location as signal_location, sig.url as signal_url,
            sig.occurred_at as signal_occurred_at,
            lst.context_note
       from contacts c /* jr:valeurs_contact */
       left join accounts a on a.id = c.account_id
       left join personas p on p.id = c.persona_id
       left join enrollments e on e.contact_id = c.id and ($3::uuid is null or e.campaign_id = $3::uuid)
       left join campaigns camp on camp.id = e.campaign_id
       left join lists lst on lst.id = camp.list_id
       left join signals sig on sig.id = coalesce(e.signal_id, c.source_signal_id)
      where c.id = $1 and c.organization_id = $2
      order by e.started_at desc nulls last
      limit 1`,
    [contactId, organisationId, campagneId ?? null],
  );
  const ligne = res.rows[0];
  if (!ligne) return null;

  const extraitsRes = await ex.query<{ name: string; body: string }>(
    `select name, body from message_snippets /* jr:valeurs_contact_extraits */ where organization_id = $1`,
    [organisationId],
  );
  const extraits = new Map(extraitsRes.rows.map((r) => [r.name, r.body]));

  return {
    valeurs: construireValeursContact(ligne, extraits),
    email: ligne.email,
    nom: `${ligne.first_name ?? ''} ${ligne.last_name ?? ''}`.trim() || '—',
    locale: ligne.locale,
  };
}
