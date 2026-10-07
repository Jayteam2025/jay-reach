/**
 * Handler d'ENVOI LinkedIn par le serveur (lot 4b, tâche 5).
 *
 * Il prend UNE action dans `linkedin_action_queue` et la fait partir : c'est donc lui
 * qui décide si une invitation peut partir deux fois. La règle qui prime sur tout le
 * reste : au pire une action perdue, JAMAIS une action envoyée deux fois.
 *
 * Ce qui la tient :
 *  - `reclamerProchaineAction` passe la ligne en `processing` AVANT tout appel réseau,
 *    et elle n'en ressort que par `enregistrerResultat` (sent / failed) ou par une
 *    remise en attente EXPLICITE quand on SAIT que rien n'est parti ;
 *  - tout ce qui est ambigu après le premier POST (statut inattendu, coupure, erreur
 *    inconnue) s'enregistre `failed / resultat_indetermine` : l'action est perdue pour
 *    la file, mais LinkedIn n'est jamais prié de la refaire ;
 *  - un envoi parti dont l'enregistrement échoue est RETENTÉ côté base, jamais côté
 *    LinkedIn.
 *
 * Ordre, calqué sur `traiterCollecteLinkedIn` : garde du canal, session active, verrou
 * (propriétaire `envoi-<organisation>`), navigateur, relève de sortie puis contrôle,
 * réclamation, lecture du profil, envoi, enregistrement. Chaque appel LinkedIn est
 * tracé AVANT de partir. La file est en `retryLimit: 0` : pg-boss ne rejoue jamais ce job.
 *
 * Aucun secret, aucune URL de proxy dans un message ou un journal : seul `err.name`
 * sort d'ici, et les erreurs que ce fichier lève sont écrites ici, jamais copiées.
 */
import type { Pool } from 'pg';
import {
  bloquerSessionLinkedIn,
  compterRequetesLinkedIn,
  enregistrerResultat,
  jourCourantDansFuseau,
  lireFuseauLinkedIn,
  lirePlafondLinkedIn,
  lireSessionLinkedIn,
  mettreEnPauseEnvoiLinkedIn,
  prendreVerrouLinkedIn,
  prochainEnvoiLinkedIn,
  reclamerProchaineAction,
  reparerLignesCoincees,
  remettreActionEnAttente,
  tracerEnvoiLinkedIn,
  type ActionReclamee,
  type Contexte,
  type Sortie,
} from '@jay-reach/core';
import { controlerSortie } from '../linkedin/controle-sortie.js';
import {
  envoyerInvitation,
  envoyerMessage,
  resoudreProfil,
  ErreurEnvoi,
  type CodeRefus,
  type ResultatEnvoi,
} from '../linkedin/envoi.js';
import type { Pilote } from '../linkedin/navigateur.js';

/** Charge utile de la file. Le job ne nomme pas d'action : c'est la file, sous rythme, qui choisit. */
export interface EnvoiLinkedInJob {
  readonly organizationId: string;
}

/** Tout ce que le handler touche hors base, injecté pour que les tests ne parlent jamais à LinkedIn. */
export interface DependancesEnvoi {
  readonly pool: Pool;
  readonly env: Record<string, string | undefined>;
  ouvrirNavigateur(): Promise<Pilote>;
  releverSortie(pilote: Pilote): Promise<Sortie>;
  pause(ms: number): Promise<void>;
}

/**
 * Durée du verrou : une action, soit une lecture, une courte pause et un POST. Cinq minutes
 * couvrent largement un navigateur lent et restent sous le délai au-delà duquel la file
 * remet une ligne `processing` en attente (`PROCESSING_TIMEOUT_MIN`, dix minutes) : un verrou
 * plus long que lui retiendrait la session pour un worker que la file croit déjà mort.
 */
export const DUREE_VERROU_ENVOI_MS = 5 * 60_000;

/** Fenêtre glissante du plafond horaire : la dernière heure, pas l'heure en cours. */
const UNE_HEURE_MS = 3_600_000;
/** Requêtes qu'une action peut émettre : chargement du fil, profil, expéditeur (message), envoi. */
const REQUETES_PAR_ENVOI = 4;

/** Tentatives de la lecture d'un profil avant d'abandonner l'action. */
const MAX_TENTATIVES_LECTURE = 3;
/** Tentatives d'ENREGISTREMENT d'un résultat déjà acquis. Elles ne touchent jamais LinkedIn. */
const TENTATIVES_ENREGISTREMENT = 3;
const ATTENTE_ENREGISTREMENT_MS = 1_000;

export const MSG = {
  canal: 'Le canal LinkedIn serveur est désactivé (JAY_REACH_LINKEDIN).',
  session: 'La session LinkedIn n’est pas active : l’envoi attend la reconnexion du compte.',
  verrou: 'Un autre passage conduit déjà le navigateur LinkedIn.',
  navigateur: 'Le navigateur LinkedIn est injoignable : vérifiez le conteneur et sa configuration.',
  releve: 'Impossible de relever l’IP de sortie du navigateur : le proxy ne répond pas.',
  sortie: 'Le navigateur est sorti par une adresse inattendue : envoi annulé.',
  pauseImpossible:
    'LinkedIn limite le compte mais la pause n’a pas pu être posée : la session est bloquée par précaution.',
  indetermine:
    'LinkedIn a répondu de façon imprévue : l’envoi a peut-être abouti. Vérifiez sur LinkedIn, l’action ne sera pas rejouée.',
} as const;

/** Motif lisible de chaque refus définitif, écrit à l'écran : jamais un extrait de réponse LinkedIn. */
const MOTIFS: Record<CodeRefus, string> = {
  not_logged_in: 'La session LinkedIn n’est plus valide.',
  defi: 'LinkedIn demande une vérification d’identité.',
  restricted: 'LinkedIn limite temporairement le compte.',
  already_invited: 'Une invitation est déjà en attente pour cette personne.',
  cannot_invite: 'LinkedIn refuse d’inviter cette personne.',
  cannot_message: 'LinkedIn refuse le message : la personne n’est sans doute pas une relation de premier degré.',
  profile_not_found: 'Profil LinkedIn introuvable : vérifiez l’adresse.',
  invalid_url: 'Adresse LinkedIn invalide.',
  bad_request: 'LinkedIn a refusé la forme de la demande (texte vide ou profil illisible).',
  note_non_supportee: 'Une note d’invitation est demandée, et l’envoi serveur ne sait pas en porter.',
};

/** Code consigné quand on ne sait pas si l'action est partie. Il n'a jamais de reprise. */
const RESULTAT_INDETERMINE = 'resultat_indetermine';

type Phase = 'lecture' | 'envoi';

type Issue =
  | { type: 'envoye' }
  | { type: 'refus'; code: CodeRefus }
  | { type: 'rien_parti' }
  | { type: 'indetermine' };

function erreurNommee(nom: string, message: string): Error {
  const e = new Error(message);
  e.name = nom;
  return e;
}

const nomDe = (err: unknown): string => (err instanceof Error ? err.name : 'Erreur');

/**
 * Minuit du lendemain dans `fuseau`, en instant UTC. `Intl` donne le décalage du fuseau à un
 * instant donné ; on le corrige en deux passes parce que le décalage du minuit visé peut
 * différer de celui d'aujourd'hui (passage à l'heure d'hiver ou d'été).
 */
export function minuitSuivant(fuseau: string, maintenant: Date): Date {
  const [annee, mois, jour] = jourCourantDansFuseau(fuseau, maintenant).split('-').map(Number) as [number, number, number];
  const cible = Date.UTC(annee, mois - 1, jour + 1, 0, 0, 0);
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: fuseau,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const decalage = (t: number): number => {
    const p = Object.fromEntries(format.formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - t;
  };
  let t = cible;
  for (let i = 0; i < 3; i += 1) t = cible - decalage(t);
  return new Date(t);
}

/**
 * Le pilote dont chaque navigation et chaque requête est tracée AVANT de partir : le plafond
 * horaire compte des requêtes réellement émises. Une trace qui échoue empêche l'appel, et
 * porte un nom qui dit que rien n'est parti.
 */
function piloteTrace(pilote: Pilote, tracer: () => Promise<void>, avantPost: () => void): Pilote {
  const avant = async (): Promise<void> => {
    try {
      await tracer();
    } catch {
      throw erreurNommee('TraceImpossible', 'La trace de la requête LinkedIn n’a pas pu être écrite.');
    }
  };
  return {
    ...pilote,
    aller: async (url) => {
      await avant();
      return pilote.aller(url);
    },
    requete: async (url, entetes, corps) => {
      await avant();
      // Un `corps` fait partir un POST. La bascule se fait ICI, juste avant lui et après sa
      // trace : tout ce qui échoue plus tôt (lecture du profil, de l'expéditeur, trace) n'a
      // rien envoyé, même sous forme d'une erreur réseau anonyme.
      if (corps !== undefined) avantPost();
      return pilote.requete(url, entetes, corps);
    },
  };
}

/** Lit l'action jusqu'à son enregistrement. `phase` dit si un POST a pu partir. */
async function executer(
  d: DependancesEnvoi,
  action: ActionReclamee,
  p: Pilote,
): Promise<Issue> {
  // Refus qui ne demandent aucun appel : on ne charge pas un profil pour les découvrir.
  // Un texte de message vide n'a jamais de raison de partir ; une note d'invitation, que
  // l'envoi serveur ne sait pas porter, est un refus définitif (le contrat est `null`, jamais "").
  const texte = (action.messageBody ?? '').trim();
  if (action.kind === 'message' && texte === '') return { type: 'refus', code: 'bad_request' };
  if (action.kind === 'invite' && texte !== '') return { type: 'refus', code: 'note_non_supportee' };

  let urn: string;
  try {
    urn = await resoudreProfil(p, action.linkedinUrl);
  } catch (err) {
    if (err instanceof ErreurEnvoi) return { type: 'refus', code: err.code };
    throw err;
  }

  // Allure humaine entre la lecture du profil et l'envoi. La phase ne bascule pas ici :
  // `envoyerMessage` commence par un GET `/me`, la bascule est posée par le pilote tracé.
  await d.pause(3_000 + Math.floor(Math.random() * 4_000));

  const resultat: ResultatEnvoi =
    action.kind === 'invite'
      ? await envoyerInvitation(p, urn, null)
      : await envoyerMessage(p, urn, texte);
  return resultat.ok ? { type: 'envoye' } : { type: 'refus', code: resultat.code };
}

/**
 * Ce qu'une erreur levée dit de l'état de l'action. Tant que le POST n'a pas été
 * entamé, seuls des GET (ou notre trace) ont pu partir : rien n'est parti, quelle que
 * soit l'erreur, nommée ou anonyme. Une fois le POST entamé, toute erreur est ambiguë.
 */
function classer(phase: Phase): Issue {
  return phase === 'lecture' ? { type: 'rien_parti' } : { type: 'indetermine' };
}

export async function traiterEnvoiLinkedIn(d: DependancesEnvoi, job: EnvoiLinkedInJob): Promise<void> {
  const { pool } = d;
  const ctx: Contexte = { ex: pool, organisationId: job.organizationId, utilisateurId: null, role: null };

  if (d.env.JAY_REACH_LINKEDIN !== '1') {
    console.warn(`[envoi-linkedin] ${MSG.canal}`);
    return;
  }
  // Réparation d'état AVANT tout, session ou non, file vide ou non : une action serveur coincée
  // devient `failed / resultat_indetermine` dès ce tick, visible pour l'opérateur. Sans cela la
  // sonde ci-dessous arrêterait le tour sur une file qui se vide et la ligne resterait
  // `processing` indéfiniment, perdue en silence. Aucun envoi, aucun navigateur.
  await reparerLignesCoincees(pool, job.organizationId);

  const session = await lireSessionLinkedIn(ctx);
  if (!session || session.etat !== 'active') {
    console.warn(`[envoi-linkedin] ${MSG.session}`);
    return;
  }

  // Jugement AVANT d'ouvrir quoi que ce soit, et c'est le MÊME code que celui du producteur
  // (`prochainEnvoiLinkedIn` : file, pause, fenêtre, plafonds, intervalle de 1 à 20 minutes).
  // Un job peut arriver avant son heure : le producteur n'en voit aucun pendant que le job
  // précédent ouvre son navigateur (la ligne n'est `processing` qu'après le verrou), donc il en
  // dépose un second que la file garde en attente. Ce second job doit l'apprendre en trois SELECT,
  // pas après avoir ouvert Chromium et payé un écho d'IP au proxy pour s'entendre répondre « trop tôt ».
  // Une seule lecture de l'horloge, partagée avec la réclamation : deux horloges pourraient se contredire.
  const maintenant = new Date();
  const prochain = await prochainEnvoiLinkedIn(pool, job.organizationId, maintenant);
  if (prochain.quand === null) {
    console.log(`[envoi-linkedin] rien à envoyer (${prochain.motif})`);
    return;
  }
  if (prochain.quand.getTime() > maintenant.getTime()) {
    console.log('[envoi-linkedin] trop tôt pour le prochain envoi');
    return;
  }

  // Plafond de requêtes de l'heure, partagé avec la collecte (même table, même fenêtre
  // glissante). Lu à chaque job : un plafond abaissé à l'écran freine dès l'action suivante.
  // Avant le verrou et le navigateur : un budget épuisé ne doit rien ouvrir. Une action coûte
  // jusqu'à `REQUETES_PAR_ENVOI` requêtes ; en dessous, on attend plutôt que d'en laisser une
  // moitié partir.
  const [plafondHoraire, deLHeure] = await Promise.all([
    lirePlafondLinkedIn(ctx, 'linkedin_requetes_par_heure'),
    compterRequetesLinkedIn(ctx, new Date(Date.now() - UNE_HEURE_MS)),
  ]);
  if (plafondHoraire - deLHeure < REQUETES_PAR_ENVOI) {
    console.log('[envoi-linkedin] plafond de requêtes de l’heure atteint');
    return;
  }

  const proprietaire = `envoi-${job.organizationId}`;
  let verrouPris = false;
  let pilote: Pilote | null = null;
  try {
    verrouPris = await prendreVerrouLinkedIn(ctx, proprietaire, DUREE_VERROU_ENVOI_MS);
    if (!verrouPris) {
      console.warn(`[envoi-linkedin] ${MSG.verrou}`);
      return;
    }

    try {
      pilote = await d.ouvrirNavigateur();
    } catch (err) {
      // Le message peut porter l'URL du proxy ou du navigateur : seul le type sort.
      console.error(`[envoi-linkedin] navigateur indisponible (${nomDe(err)})`);
      return;
    }

    // Relève ICI, avant d'ouvrir LinkedIn : l'écho d'IP part d'une page neutre. Un proxy qui
    // ne répond pas n'est pas un verdict sur le compte : on s'arrête sans bloquer la session.
    let brute: Sortie;
    try {
      brute = await d.releverSortie(pilote);
    } catch (err) {
      console.error(`[envoi-linkedin] ${MSG.releve} (${nomDe(err)})`);
      return;
    }
    const controle = await controlerSortie(ctx, session.ipAttendue, async () => brute);
    if (!controle.ok) {
      // `verifierSortie` a déjà bloqué la session.
      console.warn(`[envoi-linkedin] ${MSG.sortie}`);
      return;
    }

    // Un job, au plus une action : le rythme (1 à 20 minutes entre deux envois) est celui de la file.
    const reclamation = await reclamerProchaineAction(pool, job.organizationId, maintenant);
    if (reclamation.action === null) {
      console.log(`[envoi-linkedin] rien à envoyer (${reclamation.motif})`);
      return;
    }
    const action = reclamation.action;
    // À partir d'ici la ligne est `processing` : elle n'en sort que par `regler`.

    const phase: { courante: Phase } = { courante: 'lecture' };
    const p = piloteTrace(
      pilote,
      () => tracerEnvoiLinkedIn(ctx, action.id),
      () => {
        phase.courante = 'envoi';
      },
    );
    let issue: Issue;
    try {
      issue = await executer(d, action, p);
    } catch (err) {
      console.error(`[envoi-linkedin] appel interrompu (${nomDe(err)})`);
      issue = classer(phase.courante);
    }

    try {
      await regler(d, ctx, action, issue);
    } catch (err) {
      // L'erreur de base peut porter une chaîne de connexion : on ne laisse sortir que son nom.
      const nom = nomDe(err);
      console.error(`[envoi-linkedin] résultat non enregistré (${nom})`);
      throw erreurNommee('EnregistrementImpossible', `Le résultat de l’action LinkedIn n’a pas pu être enregistré (${nom}).`);
    }
  } finally {
    // Durée nulle, même propriétaire : le verrou tombe tout de suite.
    if (verrouPris) await prendreVerrouLinkedIn(ctx, proprietaire, 0).catch(() => false);
    if (pilote) await pilote.fermer().catch(() => undefined);
  }
}

/** Enregistre un résultat ACQUIS. On retente la base, jamais LinkedIn. */
async function enregistrer(
  d: DependancesEnvoi,
  entree: Parameters<typeof enregistrerResultat>[1],
): Promise<void> {
  for (let essai = 1; ; essai += 1) {
    try {
      if (!(await enregistrerResultat(d.pool, entree))) {
        console.error('[envoi-linkedin] la ligne n’était plus en cours : résultat non enregistré');
      }
      return;
    } catch (err) {
      if (essai >= TENTATIVES_ENREGISTREMENT) throw err;
      console.error(`[envoi-linkedin] enregistrement à retenter (${nomDe(err)})`);
      await d.pause(ATTENTE_ENREGISTREMENT_MS);
    }
  }
}

/**
 * Sort la ligne de `processing`. Chaque branche dit POURQUOI l'action peut, ou non, être
 * rejouée : seule la certitude que rien n'est parti la remet en attente.
 */
async function regler(d: DependancesEnvoi, ctx: Contexte, action: ActionReclamee, issue: Issue): Promise<void> {
  const base = { organizationId: ctx.organisationId, queueId: action.id };
  const remettre = (comptee: boolean) =>
    remettreActionEnAttente(d.pool, ctx.organisationId, action.id, { comptee, maxTentatives: MAX_TENTATIVES_LECTURE });

  if (issue.type === 'envoye') {
    await enregistrer(d, { ...base, status: 'sent' });
    return;
  }
  if (issue.type === 'indetermine') {
    console.warn(`[envoi-linkedin] ${MSG.indetermine}`);
    await enregistrer(d, { ...base, status: 'failed', errorCode: RESULTAT_INDETERMINE, errorMessage: MSG.indetermine });
    return;
  }
  if (issue.type === 'rien_parti') {
    await remettre(true);
    return;
  }

  const { code } = issue;
  if (code === 'not_logged_in' || code === 'defi') {
    // Arrêt SANS reprise automatique : rien ne passe un défi d'identité. On bloque d'abord,
    // pour qu'aucune autre action ne soit tentée même si la suite échoue.
    await bloquerSessionLinkedIn(ctx, code === 'defi' ? 'defi' : 'cookie_refuse');
    // Refus de LinkedIn : rien n'est parti. L'action attend la reconnexion, sans vieillir.
    await remettre(false);
    return;
  }
  if (code === 'restricted') {
    const jusqua = minuitSuivant(await lireFuseauLinkedIn(ctx), new Date());
    const posee = await mettreEnPauseEnvoiLinkedIn(d.pool, ctx.organisationId, jusqua);
    if (!posee) {
      // Aucune ligne de session touchée : le canal n'est PAS en pause. Repartir enverrait un
      // nouveau POST à un compte que LinkedIn vient de limiter ; on bloque la session pour que
      // rien ne parte tant que l'opérateur n'a pas regardé.
      console.error(`[envoi-linkedin] ${MSG.pauseImpossible}`);
      await bloquerSessionLinkedIn(ctx, 'disjoncteur');
    }
    // Rien n'est parti (refus de LinkedIn) : l'action repart à la reprise, sans vieillir.
    await remettre(false);
    return;
  }
  // Refus définitif : le rejouer ne produirait que le même refus.
  console.warn(`[envoi-linkedin] action refusée (${code})`);
  await enregistrer(d, { ...base, status: 'failed', errorCode: code, errorMessage: MOTIFS[code] });
}

/** Les dépendances réelles. L'import du navigateur est dynamique : `puppeteer-core` n'est chargé que si un envoi part. */
export function dependancesEnvoiReelles(pool: Pool): DependancesEnvoi {
  return {
    pool,
    env: process.env,
    ouvrirNavigateur: async () => (await import('../linkedin/navigateur.js')).ouvrirNavigateur(),
    releverSortie: async (p) => (await import('../linkedin/navigateur.js')).releverSortie(p),
    pause: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
