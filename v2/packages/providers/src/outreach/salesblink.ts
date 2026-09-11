/**
 * Client HTTP SalesBlink — transport email du lot 3 (« SalesBlink comme simple
 * transport email »). SalesBlink envoie et relève les emails ; Jay Reach rend
 * le texte et sequence les etapes.
 *
 * Base et conventions verifiees empiriquement les 10 et 11/09/2026 sur un
 * compte d'essai, et dans la spec OpenAPI v1.0.0 publiee a
 * https://developer.salesblink.io/openapi.json :
 * - Authentification : en-tete `Authorization: <cle>`, sans prefixe `Bearer`.
 * - Enveloppe standard `{ success, data, message }`, depliee par `donnees()`.
 *   Exceptions : `GET /replies` (et `/sent`) renvoient un tableau nu ; `GET /inbox`
 *   renvoie `data.result`.
 * - Identifiants exposes = `id` uuid, jamais `_id` Mongo.
 *
 * Aucune cle, en-tete `Authorization` ni URL complete ne doit jamais figurer
 * dans un message d'erreur, un log ou une trace de test : `ErreurSalesBlink`
 * n'expose que `code`, `statut`, et au plus 200 caracteres du corps de reponse.
 */

const BASE_SALESBLINK = 'https://run.salesblink.io/api/public/v1.0.0';
const TAILLE_LOT_LEADS = 500;
/** Taille de page des flux datés (envois, réponses, rapports) — commune aux trois. */
export const TAILLE_PAGE_RAPPORTS = 100;
/**
 * Plafond de pages par flux et par relève (défaut). Avec une fenêtre de relève
 * d'une heure au plus (`FENETRE_RELEVE_MAX_MS` côté worker) et cent éléments
 * par page, cinq pages couvrent cinq cents événements par flux — largement
 * hors de portée pour la volumétrie de ce produit. Exporté pour que la relève
 * détecte une fenêtre saturée (nombre de lignes = ce plafond × la taille de
 * page) sans dupliquer la constante.
 */
export const PAGES_MAX_PAR_DEFAUT = 5;
const LONGUEUR_MAX_ERREUR = 200;

export class ErreurSalesBlink extends Error {
  constructor(
    readonly code: 'limite' | 'client' | 'serveur' | 'reseau',
    readonly statut: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'ErreurSalesBlink';
  }
}

export interface BoiteSalesBlink {
  id: string;
  email: string;
  nom: string;
  connectee: boolean;
  envoiActif: boolean;
  receptionActive: boolean;
  plafondQuotidien: number | null;
}

export interface SanteBoite {
  connectee: boolean;
  envoiActif: boolean;
  receptionActive: boolean;
  sante: number | null;
  derniereErreur: { app: string; message: string; a: string } | null;
}

export interface LeadSalesBlink {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  jr_subject: string;
  jr_body: string;
  jr_action_id: string;
}

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
  /**
   * Erreur portee par la tache inbox (`error.message.message`, mesure le
   * 11/09 : un `reply` accepte pendant que l'expediteur etait deconnecte y
   * reste sans jamais etre rejoue). Tronquee a 200 caracteres, absente si la
   * tache n'a pas d'erreur.
   */
  erreur?: string;
}

interface OptionsAppel {
  corps?: unknown;
  formulaire?: FormData;
  parametres?: Record<string, string | number | boolean | undefined>;
}

/**
 * Fait l'appel HTTP, deplie le JSON et normalise les erreurs SalesBlink en
 * `ErreurSalesBlink`. Ne jamais faire fuiter `cle` ni l'URL complete.
 */
async function appeler(
  methode: 'GET' | 'POST' | 'PATCH',
  chemin: string,
  options: OptionsAppel,
  cle: string,
): Promise<unknown> {
  const url = new URL(`${BASE_SALESBLINK}${chemin}`);
  for (const [nom, valeur] of Object.entries(options.parametres ?? {})) {
    if (valeur !== undefined) url.searchParams.set(nom, String(valeur));
  }

  const entetes: Record<string, string> = {
    Authorization: cle,
    Accept: 'application/json',
  };

  let corpsRequete: BodyInit | undefined;
  if (options.formulaire) {
    corpsRequete = options.formulaire;
  } else if (options.corps !== undefined) {
    entetes['Content-Type'] = 'application/json';
    corpsRequete = JSON.stringify(options.corps);
  }

  let reponse: Response;
  try {
    reponse = await fetch(url.toString(), { method: methode, headers: entetes, body: corpsRequete });
  } catch {
    throw new ErreurSalesBlink('reseau', null, 'Echec de connexion a SalesBlink');
  }

  const texteReponse = await reponse.text();

  if (!reponse.ok) {
    const messageErreur = extraireMessageErreur(texteReponse).slice(0, LONGUEUR_MAX_ERREUR);
    if (reponse.status === 429) {
      throw new ErreurSalesBlink('limite', 429, messageErreur || 'Limite de debit SalesBlink atteinte');
    }
    if (reponse.status >= 500) {
      throw new ErreurSalesBlink(
        'serveur',
        reponse.status,
        messageErreur || `Erreur serveur SalesBlink (${reponse.status})`,
      );
    }
    throw new ErreurSalesBlink(
      'client',
      reponse.status,
      messageErreur || `Requete SalesBlink refusee (${reponse.status})`,
    );
  }

  if (!texteReponse) return null;
  try {
    return JSON.parse(texteReponse);
  } catch {
    throw new ErreurSalesBlink('serveur', reponse.status, 'Reponse SalesBlink invalide (JSON)');
  }
}

function extraireMessageErreur(texteBrut: string): string {
  try {
    const analyse = JSON.parse(texteBrut) as { message?: unknown };
    if (typeof analyse.message === 'string') return analyse.message;
  } catch {
    // corps non-JSON : on retombe sur le texte brut ci-dessous
  }
  return texteBrut;
}

/** Deplie l'enveloppe `{ success, data, message }`. Un resultat sans `data` (deja un tableau nu) est renvoye tel quel. */
function donnees(resultat: unknown): unknown {
  if (resultat && typeof resultat === 'object' && 'data' in (resultat as Record<string, unknown>)) {
    return (resultat as Record<string, unknown>).data;
  }
  return resultat;
}

function enTableau(valeur: unknown): unknown[] {
  return Array.isArray(valeur) ? valeur : [];
}

function texte(valeur: unknown, repli = ''): string {
  return typeof valeur === 'string' ? valeur : repli;
}

function texteOuNull(valeur: unknown): string | null {
  return typeof valeur === 'string' ? valeur : null;
}

function booleen(valeur: unknown): boolean {
  return valeur === true;
}

function nombreOuNull(valeur: unknown): number | null {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null;
}

/** Convertit un horodatage SalesBlink (nombre, chaine numerique ou date ISO) en millisecondes. */
function versMs(valeur: unknown): number | null {
  if (typeof valeur === 'number' && Number.isFinite(valeur)) return valeur;
  if (typeof valeur === 'string' && valeur.trim() !== '') {
    const enNombre = Number(valeur);
    if (Number.isFinite(enNombre)) return enNombre;
    const enDate = Date.parse(valeur);
    if (Number.isFinite(enDate)) return enDate;
  }
  return null;
}

/**
 * Forme reelle de `error` sur `GET /senders/{id}/health`, mesuree le 11/09 sur
 * un expediteur coupe par la verification IMAP : `{ app: 'imap-check',
 * errorFunction: 'imap-worker.action', error: 'Command failed NO true 3 NO
 * [ALERT] IMAP access is disabled for your domain...', errorTime:
 * '11/09/2026 12:28:18' }`. `errorFunction` n'est pas repris : redondant avec
 * `app` pour l'usage qu'en fait Jay Reach.
 */
function versDerniereErreur(brut: unknown): SanteBoite['derniereErreur'] {
  if (!brut || typeof brut !== 'object') return null;
  const ligne = brut as Record<string, unknown>;
  return {
    app: texte(ligne.app),
    message: texte(ligne.error).slice(0, LONGUEUR_MAX_ERREUR),
    a: texte(ligne.errorTime),
  };
}

// --- Expediteurs (Senders) --------------------------------------------------

/**
 * `GET /senders` n'est pas type dans la spec OpenAPI ; noms de champs mesures
 * le 11/09 sur le compte d'essai (notamment `alias`/`senderName` en camelCase,
 * a ne pas confondre avec `sending_enabled`/`receiving_enabled` en snake_case
 * de `/senders/{id}/health`) : `alias` (adresse d'envoi), `google_email`
 * (repli pour une boite Google), `senderName`, `sendingEnabled`,
 * `receivingEnabled`, `sequence_max_daily_frequency` (plafond quotidien de
 * sequence). `readyForOutreach` vaut `'unknown'` sur une boite non testee :
 * ne pas s'y fier pour `connectee`. `maxDailyFrequency` est le plafond de
 * warmup, distinct du plafond de sequence : ignore ici.
 */
export async function listerBoites(cle: string): Promise<BoiteSalesBlink[]> {
  const resultat = await appeler('GET', '/senders', {}, cle);
  return enTableau(donnees(resultat)).map((brut) => {
    const ligne = brut as Record<string, unknown>;
    const email = texte(ligne.alias, texte(ligne.google_email));
    const envoiActif = booleen(ligne.sendingEnabled);
    const receptionActive = booleen(ligne.receivingEnabled);
    return {
      id: texte(ligne.id),
      email,
      nom: texte(ligne.senderName, email),
      // La boite est operationnelle pour au moins un sens (envoi ou reception).
      connectee: envoiActif || receptionActive,
      envoiActif,
      receptionActive,
      plafondQuotidien: nombreOuNull(ligne.sequence_max_daily_frequency),
    };
  });
}

export async function santeBoite(idBoite: string, cle: string): Promise<SanteBoite> {
  const resultat = await appeler('GET', `/senders/${idBoite}/health`, {}, cle);
  const ligne = (donnees(resultat) ?? {}) as Record<string, unknown>;
  return {
    connectee: booleen(ligne.connected),
    envoiActif: booleen(ligne.sending_enabled),
    receptionActive: booleen(ligne.receiving_enabled),
    sante: nombreOuNull(ligne.health_score),
    derniereErreur: versDerniereErreur(ligne.error),
  };
}

export async function reconnecterBoite(idBoite: string, cle: string): Promise<void> {
  await appeler('POST', `/senders/${idBoite}/reconnect`, {}, cle);
}

// --- Gabarits et listes ------------------------------------------------------

export async function creerGabaritNeutre(nom: string, htmlFixe: string, cle: string): Promise<string> {
  const formulaire = new FormData();
  formulaire.set('name', nom);
  formulaire.set('subject_line', '{{jr_subject}}');
  formulaire.set('content', `{{jr_body}}${htmlFixe}`);
  const resultat = await appeler('POST', '/templates', { formulaire }, cle);
  return texte((donnees(resultat) as Record<string, unknown> | null)?.id);
}

export async function creerListe(nom: string, cle: string): Promise<string> {
  const resultat = await appeler('POST', '/lists', { corps: { name: nom, verification: false } }, cle);
  return texte((donnees(resultat) as Record<string, unknown> | null)?.id);
}

// --- Sequences ---------------------------------------------------------------

export async function creerSequenceEtape(
  p: {
    nom: string;
    idBoite: string;
    idListe: string;
    idGabarit: string;
    fuseau: string;
    heures: { name: string; enabled: boolean; fromTime: string; toTime: string }[];
  },
  cle: string,
): Promise<string> {
  const resultat = await appeler(
    'POST',
    '/sequences',
    {
      corps: {
        name: p.nom,
        senders: p.idBoite,
        lists: [p.idListe],
        steps: [{ type: 'email', template_id: p.idGabarit }],
        evergreen: true,
        paused: true,
        launchTimingMode: 'now',
        timezone: p.fuseau,
        emailSendingHours: p.heures,
        stopWhenReplyRecieved: true,
        sendToOnlyVerifiedEmail: false,
        validEmail: true,
        riskyEmail: true,
        invalidEmail: true,
        checkEmailBeforeSending: false,
        delayEnabled: false,
      },
    },
    cle,
  );
  return texte((donnees(resultat) as Record<string, unknown> | null)?.id);
}

export async function activerEtPlanifier(idSequence: string, cle: string): Promise<void> {
  await appeler('POST', `/sequences/${idSequence}/status`, { corps: { status: 'ACTIVE' } }, cle);
  await appeler('PATCH', `/sequences/${idSequence}`, { corps: { launchTimingMode: 'now', paused: false } }, cle);
}

export async function replanifier(idSequence: string, cle: string): Promise<void> {
  await appeler('PATCH', `/sequences/${idSequence}`, { corps: { launchTimingMode: 'now', paused: false } }, cle);
}

export async function mettreEnPause(
  idSequence: string,
  statut: 'PAUSED' | 'ARCHIVED',
  cle: string,
): Promise<void> {
  await appeler('POST', `/sequences/${idSequence}/status`, { corps: { status: statut } }, cle);
}

// --- Leads ---------------------------------------------------------------

export async function pousserLeads(idListe: string, leads: LeadSalesBlink[], cle: string): Promise<void> {
  for (let i = 0; i < leads.length; i += TAILLE_LOT_LEADS) {
    const lot = leads.slice(i, i + TAILLE_LOT_LEADS);
    await appeler(
      'POST',
      '/contacts',
      { corps: { list_id: idListe, remove_duplicates: true, contacts: lot } },
      cle,
    );
  }
}

// --- Inbox ---------------------------------------------------------------

/**
 * SalesBlink imbrique l'erreur d'une tache inbox sous `error.message.message`
 * (mesure le 11/09 : un `reply` accepte pendant que l'expediteur etait
 * deconnecte n'est jamais rejoue par SalesBlink). Tronquee a 200 caracteres
 * comme toute erreur SalesBlink.
 */
function extraireErreurTache(ligne: Record<string, unknown>): string | undefined {
  const erreur = ligne.error;
  if (!erreur || typeof erreur !== 'object') return undefined;
  const message = (erreur as Record<string, unknown>).message;
  if (message && typeof message === 'object') {
    const interieur = (message as Record<string, unknown>).message;
    if (typeof interieur === 'string') return interieur.slice(0, LONGUEUR_MAX_ERREUR);
  }
  if (typeof message === 'string') return message.slice(0, LONGUEUR_MAX_ERREUR);
  return undefined;
}

function versEnvoiSorti(brut: unknown): EnvoiSorti {
  const ligne = brut as Record<string, unknown>;
  const envoi: EnvoiSorti = {
    id: texte(ligne.id),
    messageId: texteOuNull(ligne.messageId),
    email: texte(ligne.email),
    sequenceId: texteOuNull(ligne.sequence),
    termine: booleen(ligne.completed),
    termineMs: versMs(ligne.completed_time),
    planifieMs: versMs(ligne.scheduled_time),
    typeTache: texte(ligne.task_type),
  };
  const erreur = extraireErreurTache(ligne);
  if (erreur !== undefined) envoi.erreur = erreur;
  return envoi;
}

/**
 * `/inbox` ne documente pas de fenêtre `from`/`to` séparée : son seul filtre de
 * date est `date` (`startTs-endTs`, en ms). `jusquaMs` (défaut : maintenant,
 * pour ne pas changer le comportement des appels existants) en fixe la borne
 * haute — c'est la fenêtre fermée `[depuisMs, jusquaMs)` que la relève
 * demande, exprimée dans le format que cet endpoint comprend.
 */
export async function listerEnvoisSortis(
  depuisMs: number,
  cle: string,
  options: { jusquaMs?: number; maxPages?: number } = {},
): Promise<EnvoiSorti[]> {
  const jusquaMs = options.jusquaMs ?? Date.now();
  const maxPages = options.maxPages ?? PAGES_MAX_PAR_DEFAUT;
  const envois: EnvoiSorti[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const resultat = await appeler(
      'GET',
      '/inbox',
      {
        parametres: {
          type: 'sent',
          limit: TAILLE_PAGE_RAPPORTS,
          skip: page * TAILLE_PAGE_RAPPORTS,
          date: `${depuisMs}-${jusquaMs}`,
        },
      },
      cle,
    );
    const enveloppe = (donnees(resultat) ?? {}) as Record<string, unknown>;
    const lot = enTableau(enveloppe.result).map(versEnvoiSorti);
    envois.push(...lot);
    if (lot.length < TAILLE_PAGE_RAPPORTS) break;
  }
  return envois;
}

export interface TachesReponse {
  readonly taches: EnvoiSorti[];
  /** `true` quand `totalCount` dépasse ce que les pages récupérées ont rendu : il en reste, la relève doit le signaler. */
  readonly sature: boolean;
}

/**
 * Tâches `reply` en file chez SalesBlink. `type` est omis du paramétrage :
 * l'OpenAPI n'accepte que `draft | scheduled | sent`, « Omit `type` to get
 * replies » — mesuré le 11/09 : avec ou sans `type: 'reply'` (hors énumération),
 * même réponse, mais rien ne garantit que SalesBlink continue de l'accepter.
 * Paginé comme `listerEnvoisSortis` (`skip` = décalage d'enregistrements sur
 * `/inbox`, pas un numéro de page comme sur `/reports`) : sans pagination, une
 * relance en attente au-delà de la centième tâche ne serait jamais vue.
 * `totalCount` (rendu par l'enveloppe) dit s'il en reste au-delà des pages
 * récupérées.
 */
export async function listerTachesReponse(cle: string, options: { maxPages?: number } = {}): Promise<TachesReponse> {
  const maxPages = options.maxPages ?? PAGES_MAX_PAR_DEFAUT;
  const taches: EnvoiSorti[] = [];
  let totalCount: number | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const resultat = await appeler(
      'GET',
      '/inbox',
      { parametres: { limit: TAILLE_PAGE_RAPPORTS, skip: page * TAILLE_PAGE_RAPPORTS } },
      cle,
    );
    const enveloppe = (donnees(resultat) ?? {}) as Record<string, unknown>;
    totalCount = nombreOuNull(enveloppe.totalCount) ?? totalCount;
    const lot = enTableau(enveloppe.result).map(versEnvoiSorti);
    taches.push(...lot);
    if (lot.length < TAILLE_PAGE_RAPPORTS) break;
  }
  return { taches, sature: totalCount !== null && totalCount > taches.length };
}

export async function repondreDansLeFil(
  messageId: string,
  corpsHtml: string,
  cle: string,
): Promise<{ idTache: string }> {
  const resultat = await appeler('POST', `/inbox/${messageId}/reply`, { corps: { content: corpsHtml } }, cle);
  return { idTache: texte((donnees(resultat) as Record<string, unknown> | null)?.id) };
}

// --- Rapports ---------------------------------------------------------------

function versRapport(brut: unknown): Rapport {
  const ligne = brut as Record<string, unknown>;
  return {
    id: texte(ligne.id),
    horodatageMs: versMs(ligne.time) ?? 0,
    type: texte(ligne.type),
    message: texte(ligne.message),
    email: texteOuNull(ligne.email),
    sequenceId: texteOuNull(ligne.sequence),
    corps: texteOuNull(ligne.body),
  };
}

/**
 * `/replies` documente `since` (rétrocompatible) ainsi que `from`/`to` : la
 * relève fixe les deux bornes de sa fenêtre fermée `[depuisMs, jusquaMs)`,
 * `jusquaMs` omis retombant sur le comportement historique (pas de borne
 * haute, `to` absent de la requête).
 */
export async function listerReponses(
  depuisMs: number,
  cle: string,
  options: { jusquaMs?: number; maxPages?: number } = {},
): Promise<Rapport[]> {
  const maxPages = options.maxPages ?? PAGES_MAX_PAR_DEFAUT;
  const rapports: Rapport[] = [];
  let page = 1;
  for (let i = 0; i < maxPages; i += 1) {
    const resultat = await appeler(
      'GET',
      '/replies',
      { parametres: { from: depuisMs, to: options.jusquaMs, per_page: TAILLE_PAGE_RAPPORTS, page } },
      cle,
    );
    const lot = enTableau(donnees(resultat)).map(versRapport);
    rapports.push(...lot);
    if (lot.length < TAILLE_PAGE_RAPPORTS) break;
    page += 1;
  }
  return rapports;
}

export async function listerRapports(
  p: {
    message: 'Bounced' | 'Unsubscribed' | 'Error' | 'Sent';
    depuisMs: number;
    /** Borne haute de la fenêtre `[depuisMs, jusquaMs)` ; omise = pas de borne haute (comportement historique). */
    jusquaMs?: number;
    maxPages?: number;
  },
  cle: string,
): Promise<Rapport[]> {
  const maxPages = p.maxPages ?? PAGES_MAX_PAR_DEFAUT;
  const rapports: Rapport[] = [];
  let skip = 0;
  for (let i = 0; i < maxPages; i += 1) {
    const resultat = await appeler(
      'GET',
      '/reports',
      { parametres: { message: p.message, from: p.depuisMs, to: p.jusquaMs, limit: TAILLE_PAGE_RAPPORTS, skip } },
      cle,
    );
    const lot = enTableau(donnees(resultat)).map(versRapport);
    rapports.push(...lot);
    if (lot.length < TAILLE_PAGE_RAPPORTS) break;
    // `skip` est un numero de page 0-based, pas un decalage d'enregistrements :
    // l'OpenAPI precise que le serveur le convertit lui-meme en `skip x limit`.
    skip += 1;
  }
  return rapports;
}
