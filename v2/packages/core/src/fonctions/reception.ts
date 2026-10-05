/**
 * Fonctions métier de la Réception (tâche 16, lot 2) : liste des fils par
 * filtre, lecture d'un fil (contact, campagne, boîte liée, messages), envoi
 * d'une réponse et les deux marqueurs manuels (traité, intérêt). Spec « une
 * fonction, deux façades » : l'écran (`apps/web/app/actions/inbox.ts`) et le
 * futur serveur MCP (#100) appellent les mêmes fonctions avec le même
 * `Contexte`.
 *
 * `repondre` ne parle jamais directement à SalesBlink ou Microsoft Graph :
 * elle délègue tout le choix de transport et l'envoi à `repondreAuFil`
 * (`../inbox/repondre-au-fil.js`, lot 3 bis) et se contente d'autoriser,
 * valider l'entrée et journaliser. Les transports réels (clients Graph/
 * SalesBlink) restent construits par l'appelant (l'action serveur
 * aujourd'hui, le serveur MCP demain) : ce fichier ne dépend que du contrat
 * `TransportsReponse`, jamais d'une clé ou d'une configuration provider.
 *
 * Convention de rôle : lecture = `viewer` ; toute écriture (répondre, marquer
 * traité, marquer intérêt) = `operator`.
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider, ErreurIntrouvable } from './contexte.js';
import { ecrireEvenement } from '../journal.js';
import { repondreAuFil, type TransportsReponse } from '../inbox/repondre-au-fil.js';
import { marqueBoite } from './campagnes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FiltreReception = 'a_traiter' | 'interesses' | 'absences' | 'traites' | 'tous';
export type InteretFil = 'interested' | 'not_interested' | null;

/**
 * Nommé `FilReceptionResume` — et non `FilResume`, déjà exporté par
 * `aujourdhui.ts` pour l'aperçu de la page Aujourd'hui (forme plus pauvre,
 * dédiée à cet aperçu) — pour ne pas entrer en collision d'export (même geste
 * que `CampagneListeResume`/`CampagneResume`, voir le commentaire dans
 * `campagnes.ts`).
 *
 * NOTE POUR LE COORDINATEUR : la page Aujourd'hui calcule sa propre liste
 * « à traiter » avec une condition différente (`t.is_read = false and
 * t.resume_at is null`, `aujourdhui.ts`) — antérieure à la migration
 * `20260915100100_fils_traites_interet` et jamais mise à jour. Cette tâche
 * n'y touche pas (hors périmètre du brief), mais le badge de la barre
 * latérale et le compteur « À traiter » de cette page vont afficher des
 * nombres différents tant que `aujourdhui.ts` n'est pas aligné sur
 * `classification = 'human_reply' and handled_at is null`.
 */
export interface FilReceptionResume {
  readonly id: string;
  readonly contactId: string | null;
  readonly nom: string;
  readonly poste: string | null;
  readonly entreprise: string | null;
  readonly canal: 'email' | 'linkedin';
  readonly classification: string;
  readonly apercu: string;
  readonly quand: string | null;
  readonly interet: InteretFil;
  readonly traite: boolean;
  readonly relanceLe: string | null;
  readonly campagneNom: string | null;
}

export interface MessageFil {
  readonly id: string;
  readonly direction: 'in' | 'out';
  readonly corps: string;
  readonly quand: string | null;
  /** Boîte ou contact selon la direction — jamais les deux (`destinataire` porte l'autre). */
  readonly expediteur: string | null;
  readonly destinataire: string | null;
  /** Sujet du message — posé par un envoi de séquence (`raw.subject`), absent d'une réponse manuelle. */
  readonly objet: string | null;
  /**
   * `headers.reply_from` d'un message ENTRANT (relève Microsoft Graph, lot 3
   * bis) : l'adresse réelle d'où le contact a répondu, quand elle diffère de
   * la boîte contactée (alias +étiquette). `null` sinon — jamais posé sur un
   * message sortant.
   */
  readonly repondDepuis: string | null;
}

export interface ResumeContactFil {
  readonly id: string | null;
  readonly nom: string;
  readonly poste: string | null;
  readonly entreprise: string | null;
  readonly email: string | null;
  readonly emailStatut: string | null;
  readonly linkedinUrl: string | null;
}

export interface PourquoiLuiFil {
  readonly providerId: string | null;
  readonly titre: string | null;
  readonly quand: string | null;
  readonly url: string | null;
  readonly score: number | null;
}

export interface EtapeSequenceFil {
  readonly position: number;
  readonly total: number;
}

export interface CampagneFil {
  readonly id: string;
  readonly nom: string;
  readonly etape: EtapeSequenceFil | null;
  readonly sequenceArretee: boolean;
}

export interface BoiteFil {
  readonly id: string;
  readonly identite: string;
  readonly marque: 'outlook' | 'gmail' | null;
}

export interface FilDetail {
  /** Canal du FIL (`threads.channel`) — jamais dérivé des coordonnées du contact, qui peut avoir les deux. */
  readonly canal: 'email' | 'linkedin';
  readonly contact: ResumeContactFil;
  readonly campagne: CampagneFil | null;
  readonly boite: BoiteFil | null;
  readonly messages: MessageFil[];
  readonly interet: InteretFil;
  readonly traite: boolean;
  readonly pourquoi: PourquoiLuiFil | null;
  /** `false` quand `repondre` échouerait avec `ErreurReponseImpossible` (bouton désactivé avant le clic, R du 16/09). */
  readonly reponsePossible: boolean;
  /** Clé i18n (`reception.fil.raisonReponseImpossible.*`), jamais un texte déjà traduit — `null` quand `reponsePossible` est vrai. */
  readonly raisonReponseImpossible: string | null;
  /**
   * Transport qu'utiliserait `repondre` (choisi par `repondreAuFil` d'après
   * l'origine du dernier message reçu, jamais une préférence) — `null` quand
   * `reponsePossible` est faux. Sert à afficher le bon libellé dans la zone de
   * réponse : la maquette d'origine (spec §6.12, avant le lot 3 bis) supposait
   * SalesBlink partout, alors qu'un fil relevé par Microsoft Graph répond par
   * Graph, jamais SalesBlink.
   */
  readonly transportReponse: 'microsoft_graph' | 'salesblink' | null;
}

// ---------------------------------------------------------------------------
// listerFils
// ---------------------------------------------------------------------------

export const schemaListerFils = z.object({
  filtre: z.enum(['a_traiter', 'interesses', 'absences', 'traites', 'tous']).default('a_traiter'),
  campagneId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
});

const TAILLE_PAGE_RECEPTION = 30;

/**
 * Fragment SQL de la règle canonique « à traiter » (spec §9, point 2) —
 * exporté pour que `aujourdhui.ts` (badge de la barre latérale, compteur de
 * la page Aujourd'hui) compte EXACTEMENT la même chose que la Réception au
 * lieu de sa propre condition `is_read`/`resume_at`, antérieure à la
 * migration `20260915100100_fils_traites_interet` (R77, tour de correction 1) :
 * `is_read` ne porte aucune notion de « traité » ni de type de réponse, deux
 * définitions différentes du même badge ne peuvent qu'diverger (un fil
 * `auto_absence` non lu sans `resume_at`, ou un fil marqué traité par
 * `marquerTraite` sans que `is_read` ne bouge). Suppose l'alias `t` posé sur
 * `threads` par la requête appelante — même convention que
 * `SQL_PROVIDER_ID_AFFICHAGE` (`sources.ts`).
 */
export const SQL_CONDITION_A_TRAITER = `t.classification = 'human_reply' and t.handled_at is null`;

/** Une condition par filtre — interpolée dans le SQL (valeur fixe de cette table, jamais une entrée utilisateur : sûr). */
const CONDITIONS_FILTRE: Record<FiltreReception, string> = {
  a_traiter: SQL_CONDITION_A_TRAITER,
  interesses: `t.interest = 'interested'`,
  absences: `t.classification = 'auto_absence'`,
  traites: `t.handled_at is not null`,
  tous: `true`,
};

/**
 * Dernière inscription du contact, peu importe la campagne : `threads` ne
 * porte pas de `campaign_id` direct (un fil ne connaît qu'un contact), donc
 * la campagne d'un fil se retrouve par la plus récente inscription de son
 * contact — même convention pour `listerFils` (compteurs, liste, filtre par
 * campagne) et `lireFil`.
 */
const JOINTURE_DERNIERE_INSCRIPTION = `
      left join lateral (
        select e.campaign_id, e.current_step, e.status
          from enrollments e
         where e.contact_id = t.contact_id
         order by e.started_at desc
         limit 1
      ) insc on true
      left join campaigns camp on camp.id = insc.campaign_id`;

function nomDuContact(prenom: string | null, nom: string | null): string {
  return `${prenom ?? ''} ${nom ?? ''}`.trim() || '—';
}

interface LigneCompteurs {
  a_traiter: number;
  interesses: number;
  absences: number;
  traites: number;
  tous: number;
}

interface LigneFilResume {
  id: string;
  contact_id: string | null;
  channel: string;
  classification: string;
  interest: InteretFil;
  handled_at: string | null;
  last_message_at: string | null;
  resume_at: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  account_name: string | null;
  campagne_nom: string | null;
  dernier_message: string | null;
}

export async function listerFils(
  ctx: Contexte,
  entree: unknown = {},
): Promise<{ compteurs: Record<FiltreReception, number>; fils: FilReceptionResume[] }> {
  exiger(ctx, 'viewer');
  const { filtre, campagneId, page } = valider(schemaListerFils, entree);

  const compteursRes = await ctx.ex.query<LigneCompteurs>(
    `select
        count(*) filter (where ${CONDITIONS_FILTRE.a_traiter})::int as a_traiter,
        count(*) filter (where ${CONDITIONS_FILTRE.interesses})::int as interesses,
        count(*) filter (where ${CONDITIONS_FILTRE.absences})::int as absences,
        count(*) filter (where ${CONDITIONS_FILTRE.traites})::int as traites,
        count(*)::int as tous
       from threads t /* jr:compteurs_reception */${JOINTURE_DERNIERE_INSCRIPTION}
      where t.organization_id = $1
        and ($2::uuid is null or insc.campaign_id = $2)`,
    [ctx.organisationId, campagneId ?? null],
  );
  const ligneCompteurs = compteursRes.rows[0] ?? { a_traiter: 0, interesses: 0, absences: 0, traites: 0, tous: 0 };
  const compteurs: Record<FiltreReception, number> = {
    a_traiter: ligneCompteurs.a_traiter,
    interesses: ligneCompteurs.interesses,
    absences: ligneCompteurs.absences,
    traites: ligneCompteurs.traites,
    tous: ligneCompteurs.tous,
  };

  const filsRes = await ctx.ex.query<LigneFilResume>(
    `select t.id, t.contact_id, t.channel, t.classification, t.interest, t.handled_at, t.last_message_at, t.resume_at,
            c.first_name, c.last_name, c.job_title, ac.name as account_name,
            camp.name as campagne_nom,
            (select m.body from thread_messages m where m.thread_id = t.id order by m.sent_at desc nulls last limit 1) as dernier_message
       from threads t /* jr:liste_fils */
       left join contacts c on c.id = t.contact_id
       left join accounts ac on ac.id = c.account_id${JOINTURE_DERNIERE_INSCRIPTION}
      where t.organization_id = $1
        and (${CONDITIONS_FILTRE[filtre]})
        and ($2::uuid is null or insc.campaign_id = $2)
      order by t.last_message_at desc nulls last
      limit $3 offset $4`,
    [ctx.organisationId, campagneId ?? null, TAILLE_PAGE_RECEPTION, (page - 1) * TAILLE_PAGE_RECEPTION],
  );

  const fils: FilReceptionResume[] = filsRes.rows.map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    nom: nomDuContact(r.first_name, r.last_name),
    poste: r.job_title,
    entreprise: r.account_name,
    canal: r.channel === 'email' ? 'email' : 'linkedin',
    classification: r.classification,
    apercu: r.dernier_message ?? '',
    quand: r.last_message_at,
    interet: r.interest,
    traite: r.handled_at !== null,
    relanceLe: r.resume_at,
    campagneNom: r.campagne_nom,
  }));

  return { compteurs, fils };
}

// ---------------------------------------------------------------------------
// lireFil
// ---------------------------------------------------------------------------

export const schemaLireFil = z.object({ filId: z.string().uuid() });

interface LigneFilEntete {
  id: string;
  contact_id: string | null;
  channel: string;
  interest: InteretFil;
  handled_at: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  email_status: string | null;
  linkedin_url: string | null;
  source_signal_id: string | null;
  account_name: string | null;
}

interface LigneMessage {
  id: string;
  direction: 'in' | 'out';
  body: string | null;
  sent_at: string | null;
  objet: string | null;
  repond_depuis: string | null;
  transport: string | null;
  graph_message_id: string | null;
  salesblink_inbox_message_id: string | null;
}

interface LigneSignal {
  provider_id: string | null;
  title: string | null;
  occurred_at: string | null;
  url: string | null;
  score: number | null;
}

interface LigneInscription {
  campaign_id: string;
  campagne_nom: string;
  current_step: number;
  status: string;
  total_etapes: number;
}

interface LigneBoite {
  id: string;
  identity: string;
  inbox_provider: string | null;
}

const STATUTS_INSCRIPTION_EN_COURS = new Set(['active', 'paused', 'paused_absence']);

interface InfosReponseMessage {
  readonly direction: 'in' | 'out';
  readonly transport: string | null;
  readonly graphMessageId: string | null;
  readonly salesblinkInboxMessageId: string | null;
}

/**
 * Calcule si un fil peut recevoir une réponse depuis l'application, à partir
 * des messages déjà lus par `lireFil` (jamais une seconde requête, ni un
 * appel à `choisirTransport` qui LÈVE plutôt que de renvoyer un booléen) :
 * mêmes trois raisons que `repondreAuFil`/`choisirTransport`
 * (`../inbox/repondre-au-fil.js`), à tenir alignées si ce fichier change —
 * les tests ci-contre miroitent ceux de `repondre-au-fil.test.ts`.
 */
export interface ResultatReponsePossible {
  readonly possible: boolean;
  readonly raison: string | null;
  /** Transport qu'utiliserait réellement `repondre` — `null` quand `possible` est faux. */
  readonly transport: 'microsoft_graph' | 'salesblink' | null;
}

export function calculerReponsePossible(
  canal: 'email' | 'linkedin',
  messages: readonly InfosReponseMessage[],
): ResultatReponsePossible {
  if (canal !== 'email') {
    return { possible: false, raison: 'reception.fil.raisonReponseImpossible.canalNonEmail', transport: null };
  }
  const dernierEntrant = [...messages].reverse().find((m) => m.direction === 'in');
  if (!dernierEntrant) {
    return { possible: false, raison: 'reception.fil.raisonReponseImpossible.messageOrigineInconnu', transport: null };
  }
  if (dernierEntrant.transport === 'microsoft_graph') {
    if (!dernierEntrant.graphMessageId) {
      return { possible: false, raison: 'reception.fil.raisonReponseImpossible.messageOrigineInconnu', transport: null };
    }
    return { possible: true, raison: null, transport: 'microsoft_graph' };
  }
  if (!dernierEntrant.salesblinkInboxMessageId) {
    return { possible: false, raison: 'reception.fil.raisonReponseImpossible.messageOrigineInconnu', transport: null };
  }
  return { possible: true, raison: null, transport: 'salesblink' };
}

export async function lireFil(ctx: Contexte, entree: unknown): Promise<FilDetail> {
  exiger(ctx, 'viewer');
  const { filId } = valider(schemaLireFil, entree);

  const enteteRes = await ctx.ex.query<LigneFilEntete>(
    `select t.id, t.contact_id, t.channel, t.interest, t.handled_at,
            c.first_name, c.last_name, c.job_title, c.email, c.email_status, c.linkedin_url, c.source_signal_id,
            ac.name as account_name
       from threads t /* jr:fil_entete */
       left join contacts c on c.id = t.contact_id
       left join accounts ac on ac.id = c.account_id
      where t.id = $1 and t.organization_id = $2`,
    [filId, ctx.organisationId],
  );
  const entete = enteteRes.rows[0];
  if (!entete) throw new ErreurIntrouvable('Fil');

  const [messagesRes, signalRes, inscriptionRes, boiteRes] = await Promise.all([
    ctx.ex.query<LigneMessage>(
      `select id, direction, body, sent_at,
              raw ->> 'subject' as objet,
              headers ->> 'reply_from' as repond_depuis,
              headers ->> 'transport' as transport,
              headers ->> 'graph_message_id' as graph_message_id,
              headers ->> 'salesblink_inbox_message_id' as salesblink_inbox_message_id
         from thread_messages /* jr:fil_messages */
        where thread_id = $1
        order by sent_at asc nulls last`,
      [filId],
    ),
    entete.source_signal_id
      ? ctx.ex.query<LigneSignal>(
          `select provider_id, title, occurred_at, url, score from signals /* jr:fil_signal */ where id = $1`,
          [entete.source_signal_id],
        )
      : Promise.resolve({ rows: [] as LigneSignal[], rowCount: 0 }),
    entete.contact_id
      ? ctx.ex.query<LigneInscription>(
          `select e.campaign_id, camp.name as campagne_nom, e.current_step, e.status,
                  (select count(*)::int from sequence_steps ss where ss.campaign_id = e.campaign_id) as total_etapes
             from enrollments e /* jr:fil_inscription */
             join campaigns camp on camp.id = e.campaign_id
            where e.contact_id = $1
            order by e.started_at desc
            limit 1`,
          [entete.contact_id],
        )
      : Promise.resolve({ rows: [] as LigneInscription[], rowCount: 0 }),
    entete.contact_id
      ? ctx.ex.query<LigneBoite>(
          `select s.id, s.identity, s.inbox_provider
             from contact_sender_bindings b /* jr:fil_boite */
             join senders s on s.id = b.sender_id and s.kind = b.sender_kind
            where b.contact_id = $1 and b.sender_kind = 'email'`,
          [entete.contact_id],
        )
      : Promise.resolve({ rows: [] as LigneBoite[], rowCount: 0 }),
  ]);

  const canal: 'email' | 'linkedin' = entete.channel === 'email' ? 'email' : 'linkedin';
  const nomContact = nomDuContact(entete.first_name, entete.last_name);

  const messages: MessageFil[] = messagesRes.rows.map((m) => ({
    id: m.id,
    direction: m.direction,
    corps: m.body ?? '',
    quand: m.sent_at,
    expediteur: m.direction === 'out' ? (boiteRes.rows[0]?.identity ?? null) : nomContact,
    destinataire: m.direction === 'out' ? nomContact : null,
    objet: m.direction === 'out' ? m.objet : null,
    repondDepuis: m.direction === 'in' ? m.repond_depuis : null,
  }));

  const { possible, raison, transport } = calculerReponsePossible(
    canal,
    messagesRes.rows.map((m) => ({
      direction: m.direction,
      transport: m.transport,
      graphMessageId: m.graph_message_id,
      salesblinkInboxMessageId: m.salesblink_inbox_message_id,
    })),
  );

  const signal = signalRes.rows[0] ?? null;
  const pourquoi: PourquoiLuiFil | null = signal
    ? { providerId: signal.provider_id, titre: signal.title, quand: signal.occurred_at, url: signal.url, score: signal.score }
    : null;

  const inscription = inscriptionRes.rows[0] ?? null;
  const campagne: CampagneFil | null = inscription
    ? {
        id: inscription.campaign_id,
        nom: inscription.campagne_nom,
        etape: inscription.total_etapes > 0 ? { position: inscription.current_step, total: inscription.total_etapes } : null,
        sequenceArretee: !STATUTS_INSCRIPTION_EN_COURS.has(inscription.status),
      }
    : null;

  const ligneBoite = boiteRes.rows[0] ?? null;
  const boite: BoiteFil | null = ligneBoite
    ? { id: ligneBoite.id, identite: ligneBoite.identity, marque: marqueBoite(ligneBoite.identity, ligneBoite.inbox_provider) }
    : null;

  return {
    canal,
    contact: {
      id: entete.contact_id,
      nom: nomContact,
      poste: entete.job_title,
      entreprise: entete.account_name,
      email: entete.email,
      emailStatut: entete.email_status,
      linkedinUrl: entete.linkedin_url,
    },
    campagne,
    boite,
    messages,
    interet: entete.interest,
    traite: entete.handled_at !== null,
    pourquoi,
    reponsePossible: possible,
    raisonReponseImpossible: raison,
    transportReponse: transport,
  };
}

// ---------------------------------------------------------------------------
// repondre
// ---------------------------------------------------------------------------

/**
 * `corps` est réduit (`trim`) AVANT la borne de longueur minimale : un texte
 * fait uniquement d'espaces passait `min(1)` (qui ne porte que sur la
 * longueur brute) et partait tel quel vers `repondreAuFil`. Avant cette
 * fonction, `apps/web/app/actions/inbox.ts` faisait ce `trim()` lui-même ;
 * une fonction « appelable sans écran » (spec « une fonction, deux façades »)
 * ne peut pas compter sur ce que fait un appelant particulier.
 */
export const schemaRepondre = z.object({
  filId: z.string().uuid(),
  corps: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(20000)),
});

/**
 * Pose `handled_at = now()` sur le fil — M2 (revue finale du 17/09) : `repondre`
 * écrivait le message et le journal sans jamais le faire, si bien qu'un fil
 * auquel on venait de répondre restait dans « À traiter » et dans son badge.
 * Même effet que `marquerTraite({ traite: true })` (bouton dédié de l'écran),
 * gardé séparé ici : celui-ci a besoin de renvoyer `ErreurIntrouvable` si la
 * ligne n'existe pas, ce que `repondre` n'a pas à revérifier (le fil vient
 * d'être lu avec succès par `repondreAuFil`).
 *
 * Appelé APRÈS l'envoi réussi, en dehors de toute transaction (`repondre` n'en
 * ouvre aucune — une suite d'appels séquentiels sur `ctx.ex`, comme le reste
 * de ce fichier). Si cette requête échoue, la réponse est déjà partie : une
 * exception ici ne doit jamais la faire échouer aux yeux de l'appelant — même
 * règle de tolérance que `journaliserReponseEnvoyee` ci-dessous. Un
 * `marquerTraite` manuel corrige le fil resté visible dans « À traiter ».
 */
async function marquerFilTraiteApresReponse(ctx: Contexte, filId: string): Promise<void> {
  try {
    await ctx.ex.query(
      `update threads /* jr:repondre_marquer_traite */ set handled_at = now() where id = $1 and organization_id = $2`,
      [filId, ctx.organisationId],
    );
  } catch (err) {
    console.warn('[reception] marquerFilTraiteApresReponse', err);
  }
}

/** N'écrit jamais dans `audit_events` avant l'envoi réel : un journal qui échoue ne doit jamais faire échouer une réponse déjà partie (même règle que `ecrireEvenementCampagne`, `campagnes.ts`). */
async function journaliserReponseEnvoyee(
  ctx: Contexte,
  filId: string,
  contactId: string | null,
  transport: string,
): Promise<void> {
  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'contact',
      entityId: contactId,
      action: 'reply_sent',
      diff: { filId, transport },
      actorId: ctx.utilisateurId,
    });
  } catch {
    // best-effort — voir le commentaire ci-dessus.
  }
}

/**
 * Envoie une réponse dans un fil. Délègue tout le choix de transport et
 * l'envoi à `repondreAuFil` (lot 3 bis) : cette fonction n'appelle jamais
 * SalesBlink ni Microsoft Graph elle-même, et ne duplique aucune de leurs
 * règles. `transports` est fourni par l'appelant (l'action serveur construit
 * les vrais clients à partir des identifiants de l'organisation ; un futur
 * appelant MCP ferait de même) — packages/core ne résout aucune clé.
 *
 * Si le fil ne peut pas recevoir de réponse dans son état actuel,
 * `repondreAuFil` lève `ErreurReponseImpossible` : cette fonction la laisse
 * remonter telle quelle (message déjà écrit pour l'opérateur) — c'est à la
 * façade de la traduire pour l'écran (`apps/web/lib/erreur-reponse.ts`).
 */
export async function repondre(
  ctx: Contexte,
  entree: unknown,
  transports: TransportsReponse,
): Promise<{ messageId: string }> {
  exiger(ctx, 'operator');
  const { filId, corps } = valider(schemaRepondre, entree);

  const resultat = await repondreAuFil(ctx.ex, ctx.organisationId, { threadId: filId, corps }, transports);

  // Une réponse envoyée sort le fil de « À traiter » sans geste supplémentaire
  // de l'opérateur (M2) — après l'envoi réussi, jamais avant (un envoi qui
  // lève ErreurReponseImpossible ne doit jamais poser handled_at).
  await marquerFilTraiteApresReponse(ctx, filId);

  const filRes = await ctx.ex.query<{ contact_id: string | null }>(
    `select contact_id from threads /* jr:repondre_contact_pour_journal */ where id = $1`,
    [filId],
  );
  await journaliserReponseEnvoyee(ctx, filId, filRes.rows[0]?.contact_id ?? null, resultat.transport);

  return { messageId: resultat.messageId };
}

// ---------------------------------------------------------------------------
// marquerTraite / marquerInteret
// ---------------------------------------------------------------------------

export const schemaMarquerTraite = z.object({ filId: z.string().uuid(), traite: z.boolean() });

/** `traite: false` rouvre le fil (`handled_at` remis à `null`) — pas de fonction `rouvrir` séparée. */
export async function marquerTraite(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { filId, traite } = valider(schemaMarquerTraite, entree);

  const res = await ctx.ex.query(
    `update threads /* jr:marquer_traite */
        set handled_at = case when $3 then now() else null end
      where id = $1 and organization_id = $2
      returning id`,
    [filId, ctx.organisationId, traite],
  );
  if (res.rowCount === 0) throw new ErreurIntrouvable('Fil');
}

export const schemaMarquerInteret = z.object({
  filId: z.string().uuid(),
  interet: z.enum(['interested', 'not_interested']).nullable(),
});

export async function marquerInteret(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { filId, interet } = valider(schemaMarquerInteret, entree);

  const res = await ctx.ex.query(
    `update threads /* jr:marquer_interet */
        set interest = $3
      where id = $1 and organization_id = $2
      returning id`,
    [filId, ctx.organisationId, interet],
  );
  if (res.rowCount === 0) throw new ErreurIntrouvable('Fil');
}
