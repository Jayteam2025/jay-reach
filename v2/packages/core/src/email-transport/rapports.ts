/**
 * Événements typés tirés des rapports et des envois SalesBlink.
 *
 * `packages/core` ne dépend pas de `@jay-reach/providers` (le sens inverse
 * créerait un cycle) : `Rapport` et `EnvoiSorti` sont redéclarés ici avec
 * exactement les mêmes champs que le client HTTP
 * (`packages/providers/src/outreach/salesblink.ts`). Le worker passe les
 * valeurs du client directement ici, donc les noms doivent correspondre au
 * caractère près.
 */

export interface Rapport {
  id: string;
  horodatageMs: number;
  type: string;
  message: string;
  email: string | null;
  sequenceId: string | null;
  corps: string | null;
}

export interface EnvoiSorti {
  id: string;
  messageId: string | null;
  email: string;
  sequenceId: string | null;
  termine: boolean;
  termineMs: number | null;
  planifieMs: number | null;
  typeTache: 'email' | 'reply' | string;
  erreur?: string;
}

export type EvenementEmail =
  | { type: 'envoye'; email: string; sequenceId: string | null; messageId: string | null; aMs: number }
  | { type: 'repondu'; email: string; corps: string; messageId: string | null; aMs: number }
  | { type: 'rebond'; email: string; aMs: number }
  | { type: 'desinscrit'; email: string; aMs: number }
  | { type: 'erreur'; email: string; sequenceId: string | null; motif: string; aMs: number };

/** Longueur maximale d'un motif d'erreur brut, quand le corps n'est pas du JSON exploitable. */
const LONGUEUR_MAX_MOTIF = 200;

/**
 * Motif d'une erreur SalesBlink : mesuré le 11/09/2026 sur un compte réel, un
 * rapport `Error` porte dans `corps` un JSON du type
 * `{"message":"Email Sender sending disabled. Needs to reconnect."}`. On en
 * tire ce `message` interne quand il s'analyse, sinon le texte brut tronqué,
 * sinon une chaîne vide (aucun corps rapporté).
 */
function motifDepuisCorps(corps: string | null): string {
  if (corps === null) return '';
  try {
    const analyse = JSON.parse(corps) as { message?: unknown };
    if (typeof analyse.message === 'string') return analyse.message;
  } catch {
    // corps non-JSON : on retombe sur le texte brut tronqué ci-dessous.
  }
  return corps.slice(0, LONGUEUR_MAX_MOTIF);
}

/**
 * Rapports SalesBlink → événements typés. Seuls les messages `Sent`,
 * `Bounced`, `Unsubscribed` et `Error` produisent un événement ; les autres
 * (ouvertures, clics...) sont ignorés. Un rapport sans email n'a rien à quoi
 * se rattacher et ne produit pas non plus d'événement.
 */
export function evenementsDepuisRapports(rapports: Rapport[]): EvenementEmail[] {
  const evenements: EvenementEmail[] = [];
  for (const rapport of rapports) {
    if (!rapport.email) continue;
    const email = rapport.email;
    if (rapport.message === 'Sent') {
      evenements.push({
        type: 'envoye',
        email,
        sequenceId: rapport.sequenceId,
        messageId: null,
        aMs: rapport.horodatageMs,
      });
    } else if (rapport.message === 'Bounced') {
      evenements.push({ type: 'rebond', email, aMs: rapport.horodatageMs });
    } else if (rapport.message === 'Unsubscribed') {
      evenements.push({ type: 'desinscrit', email, aMs: rapport.horodatageMs });
    } else if (rapport.message === 'Error') {
      evenements.push({
        type: 'erreur',
        email,
        sequenceId: rapport.sequenceId,
        motif: motifDepuisCorps(rapport.corps),
        aMs: rapport.horodatageMs,
      });
    }
    // autre message (Opened, Clicked...) : ignoré, non actionnable ici.
  }
  return evenements;
}

/**
 * Envois sortants SalesBlink → événements `envoye`. Seules les tâches
 * `email` terminées comptent : les tâches `reply` sont traitées par le
 * worker séparément (elles ne portent pas les mêmes garanties de
 * dédoublonnage), et une tâche en erreur n'est pas partie.
 */
export function evenementsDepuisEnvois(envois: EnvoiSorti[]): EvenementEmail[] {
  const evenements: EvenementEmail[] = [];
  for (const envoi of envois) {
    if (envoi.erreur) continue;
    if (!envoi.termine) continue;
    if (envoi.typeTache !== 'email') continue;
    evenements.push({
      type: 'envoye',
      email: envoi.email,
      sequenceId: envoi.sequenceId,
      messageId: envoi.messageId,
      aMs: envoi.termineMs ?? envoi.planifieMs ?? 0,
    });
  }
  return evenements;
}

/** Prochain curseur de relève : max(aMs) + 1 parmi les événements, jamais en arrière par rapport au curseur courant. */
export function curseurSuivant(evenements: EvenementEmail[], curseurMs: number): number {
  let maxAMs = -Infinity;
  for (const ev of evenements) {
    if (ev.aMs > maxAMs) maxAMs = ev.aMs;
  }
  if (!Number.isFinite(maxAMs)) return curseurMs;
  return Math.max(curseurMs, maxAMs + 1);
}
