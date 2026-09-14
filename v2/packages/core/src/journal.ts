/**
 * Journal d'activité écrit par le moteur (`audit_events`), lu par l'onglet
 * Activité de l'écran comme par la page Aujourd'hui (`erreursDepuisMinuit`,
 * voir `fonctions/moteur.ts`, qui compte les lignes `entity_type = 'engine'`
 * du jour).
 *
 * `diff` porte toujours les chiffres ET un libellé français prêt à afficher
 * (`libelle`, une ligne ; `detail`, une ligne optionnelle) — construits par
 * l'appelant, jamais traduits ici. Aucune donnée personnelle dedans : pour un
 * événement lié à un contact, `entityType: 'contact'` + `entityId` suffisent
 * à l'interface pour ouvrir sa fiche — jamais son nom, son adresse ou le
 * contenu d'un message.
 */
import type { Executeur } from './executeur.js';

export type ActionJournal =
  | 'source_run'
  | 'scoring_batch'
  | 'enrichment_batch'
  | 'action_sent'
  | 'action_delivered'
  | 'reply_received'
  | 'absence_detected'
  | 'engine_error'
  | 'campaign_activated'
  | 'campaign_paused';

export interface EvenementJournal {
  readonly organisationId: string;
  readonly entityType: 'source' | 'campaign' | 'contact' | 'engine' | 'sender';
  /** `null` pour un événement qui ne se rattache à aucune ligne précise (ex. `engine_error`). */
  readonly entityId: string | null;
  readonly action: ActionJournal;
  readonly diff: Record<string, unknown>;
  /**
   * Utilisateur à l'origine de l'événement — `null`/absent pour tout ce que le
   * moteur produit seul (jamais un acteur humain). Seuls les événements
   * déclenchés depuis l'écran (`campaign_activated`, `campaign_paused`)
   * portent l'utilisateur qui a agi.
   */
  readonly actorId?: string | null;
  /** Horodatage de l'événement, si différent du moment de l'écriture (sinon défaut `now()` de la base). */
  readonly occurredAt?: Date;
}

/**
 * Insère une ligne dans `audit_events`. Ne lève jamais volontairement pour un
 * cas métier : l'appelant reste responsable d'encadrer l'appel d'un
 * `try/catch` (voir CLAUDE.md interne, tâche 6) — un journal qui échoue ne
 * doit jamais faire échouer le handler qui l'appelle.
 */
export async function ecrireEvenement(ex: Executeur, e: EvenementJournal): Promise<void> {
  const valeurs = [e.organisationId, e.actorId ?? null, e.entityType, e.entityId, e.action, JSON.stringify(e.diff)];
  if (e.occurredAt) {
    await ex.query(
      `insert into audit_events (organization_id, actor_id, entity_type, entity_id, action, diff, created_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [...valeurs, e.occurredAt],
    );
    return;
  }
  await ex.query(
    `insert into audit_events (organization_id, actor_id, entity_type, entity_id, action, diff)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    valeurs,
  );
}

/** Longueur maximale d'un message d'erreur écrit en `libelle` d'un `engine_error`. */
const LONGUEUR_MAX_ERREUR_JOURNAL = 200;

/**
 * Nettoie un message d'erreur avant de l'écrire dans le journal (`engine_error`) :
 * adresses email et URLs à paramètres (`?api_key=…`, jetons de requête) jamais
 * en clair dans une table lue par tout utilisateur authentifié de
 * l'organisation, puis tronqué à 200 caractères.
 */
export function nettoyerMessageErreurJournal(message: string): string {
  const sansEmails = message.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email masqué]');
  const sansParametres = sansEmails.replace(/\b(https?:\/\/[^\s?]+)\?[^\s]*/gi, '$1?[paramètres masqués]');
  return sansParametres.slice(0, LONGUEUR_MAX_ERREUR_JOURNAL);
}
