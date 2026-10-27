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
  | 'campaign_paused'
  // Actions d'opérateur sur un envoi de la file du jour (tâche 10,
  // `fonctions/file-du-jour.ts`) : report, écart d'une campagne, validation
  // et rejet d'un envoi en attente d'approbation. Pas encore repris dans
  // `ACTIONS_PAR_FILTRE`/`conditionTout` de `listerActivite` (campagnes.ts) —
  // ces événements n'apparaissent donc pas encore dans l'onglet Activité,
  // limite connue à traiter par la tâche qui possède cette fonction.
  | 'action_rescheduled'
  | 'action_skipped'
  | 'action_approved'
  | 'action_rejected'
  // Relance d'un envoi échoué (R34, tour de correction 1).
  | 'action_retried'
  // Actions d'opérateur sur une source (tâche 11, `fonctions/sources.ts`) :
  // création, modification, activation/désactivation et demande de passage
  // immédiat. Même limite que `action_rescheduled` et consorts ci-dessus :
  // pas encore repris dans `ACTIONS_PAR_FILTRE`/`conditionTout` de
  // `listerActivite` (campagnes.ts), qui ne matche pour `entity_type =
  // 'source'` que l'action `source_run` écrite par le worker — ces
  // événements n'apparaissent donc pas encore dans l'onglet Activité.
  | 'source.created'
  | 'source.updated'
  | 'source.toggled'
  | 'source.run_requested'
  // Actions d'opérateur sur la séquence d'une campagne (tâche 12,
  // `fonctions/sequence.ts`) : écriture/suppression d'une étape, envoi d'un
  // test. Même limite que `source.*` ci-dessus : pas encore repris dans
  // `listerActivite` (campagnes.ts).
  | 'step.saved'
  | 'step.deleted'
  | 'step.test_sent'
  // Réponse envoyée depuis la Réception (tâche 16, `fonctions/reception.ts`) —
  // distinct de `reply_received` (une réponse REÇUE, posée par la relève).
  | 'reply_sent'
  // Actions d'opérateur sur la fiche d'un contact (tâche 17,
  // `fonctions/contacts.ts`) : note ajoutée, contact marqué « ne plus
  // contacter ». Même limite que `source.*`/`step.*` ci-dessus : pas encore
  // repris dans `listerActivite` (campagnes.ts).
  | 'contact.note_added'
  | 'contact.marked_do_not_contact'
  // Exclusion AUTOMATIQUE posée par une réponse humaine (`inbox/exclusion-sur-reponse.ts`), sans acteur.
  | 'contact.excluded_after_reply'
  // Pause d'envoi globale de l'organisation (tâche 23, `fonctions/moteur.ts`,
  // `basculerPauseEnvoi`) — distincte de `campaign_paused` (une seule
  // campagne) : celle-ci coupe tous les canaux de toutes les campagnes.
  // Écrite avec `entityType: 'engine'`, `entityId: null` (aucune ligne
  // précise, même bucket que `engine_error`).
  | 'sending_paused'
  | 'sending_resumed'
  // Reprise d'une inscription en pause par l'opérateur (tâche 29, lot 2,
  // `fonctions/sequence.ts::reprendreInscription`) — `audit_events.action`
  // est `text not null`, sans enum ni `check` (`20260817120000_init_schema.sql`) :
  // aucune migration n'est nécessaire pour cette nouvelle valeur.
  | 'enrollment_resumed'
  // Mise en pause d'une inscription par le MOTEUR (tour de correction 5, point 3,
  // fil d'activité) — `mettreInscriptionEnPause` (worker, `handlers/sequence.ts`),
  // gate de délivrabilité ou échec définitif d'un envoi. Distincte
  // d'`enrollment_resumed` (reprise par un opérateur) : symétrique côté
  // écriture, jamais écrite jusqu'ici, ce qui laissait le fil d'activité muet
  // sur les pauses malgré des inscriptions réellement mises en pause.
  | 'enrollment_paused'
  // Connexion du compte LinkedIn depuis l'écran (lot 5, `fonctions/linkedin-connexion.ts` et
  // `apps/worker/src/linkedin/traiter-connexion.ts`). Jamais un secret dans `diff` : qui, quand, quel résultat.
  | 'linkedin.connexion_demandee'
  | 'linkedin.connexion_annulee'
  | 'linkedin.connexion_terminee'
  | 'linkedin.deconnexion_demandee'
  | 'linkedin.deconnexion_terminee'
  | 'linkedin.expediteur_compte_change';

/**
 * Événements dont le texte n'est PAS stocké : `diff` porte un `code` et ses `parametres`, l'écran les traduit
 * (`campagne.fiche.historique.codes.<code>` dans `packages/i18n`, fr/en/nl). Les événements plus anciens gardent
 * leur `diff.libelle` français, affiché tel quel en repli (#181). Un code absent de cette liste est ignoré à la lecture.
 */
export const CODES_EVENEMENT = ['linkedin_message_saute'] as const;
export type CodeEvenement = (typeof CODES_EVENEMENT)[number];
export type ParametresEvenement = Readonly<Record<string, string | number>>;

/**
 * Lit le code d'un `audit_events.diff` : `{ code, parametres }` si le diff porte un code CONNU et des paramètres
 * scalaires, `null` sinon (événement ancien en texte libre, code inconnu : l'appelant retombe sur `libelle`).
 */
export function lireCodeEvenement(diff: unknown): { code: CodeEvenement; parametres: ParametresEvenement } | null {
  if (typeof diff !== 'object' || diff === null) return null;
  const { code, parametres } = diff as { code?: unknown; parametres?: unknown };
  const connu = CODES_EVENEMENT.find((c) => c === code);
  if (!connu) return null;
  const lus: Record<string, string | number> = {};
  if (typeof parametres === 'object' && parametres !== null) {
    for (const [cle, valeur] of Object.entries(parametres)) {
      if (typeof valeur === 'string' || typeof valeur === 'number') lus[cle] = valeur;
    }
  }
  return { code: connu, parametres: lus };
}

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

/**
 * Journalise une erreur de CYCLE du moteur (`produire`/`produireTick` dans
 * `apps/worker/src/index.ts`), pas une erreur métier déjà rattachée à une
 * organisation (celles-là passent par `ecrireEvenement` directement, comme
 * `traiterDiscover`). Une erreur de cycle n'a pas d'organisation propre — le
 * moteur est mono-instance — donc on écrit un `engine_error` pour chaque
 * organisation existante : c'est ce qui alimente `erreursDepuisMinuit` par
 * organisation (`fonctions/moteur.ts`) sans changer le schéma d'`audit_events`
 * (`organization_id` reste `NOT NULL`).
 *
 * `contexte` (« cycle de production », « tick ») distingue dans `diff.detail`
 * quel minuteur a échoué. Tour de correction 1, R23. N'échoue jamais : un
 * journal qui échoue ne doit jamais faire tomber le worker.
 */
export async function journaliserErreurMoteur(ex: Executeur, erreur: Error, contexte?: string): Promise<void> {
  try {
    const organisations = await ex.query<{ id: string }>('select id from organizations');
    const libelle = nettoyerMessageErreurJournal(erreur.message);
    for (const organisation of organisations.rows) {
      await ecrireEvenement(ex, {
        organisationId: organisation.id,
        entityType: 'engine',
        entityId: null,
        action: 'engine_error',
        diff: contexte ? { libelle, detail: contexte } : { libelle },
      });
    }
  } catch (err) {
    console.warn('[journal] engine_error (cycle)', err);
  }
}
