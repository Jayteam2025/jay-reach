/**
 * Relève périodique des réponses via Microsoft Graph (lot 3 bis). SalesBlink
 * reste le transport d'envoi, mais sa propre relève détecte les réponses
 * avec des heures de retard (mesuré les 10 et 11/09/2026) : pour les
 * organisations qui l'activent (`senders.inbox_provider = 'microsoft_graph'`),
 * on lit directement la boîte Microsoft 365 concernée.
 *
 * Ordre des filtres imposé — on ne lit ni ne stocke jamais de courrier hors
 * de nos fils, et les deux filtres gratuits passent avant le filtre payant :
 *  1. SQL, gratuit : l'expéditeur du message reçu est-il un contact connu de
 *     l'organisation ?
 *  2. SQL, gratuit : le message n'est-il pas déjà stocké
 *     (`provider_message_id` ou `internet_message_id`) ?
 *  3. Graph, un appel par candidat : un message que NOUS avons envoyé dans la
 *     même conversation, à cet expéditeur, avant sa réponse ?
 *
 * Le corps d'un message ne passe jamais dans un log. Une erreur sur une boîte
 * n'interrompt pas les autres — seul un code court est retenu dans
 * `provider_sync_state.last_error` (jamais le message, jamais un jeton).
 */
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { traiterEvenementEmail, entierBorne, type EvenementEmail } from '@jay-reach/core';
import {
  listerMessagesRecus,
  listerEnvoyesDansConversation,
  ErreurGraph,
  type ConfigGraph,
  type MessageGraph,
} from '@jay-reach/providers/mail';
import { resolveProviderCredentials } from '../credentials.js';
import { deterministicUuid, currentBucket } from '../ids.js';

/** Identifiant du fournisseur au catalogue (`packages/providers/src/catalog.ts`). */
export const MICROSOFT_GRAPH_PROVIDER = 'microsoft_graph';

/** Absence de curseur (première relève d'une organisation) : on part de 24 h en arrière. */
const FENETRE_PREMIERE_RELEVE_MS = 24 * 60 * 60 * 1000;
/** Recouvrement de sécurité sur le bord le plus ancien : un message peut encore arriver un peu après coup. */
const RETARD_SECURITE_MS = 10 * 60 * 1000;
/** Longueur maximale du corps stocké — même plafond que les autres transports email. */
const LONGUEUR_MAX_CORPS = 20_000;
/** Clés d'en-tête (déjà en minuscules côté `MessageGraph.headers`) qui font foi pour la classification d'auto-réponse. */
const CLES_AUTO_REPONSE = ['auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence'] as const;

/** Contexte minimal requis par la relève — même forme que `releve-salesblink.ts`. */
export interface ContexteWorker {
  readonly pool: Pool;
  readonly encryptionKey?: string | undefined;
}

/** Client Microsoft Graph minimal requis par la relève — injectable pour les tests. */
export interface ClientGraph {
  readonly listerMessagesRecus: typeof listerMessagesRecus;
  readonly listerEnvoyesDansConversation: typeof listerEnvoyesDansConversation;
}

const clientGraphReel: ClientGraph = {
  listerMessagesRecus,
  listerEnvoyesDansConversation,
};

/** `last_error` ne porte jamais le message ni l'URL — seulement le code et le statut HTTP. */
function formatErreurGraph(err: ErreurGraph): string {
  return err.statut !== null ? `${err.code} ${err.statut}` : err.code;
}

/**
 * Code court d'échec d'une boîte, sans aucun contenu : `last_error` est lu par
 * l'écran Fournisseurs, et le message d'une erreur inattendue peut porter une
 * URL, un identifiant ou un extrait de réponse.
 */
function formatErreurBoite(err: unknown): string {
  if (err instanceof ErreurGraph) return formatErreurGraph(err);
  const nom = err instanceof Error ? err.constructor.name : typeof err;
  return `erreur_interne ${nom}`;
}

/**
 * Un message reçu est une réponse à ce que NOUS avons envoyé si un message
 * envoyé dans la même conversation est adressé à son expéditeur (insensible
 * à la casse) et daté avant lui. Aucune autre condition : Graph ne garantit
 * ni l'ordre des destinataires ni le nombre de participants d'une conversation.
 */
export function estReponseANotreEnvoi(recu: MessageGraph, envoyes: readonly MessageGraph[]): boolean {
  const expediteur = recu.from;
  if (!expediteur) return false;
  const expediteurMinuscule = expediteur.toLowerCase();
  const receptionMs = new Date(recu.receivedDateTime).getTime();
  return envoyes.some((envoye) => {
    if (envoye.conversationId !== recu.conversationId) return false;
    if (!envoye.sentDateTime) return false;
    if (new Date(envoye.sentDateTime).getTime() >= receptionMs) return false;
    return envoye.to.some((adresse) => adresse.toLowerCase() === expediteurMinuscule);
  });
}

/**
 * Message Graph → événement `repondu`. Les en-têtes portés (lot 3 bis) servent
 * deux fins : `auto-submitted` / `x-autoreply` / `x-autorespond` / `precedence`,
 * quand Graph les fournit, alimentent la classification d'auto-réponse
 * (`classifyByHeaders`, comme pour tout autre canal) ; `transport` / `mailbox`
 * / `graph_message_id` retracent l'origine du message pour qu'une réponse
 * ultérieure (tâche 3, `choisirTransport`) sache par quel transport et dans
 * quelle boîte répondre.
 */
export function versEvenementRepondu(recu: MessageGraph, boite: string): EvenementEmail {
  const headers: Record<string, string | null> = {
    transport: MICROSOFT_GRAPH_PROVIDER,
    mailbox: boite,
    graph_message_id: recu.id,
    conversation_id: recu.conversationId,
    internet_message_id: recu.internetMessageId,
    subject: recu.subject,
  };
  for (const cle of CLES_AUTO_REPONSE) {
    const valeur = recu.headers[cle];
    if (valeur !== undefined) headers[cle] = valeur;
  }
  return {
    type: 'repondu',
    email: recu.from ?? '',
    corps: recu.bodyText.slice(0, LONGUEUR_MAX_CORPS),
    sujet: recu.subject,
    messageId: recu.id,
    aMs: new Date(recu.receivedDateTime).getTime(),
    headers,
  };
}

interface SenderGraph {
  readonly id: string;
  readonly identity: string;
}

async function enregistrerCurseur(pool: Pool, org: string, cursorMs: number, lastError: string | null): Promise<void> {
  await pool.query(
    `insert into provider_sync_state (organization_id, provider, cursor_ms, last_run_at, last_error)
       values ($1, $2, $3, now(), $4)
     on conflict (organization_id, provider) do update
       set cursor_ms = $3, last_run_at = now(), last_error = $4`,
    [org, MICROSOFT_GRAPH_PROVIDER, cursorMs, lastError],
  );
}

export interface BilanReleveGraph {
  readonly boites: number;
  readonly lus: number;
  readonly retenus: number;
  readonly enregistres: number;
}

/**
 * Relève d'une organisation, une boîte à la fois — jamais bloquée par une
 * autre (toute erreur sur une boîte est journalisée et retenue dans
 * `last_error`, la suivante est quand même traitée).
 *
 * Le curseur n'avance que si TOUTES les boîtes ont réussi (y compris quand
 * aucune boîte n'est configurée) ; dès qu'au moins une a échoué, il est
 * réécrit avec la valeur lue en début de passage (`curseurDepart`) — même
 * règle que `releverSalesBlink` — pour ne jamais faire sortir de la fenêtre
 * relue les réponses reçues pendant la panne. Même sans échec, il ne dépasse
 * jamais ce qui a été lu : une boîte dont la fenêtre a été tronquée le borne
 * à son dernier message lu.
 */
export async function releverGraph(
  ctx: ContexteWorker,
  data: { readonly organizationId: string },
  client: ClientGraph = clientGraphReel,
): Promise<BilanReleveGraph> {
  const { pool, encryptionKey } = ctx;
  const org = data.organizationId;
  const vide: BilanReleveGraph = { boites: 0, lus: 0, retenus: 0, enregistres: 0 };

  const credentials = await resolveProviderCredentials(pool, org, MICROSOFT_GRAPH_PROVIDER, { encryptionKey });
  const tenantId = credentials?.tenant_id;
  const clientId = credentials?.client_id;
  const clientSecret = credentials?.client_secret;
  if (!tenantId || !clientId || !clientSecret) {
    console.warn(`[releve-graph] org ${org} : graph_credentials_absentes — relève ignorée`);
    return vide;
  }
  const cfg: ConfigGraph = { tenantId, clientId, clientSecret };

  const sendersRes = await pool.query<SenderGraph>(
    `select id, identity from senders where organization_id = $1 and kind = 'email' and is_active and inbox_provider = $2`,
    [org, MICROSOFT_GRAPH_PROVIDER],
  );

  const etatCurseur = await pool.query<{ cursor_ms: string | number | null }>(
    `select cursor_ms from provider_sync_state where organization_id = $1 and provider = $2`,
    [org, MICROSOFT_GRAPH_PROVIDER],
  );
  const maintenant = Date.now();
  const brut = etatCurseur.rows[0]?.cursor_ms;
  const curseurConnu = brut !== undefined && brut !== null && Number(brut) > 0 ? Number(brut) : null;
  const curseurDepart = curseurConnu ?? maintenant - FENETRE_PREMIERE_RELEVE_MS;
  // La fenêtre de 24 h est un point de DÉPART, pas un plancher permanent : avec
  // un curseur, la borne basse est le curseur moins le recouvrement, quel que
  // soit son âge, sinon une panne de trois jours perd trois jours de réponses
  // — le gel du curseur sur échec ne servirait alors à rien.
  const depuisMs = curseurConnu !== null ? curseurConnu - RETARD_SECURITE_MS : curseurDepart;
  const depuisIso = new Date(depuisMs).toISOString();

  let lus = 0;
  let retenus = 0;
  let enregistres = 0;
  let lastError: string | null = null;
  // Fin de fenêtre réellement lue : plus petite borne des boîtes tronquées.
  // Le curseur ne doit jamais dépasser ce qui a été lu.
  let finLueMs = maintenant;

  for (const boite of sendersRes.rows) {
    try {
      const { messages, tronque, dernierRecuMs } = await client.listerMessagesRecus(cfg, boite.identity, depuisIso);
      if (tronque && dernierRecuMs !== null && dernierRecuMs < finLueMs) {
        // Le plafond de pages a coupé la fenêtre : la suite sera lue au
        // prochain passage, à condition que le curseur reste en deçà.
        finLueMs = dernierRecuMs;
      }
      lus += messages.length;
      if (messages.length === 0) continue;

      // Filtre 1 (SQL, gratuit) : seuls les expéditeurs déjà contacts de
      // l'organisation méritent la suite (le filtre 3 coûte un appel Graph).
      const expediteurs = [
        ...new Set(
          messages
            .map((m) => m.from)
            .filter((from): from is string => from !== null)
            .map((from) => from.toLowerCase()),
        ),
      ];
      if (expediteurs.length === 0) continue;

      const contactsRes = await pool.query<{ id: string; email: string }>(
        `select id, email from contacts where organization_id = $1 and lower(email) = any($2)`,
        [org, expediteurs],
      );
      const contactsConnus = new Set(contactsRes.rows.map((r) => r.email.toLowerCase()));
      if (contactsConnus.size === 0) continue;

      for (const message of messages) {
        if (!message.from || !contactsConnus.has(message.from.toLowerCase())) continue;

        // Filtre 2 : dédoublonnage, par identifiant Graph ou par en-tête
        // Internet. Il passe AVANT l'appel `sentitems` : pendant le
        // recouvrement, les mêmes messages repassent à chaque relève, et
        // chacun coûtait un appel Graph pour rien.
        const dejaVu = await pool.query(
          `select 1 from thread_messages tm
             join threads t on t.id = tm.thread_id
            where t.organization_id = $1
              and (tm.provider_message_id = $2 or tm.headers ->> 'internet_message_id' = $3)
            limit 1`,
          [org, message.id, message.internetMessageId],
        );
        if (dejaVu.rows.length > 0) continue;

        // Filtre 3 (Graph) : un envoi de nous, dans la même conversation, avant cette réponse.
        const envoyes = await client.listerEnvoyesDansConversation(cfg, boite.identity, message.conversationId);
        if (!estReponseANotreEnvoi(message, envoyes)) continue;
        retenus += 1;

        await traiterEvenementEmail(pool, org, versEvenementRepondu(message, boite.identity), MICROSOFT_GRAPH_PROVIDER);
        enregistres += 1;
      }
    } catch (err) {
      // Toute erreur d'une boîte est retenue ici, pas seulement une
      // `ErreurGraph` : une erreur d'un autre type faisait échouer le job
      // entier, sautait les boîtes suivantes et n'écrivait ni `last_run_at`
      // ni `last_error` — l'échec était totalement muet.
      if (lastError === null) lastError = formatErreurBoite(err);
      console.error(`[releve-graph] org ${org}, boîte ${boite.id} : ${formatErreurBoite(err)}`);
    }
  }

  // Une boîte en échec (L9, tour de correction 1) ne fait jamais avancer le
  // curseur : sans ça, une panne de plus de dix minutes (jeton refusé, limite
  // de débit, tenant suspendu) ferait sortir les réponses reçues pendant la
  // panne de la fenêtre relue au passage suivant — perte silencieuse. Le
  // dédoublonnage rend inoffensif le rebalayage des boîtes déjà réussies au
  // prochain passage.
  //
  // Sans échec, le curseur s'arrête à `finLueMs` : l'instant du passage quand
  // tout a été lu, et le dernier message lu de la boîte la plus tronquée
  // sinon. Le curseur ne dépasse jamais ce qui a été lu.
  await enregistrerCurseur(pool, org, lastError !== null ? curseurDepart : finLueMs, lastError);
  return { boites: sendersRes.rows.length, lus, retenus, enregistres };
}

interface OrganisationAEnfiler {
  readonly organization_id: string;
  readonly config: { readonly sync_interval_min?: string } | null;
  /** Une ligne `credentials` en statut `configured` existe pour cette organisation. */
  readonly configure: boolean;
}

/** Les trois variables de repli du worker (`fallbackEnv` du catalogue) sont-elles toutes présentes ? */
function repliEnvironnementComplet(): boolean {
  return (
    Boolean(process.env.MS_GRAPH_TENANT_ID) &&
    Boolean(process.env.MS_GRAPH_CLIENT_ID) &&
    Boolean(process.env.MS_GRAPH_CLIENT_SECRET)
  );
}

/**
 * Enfile un `inbox.sync_graph` par organisation qui a de quoi relever : au
 * moins une boîte activée (`senders.is_active` et
 * `senders.inbox_provider = 'microsoft_graph'`) ET une configuration Microsoft
 * Graph joignable — en base (`credentials` en `configured`) ou, à défaut, dans
 * l'environnement du worker (`MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`,
 * `MS_GRAPH_CLIENT_SECRET`), le repli que `resolveProviderCredentials`
 * applique déjà à l'exécution.
 *
 * Partir des boîtes plutôt que du coffre corrige deux défauts symétriques
 * relevés à la revue finale : une organisation qui n'a rempli que le fichier
 * d'environnement du worker ne recevait aucun job et la fonctionnalité restait
 * muette ; une organisation qui avait saisi ses identifiants sans activer une
 * seule boîte recevait un job à chaque fenêtre pour ne rien lire.
 *
 * Dédoublonné par fenêtre comme `enqueueReleveSalesBlink` : l'id du job est
 * déterministe pour toute la fenêtre (`sync_interval_min`, défaut 5, borné
 * 1..60) — une seconde insertion dans la même fenêtre porte le même id,
 * pg-boss ne crée pas de second job.
 */
export async function enqueueReleveGraph(boss: PgBoss, pool: Pool): Promise<void> {
  const res = await pool.query<OrganisationAEnfiler>(
    `select distinct on (s.organization_id)
            s.organization_id as organization_id,
            c.config as config,
            (c.organization_id is not null) as configure
       from senders s
       left join credentials c
         on c.organization_id = s.organization_id
        and c.provider_id = $1
        and c.status = 'configured'
      where s.kind = 'email' and s.is_active and s.inbox_provider = $1
      order by s.organization_id, c.organization_id nulls last`,
    [MICROSOFT_GRAPH_PROVIDER],
  );
  const repli = repliEnvironnementComplet();
  for (const row of res.rows) {
    // Sans configuration en base ET sans repli complet, la relève rendrait un
    // bilan vide en journalisant `graph_credentials_absentes` à chaque
    // fenêtre : autant ne pas créer le job.
    if (!row.configure && !repli) continue;

    // Bornes propres à ce transport (1..60), distinctes des 2..60 de
    // `normaliserIntervalleReleve` (SalesBlink) : `entierBorne` est
    // réutilisée avec ses propres bornes plutôt qu'une fonction dédiée
    // (B1, tour de correction 1).
    const intervalMin = entierBorne(row.config?.sync_interval_min, 5, 1, 60);
    const bucket = currentBucket(intervalMin * 60_000);
    await boss.insert([
      {
        name: 'inbox.sync_graph',
        id: deterministicUuid('releve-graph', row.organization_id, bucket),
        data: { organizationId: row.organization_id },
      },
    ]);
  }
}
