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
// Import interne au paquet (pas via le barrel `index.js`) : `valeurs-contact.ts`
// EST une partie de ce que le barrel réexporte, un import par le barrel ici
// créerait un cycle.
import { normalizeListColumnName } from './variables.js';

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
  /**
   * Ligne brute du CSV importé (`list_members.raw_row`), clés = en-têtes tels
   * quels. Alimente les variables `{{liste_<colonne>}}` (spec import de
   * listes). `null`/absente si l'inscription n'a pas de liste — jamais de
   * repli sur une autre liste.
   */
  readonly raw_row?: Record<string, unknown> | null;
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
  // Colonnes du CSV importé : chaque clé de `raw_row` devient
  // `liste_<colonne normalisée>` (même règle que `validateTemplateVariables`,
  // `normalizeListColumnName`). Une valeur vide, nulle ou blanche N'EST PAS
  // ajoutée — la variable reste manquante, ce qui bloque l'envoi de CE
  // contact plutôt que de partir avec un champ vide.
  if (row.raw_row) {
    // `parseCsv` garde les en-têtes sensibles à la casse (import/parse.ts) :
    // deux colonnes distinctes (« Poste », « POSTE ») peuvent normaliser vers
    // la même variable. On regroupe donc par nom de colonne AVANT d'écrire
    // dans `values`, pour départager plutôt qu'écraser silencieusement.
    const parColonne = new Map<string, string[]>();
    for (const [cle, brut] of Object.entries(row.raw_row)) {
      const colonne = normalizeListColumnName(cle);
      if (!colonne) continue; // colonne qui normalise vers une clé vide : ignorée
      // Seuls string/number/boolean se rendent en texte sans mentir : un
      // objet ou un tableau donnerait littéralement « [object Object] ».
      if (typeof brut !== 'string' && typeof brut !== 'number' && typeof brut !== 'boolean') continue;
      const texte = String(brut).trim();
      if (!texte) continue;
      const valeurs = parColonne.get(colonne);
      if (valeurs) valeurs.push(texte);
      else parColonne.set(colonne, [texte]);
    }
    for (const [colonne, valeurs] of parColonne) {
      const distinctes = new Set(valeurs);
      if (distinctes.size > 1) {
        // Colonnes homonymes qui se contredisent : impossible de choisir sans
        // deviner, donc la variable reste manquante (bloque l'envoi de CE
        // contact) plutôt que d'en retenir une arbitrairement. Jamais la
        // valeur dans le journal — un CSV RH peut contenir des données
        // personnelles.
        console.warn(`[variables] colonnes homonymes après normalisation : liste_${colonne}`);
        continue;
      }
      values[`liste_${colonne}`] = valeurs[0]!;
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
            lst.context_note,
            lm.raw_row
       from contacts c /* jr:valeurs_contact */
       left join accounts a on a.id = c.account_id
       left join personas p on p.id = c.persona_id
       left join enrollments e on e.contact_id = c.id and ($3::uuid is null or e.campaign_id = $3::uuid)
       left join campaigns camp on camp.id = e.campaign_id
       left join lists lst on lst.id = camp.list_id
       left join signals sig on sig.id = coalesce(e.signal_id, c.source_signal_id)
       -- Colonnes du CSV importé (variables liste_<colonne>) : jointe sur
       -- l'inscription elle-même, jamais sur contacts.source_list_id — un
       -- contact peut venir d'une liste et être réinscrit via une autre ;
       -- seule la liste de CETTE inscription doit nourrir son rendu. e.list_id
       -- nul (pas d'inscription retenue, ou campagne signal) laisse raw_row
       -- nul, sans repli. Même règle que la requête du worker (message-values.ts) :
       -- l'aperçu ne doit jamais diverger de l'email réellement envoyé.
       left join list_members lm on lm.list_id = e.list_id and lm.contact_id = e.contact_id
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
