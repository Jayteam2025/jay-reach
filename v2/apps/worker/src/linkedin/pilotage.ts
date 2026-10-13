/**
 * Commandes de la session LinkedIn du serveur (lot 4a), lancées par l'opérateur
 * dans un terminal : `jay-reach linkedin <connecter|statut|deconnecter|ip>`.
 *
 * Rien ici n'accepte un secret en argument : l'identifiant et le mot de passe se
 * saisissent à l'invite (mot de passe et code masqués), donc ni historique du
 * shell, ni liste des processus, ni journal. Rien n'est écrit en base que l'état
 * de la session et l'IP vue. Le navigateur garde ses cookies dans son propre
 * volume.
 *
 * Aucune erreur de navigateur ou de proxy n'est affichée telle quelle : elle peut
 * porter l'URL du proxy avec ses identifiants. On n'écrit que son type.
 */
import {
  activerSessionLinkedIn,
  bloquerSessionLinkedIn,
  confirmerIpAttendue,
  desactiverExpediteurLinkedIn,
  enregistrerCompteLinkedIn,
  enregistrerObservationSortie,
  garantirExpediteurLinkedIn,
  IDENTITE_LINKEDIN_NON_LUE,
  lireDeconnexionDemandeeLinkedIn,
  solderDeconnexionLinkedIn,
  lireSessionLinkedIn,
  prendreVerrouLinkedIn,
  type Contexte,
  type Sortie,
  type Titulaire,
  desaccordDeTitulaire,
} from '@jay-reach/core';
import type { createPool } from '../db.js';
import { controlerSortie } from './controle-sortie.js';
import { ipDuProcessus } from './ip.js';
import { lireCompteConnecte } from './envoi.js';
// Type seul : effacé à la compilation. L'import réel du navigateur est dynamique (voir `dependancesReelles`).
import type { Pilote } from './navigateur.js';

/** Ce que la mécanique demande à l'opérateur ; chaque façade (terminal, écran) l'habille à sa façon. */
export type Invite = 'identifiant' | 'motDePasse' | 'code';

export const LIBELLES: Record<Invite, string> = {
  identifiant: 'Identifiant LinkedIn : ',
  motDePasse: 'Mot de passe : ',
  code: 'Code reçu de LinkedIn : ',
};

export interface Dependances {
  env: Record<string, string | undefined>;
  ecrire(ligne: string): void;
  contexte(): Promise<Contexte>;
  ouvrirNavigateur(): Promise<Pilote>;
  releverSortie(pilote: Pilote): Promise<Sortie>;
  /** Meilleur effort : `null` quand le registre ne répond pas. */
  releverTitulaire(pilote: Pilote, ip: string): Promise<Titulaire | null>;
  /** IP publique du processus worker, donc du VPS (voir `ip.ts`). */
  ipDuProcessus(): Promise<string>;
  demander(invite: Invite): Promise<string>;
  demanderMasque(invite: Invite): Promise<string>;
  pause(ms: number): Promise<void>;
}

const USAGE = [
  'Usage : jay-reach linkedin <commande>',
  '  connecter        ouvre la session LinkedIn (identifiant et mot de passe saisis à l’invite)',
  '  statut           affiche l’état de la session',
  '  deconnecter      révoque la session',
  '  ip [--confirmer] relève l’IP de sortie du navigateur ; --confirmer la pose comme IP attendue',
];

const URL_CONNEXION = 'https://www.linkedin.com/login';
const URL_DECONNEXION = 'https://www.linkedin.com/m/logout/';
/**
 * Ancres de la page de connexion refondue de LinkedIn (mesurées le 07/10 sur la vraie page) :
 * plus de `<form>`, des `id` régénérés à chaque rendu, plus d'attribut `name`, et un bouton
 * d'envoi que seul son texte distingue (donc la langue de l'IP de sortie). Seul l'attribut
 * `autocomplete` des champs et la région `aria-live` du message d'erreur tiennent. Le pilote
 * vise le premier élément VISIBLE : chaque champ existe en double et le premier du DOM est caché.
 *
 * `code` : la page de défi n'a PAS pu être mesurée (il aurait fallu déclencher un vrai défi sur
 * le compte de l'opérateur). `one-time-code` est la convention du champ de code, `name="pin"`
 * l'ancienne ancre gardée en second choix : ce chemin n'est pas vérifié.
 */
const SEL = {
  identifiant: 'input[autocomplete^="username"]',
  motDePasse: 'input[autocomplete="current-password"]',
  erreurConnexion: '[aria-live="assertive"]',
  code: 'input[autocomplete="one-time-code"], input[name="pin"]',
};
const DUREE_VERROU_MS = 15 * 60_000;
const ATTENTE_MAX_CONNEXION_MS = 90_000;
const PAS_MS = 1_000;
const DELAI_APRES_CODE_MS = 20_000;
// Un proxy résidentiel est lent : 1,5 s faisait conclure à un défi sur une simple lenteur.
const DELAI_CHAMP_CODE_MS = 10_000;

/** Nom du type de l'erreur, jamais son message. */
function typeErreur(e: unknown): string {
  return e instanceof Error ? e.name : 'Erreur';
}

function surLinkedIn(url: string, chemin: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)linkedin\.com$/.test(u.hostname) && u.pathname.startsWith(chemin);
  } catch {
    return false;
  }
}

function libelleSortie(s: Sortie): string {
  return [s.ip, s.operateur, s.pays].filter(Boolean).join(' · ');
}

/**
 * Rend à l'opérateur ce que le registre dit de l'IP : qui la détient, et si son
 * adresse contredit le pays déclaré. Information seule : ni code de retour, ni
 * état de session, ni base ne bougent. Une panne du registre ne change rien.
 */
async function afficherTitulaire(d: Dependances, pilote: Pilote, ip: string): Promise<void> {
  let titulaire: Titulaire | null = null;
  try {
    titulaire = await d.releverTitulaire(pilote, ip);
  } catch {
    return;
  }
  if (!titulaire) return;
  const adresse = titulaire.adresses[0];
  if (titulaire.nom || adresse) {
    d.ecrire(`Titulaire de l’IP : ${[titulaire.nom, adresse].filter(Boolean).join(' · ')}`);
  }
  const desaccord = desaccordDeTitulaire(titulaire);
  if (desaccord) d.ecrire(`Attention : ${desaccord}.`);
}

async function statut(ctx: Contexte, d: Dependances): Promise<number> {
  const s = await lireSessionLinkedIn(ctx);
  if (!s) {
    d.ecrire('Session LinkedIn : absente. Lancer « jay-reach linkedin connecter ».');
    return 0;
  }
  const jour = (x: Date | null) => (x ? x.toISOString() : '-');
  d.ecrire(`Session LinkedIn : ${s.etat}${s.motif ? ` (${s.motif})` : ''}`);
  d.ecrire(`  connectée le : ${jour(s.connecteeLe)}`);
  if (s.bloqueeLe) d.ecrire(`  bloquée le : ${jour(s.bloqueeLe)}`);
  d.ecrire(`  IP attendue : ${s.ipAttendue ?? '-'}`);
  d.ecrire(
    `  dernière sortie vue : ${s.ipVue ?? '-'}${s.operateur ? ` · ${s.operateur}` : ''}${s.pays ? ` · ${s.pays}` : ''}`,
  );
  d.ecrire(`  dernière collecte : ${jour(s.derniereCollecte)}`);
  return 0;
}

type Issue =
  | { issue: 'connecte' | 'refuse' | 'defi' }
  | { issue: 'delai'; chemin: string }
  | { issue: 'verification'; cle: string };

/** Chemin seul : la requête d'une URL LinkedIn peut porter des jetons. */
function cheminDe(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '?';
  }
}

/**
 * La clé d'erreur que LinkedIn pose dans l'URL (`?errorKey=...`), et elle seule : le reste de la
 * requête peut porter des jetons. Une valeur qui ne ressemble pas à une clé est écartée plutôt que
 * recopiée dans un message ou un journal.
 */
function cleErreurDe(url: string): string | null {
  try {
    const v = new URL(url).searchParams.get('errorKey');
    return v !== null && /^[a-z0-9_]{1,60}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function messageIssue(r: Issue): string {
  switch (r.issue) {
    case 'connecte':
      return 'Session LinkedIn active.';
    case 'defi':
      return 'LinkedIn demande une vérification que ce terminal ne sait pas passer : session bloquée.';
    case 'verification':
      return `LinkedIn a refusé la vérification (${r.cle}) : réessayer plus tard, sans enchaîner les tentatives.`;
    case 'delai':
      return `Délai dépassé : LinkedIn est resté sur ${r.chemin}. La session n’est pas activée.`;
    case 'refuse':
      return 'Connexion refusée : identifiant ou mot de passe incorrect.';
  }
}

/**
 * Résultat de la saisie des identifiants : connecté, refusé, bloqué par une
 * vérification que le terminal ne sait pas passer, ou délai dépassé (avec le
 * chemin atteint, sans diagnostic inventé).
 */
async function ouvrirLinkedIn(ctx: Contexte, pilote: Pilote, d: Dependances): Promise<Issue> {
  // On navigue d'abord : un profil déjà connecté est redirigé vers /feed, sans rien à saisir.
  await pilote.aller(URL_CONNEXION);
  if (surLinkedIn(await pilote.url(), '/feed')) return { issue: 'connecte' };

  const identifiant = await d.demander('identifiant');
  const motDePasse = await d.demanderMasque('motDePasse');
  await pilote.saisir(SEL.identifiant, identifiant);
  await pilote.saisir(SEL.motDePasse, motDePasse);
  // Entrée depuis le champ soumet le formulaire : aucun clic de bouton, donc aucune dépendance à la langue.
  await pilote.presserEntree(SEL.motDePasse);

  // Après l'envoi du code, LinkedIn met quelques secondes à quitter le défi : on patiente avant de conclure.
  let codeEnvoyeA: number | null = null;
  let dernierChemin = '?';
  for (let ecoule = 0; ecoule < ATTENTE_MAX_CONNEXION_MS; ecoule += PAS_MS) {
    const url = await pilote.url();
    dernierChemin = cheminDe(url);
    if (surLinkedIn(url, '/feed')) return { issue: 'connecte' };
    // LinkedIn annonce son échec dans l'URL et reste sur une page qui n'est ni /feed ni /checkpoint
    // (depuis sa refonte, `/flagship-web/login/`). Sans cette lecture, la boucle attend ses 90 s pour
    // conclure `delai` alors que la réponse est là dès la première seconde — mesuré le 13/10, deux
    // fois, sur `challenge_global_internal_error`.
    const cleErreur = cleErreurDe(url);
    if (cleErreur !== null) return { issue: 'verification', cle: cleErreur };
    if (surLinkedIn(url, '/checkpoint')) {
      if (codeEnvoyeA === null && (await pilote.attendre(SEL.code, DELAI_CHAMP_CODE_MS))) {
        const code = await d.demanderMasque('code');
        await pilote.saisir(SEL.code, code);
        await pilote.presserEntree(SEL.code);
        codeEnvoyeA = ecoule;
      } else if (codeEnvoyeA === null || ecoule - codeEnvoyeA >= DELAI_APRES_CODE_MS) {
        // Captcha, validation sur l'application mobile, ou code refusé : rien que ce terminal sache passer.
        await bloquerSessionLinkedIn(ctx, 'defi');
        return { issue: 'defi' };
      }
    } else if ((await pilote.texte(SEL.erreurConnexion)).trim() !== '') {
      // La région existe DÉJÀ avant l'envoi, vide : seul son texte signale un refus, jamais sa présence.
      return { issue: 'refuse' };
    }
    await d.pause(PAS_MS);
  }
  return { issue: 'delai', chemin: dernierChemin };
}

/**
 * Refuse de figer, ou de confirmer, l'IP du VPS comme IP attendue. Si le proxy est
 * mal formé (Chromium ignore alors la règle) ou n'anonymise pas, la sortie vue EST
 * l'IP du serveur : la figer rendrait le contrôle « conforme » pour toujours.
 */
async function sortieEstCelleDuServeur(d: Dependances, ipVue: string): Promise<boolean> {
  if (ipVue !== (await d.ipDuProcessus())) return false;
  d.ecrire(
    'Le navigateur sort par l’IP du serveur, pas par le proxy : vérifier LINKEDIN_PROXY_URL (navigateur.env). L’IP attendue n’est pas posée.',
  );
  return true;
}

/**
 * Connexion réussie : l'expéditeur LinkedIn existe, est actif, et il n'y en a qu'un (spec §9). Le
 * compte est lu par `/me` ; à défaut, l'identité déjà connue de la session. LÈVE si la garantie échoue :
 * l'appelant révoque alors la session, pour que « connecté » veuille toujours dire « expéditeur actif ».
 */
async function garantirExpediteur(ctx: Contexte, pilote: Pilote, connue: string | null): Promise<void> {
  const compte = await lireCompteConnecte(pilote);
  const identite = compte?.identifiantPublic ?? connue ?? IDENTITE_LINKEDIN_NON_LUE;
  if (compte) await enregistrerCompteLinkedIn(ctx, compte);
  await garantirExpediteurLinkedIn(ctx, identite, `${identite} (LinkedIn)`);
}

export async function connecter(ctx: Contexte, d: Dependances): Promise<number> {
  const session = await lireSessionLinkedIn(ctx);
  // Lue AVANT tout : seule une déconnexion demandée avant cette connexion est périmée par elle.
  const intentionDeconnexion = await lireDeconnexionDemandeeLinkedIn(ctx);
  const proprietaire = `cli-${process.pid}`;
  const pilote = await d.ouvrirNavigateur();
  let verrouPris = false;
  try {
    // La relève part du navigateur, donc du proxy : c'est l'IP que LinkedIn verra.
    const { ok, sortie } = await controlerSortie(ctx, session?.ipAttendue ?? null, () =>
      d.releverSortie(pilote),
    );
    if (!ok) {
      d.ecrire(
        `Sortie inattendue (${sortie.ip}) : session bloquée par précaution, rien n’a été ouvert.`,
      );
      d.ecrire('Si le changement de proxy est voulu : « jay-reach linkedin ip --confirmer ».');
      return 1;
    }
    d.ecrire(`Sortie du navigateur : ${libelleSortie(sortie)}`);
    await afficherTitulaire(d, pilote, sortie.ip);
    if (await sortieEstCelleDuServeur(d, sortie.ip)) return 1;

    // Le verrou suppose la ligne de session : l'observation ci-dessus l'a créée au besoin.
    verrouPris = await prendreVerrouLinkedIn(ctx, proprietaire, DUREE_VERROU_MS);
    if (!verrouPris) {
      d.ecrire('Un autre processus conduit déjà le navigateur LinkedIn : réessayer plus tard.');
      return 1;
    }

    const resultat = await ouvrirLinkedIn(ctx, pilote, d);
    if (resultat.issue === 'connecte') {
      // Première connexion : l'IP attendue se fige sur la sortie vue.
      await activerSessionLinkedIn(ctx, session?.ipAttendue ?? sortie.ip);
      try {
        await garantirExpediteur(ctx, pilote, session?.compteIdentifiant ?? null);
      } catch (e) {
        // Une session active sans expéditeur actif n'enverrait rien et ne dirait pas pourquoi : on la révoque.
        await bloquerSessionLinkedIn(ctx, 'revoquee');
        d.ecrire(`Expéditeur LinkedIn non garanti (${typeErreur(e)}) : session révoquée, reconnecter le compte.`);
        return 1;
      }
      // La dernière volonté exprimée est cette reconnexion, ABOUTIE : sans cela, le prochain démarrage du worker
      // rejouerait la déconnexion demandée avant elle et couperait un compte que personne ne veut couper. Une
      // connexion qui échoue ne solde rien (la session déjà active resterait sinon active, sans que personne
      // ait annulé la déconnexion) ; une demande plus récente que la lecture du début survit.
      if (intentionDeconnexion) await solderDeconnexionLinkedIn(ctx, intentionDeconnexion);
      d.ecrire(messageIssue(resultat));
      return 0;
    }
    d.ecrire(messageIssue(resultat));
    return 1;
  } finally {
    // Durée nulle, même propriétaire : le verrou expire tout de suite. Sans cela le
    // worker attendrait la fin des quinze minutes pour reprendre la main.
    if (verrouPris) await prendreVerrouLinkedIn(ctx, proprietaire, 0).catch(() => false);
    await pilote.fermer().catch(() => undefined);
  }
}

export async function deconnecter(ctx: Contexte, d: Dependances): Promise<number> {
  // Le succès se définit par l'EFFACEMENT des cookies, pas par la navigation : si `/m/logout/` expire ou reste
  // bloquée, le profil garde pourtant le compte, et l'annoncer déconnecté serait le pire mensonge possible.
  let effacee = false;
  let pilote: Pilote | null = null;
  try {
    pilote = await d.ouvrirNavigateur();
  } catch (e) {
    d.ecrire(`Navigateur injoignable (${typeErreur(e)}) : la session est révoquée côté Jay Reach seulement.`);
  }
  if (pilote) {
    try {
      try {
        await pilote.aller(URL_DECONNEXION);
      } catch (e) {
        d.ecrire(`Page de déconnexion non atteinte (${typeErreur(e)}) : effacement des cookies tenté quand même.`);
      }
      // Tenté quoi qu'il arrive à la navigation : le conteneur garde son profil, donc sans cet effacement le
      // compte déconnecté resterait joignable pour le suivant.
      try {
        await pilote.effacerCookies();
        effacee = true;
      } catch (e) {
        d.ecrire(`Cookies du navigateur non effacés (${typeErreur(e)}).`);
      }
    } finally {
      await pilote.fermer().catch(() => undefined);
    }
  }
  // Révoquée et expéditeur désactivé même si le navigateur a échoué : rien ne doit plus envoyer.
  await bloquerSessionLinkedIn(ctx, 'revoquee');
  await desactiverExpediteurLinkedIn(ctx);
  if (!effacee) {
    d.ecrire('Session révoquée côté Jay Reach, mais le compte reste joignable dans le navigateur : déconnexion NON aboutie.');
    return 1;
  }
  d.ecrire('Session LinkedIn révoquée.');
  return 0;
}

async function ip(ctx: Contexte, d: Dependances, confirmer: boolean): Promise<number> {
  const session = await lireSessionLinkedIn(ctx);
  const pilote = await d.ouvrirNavigateur();
  try {
    const sortie = await d.releverSortie(pilote);
    // Observation seule : un écart ne bloque rien ici, c'est l'opérateur qui regarde.
    await enregistrerObservationSortie(ctx, sortie);
    d.ecrire(`Sortie du navigateur : ${libelleSortie(sortie)}`);
    await afficherTitulaire(d, pilote, sortie.ip);
    d.ecrire(`IP attendue : ${session?.ipAttendue ?? '-'}`);
    if (!confirmer) {
      if (session?.ipAttendue && session.ipAttendue !== sortie.ip) {
        d.ecrire(
          'Écart : « jay-reach linkedin ip --confirmer » pose cette sortie comme IP attendue.',
        );
      }
      return 0;
    }
    if (await sortieEstCelleDuServeur(d, sortie.ip)) return 1;
    if (!(await confirmerIpAttendue(ctx, sortie.ip))) {
      d.ecrire('Aucune session : lancer d’abord « jay-reach linkedin connecter ».');
      return 1;
    }
    d.ecrire(`IP attendue posée : ${sortie.ip}`);
    return 0;
  } finally {
    await pilote.fermer().catch(() => undefined);
  }
}

export async function executerCommande(argv: string[], d: Dependances): Promise<number> {
  const [commande, ...reste] = argv;
  const autorises = commande === 'ip' ? ['--confirmer'] : [];
  if (
    !commande ||
    !['connecter', 'statut', 'deconnecter', 'ip'].includes(commande) ||
    reste.some((a) => !autorises.includes(a))
  ) {
    USAGE.forEach((l) => d.ecrire(l));
    return 2;
  }
  // Les commandes qui touchent LinkedIn exigent le drapeau posé exprès ; `statut` n'ouvre rien.
  if (commande !== 'statut' && d.env.JAY_REACH_LINKEDIN !== '1') {
    d.ecrire(
      'Le canal LinkedIn serveur est désactivé : poser JAY_REACH_LINKEDIN=1 dans worker.env, puis relancer.',
    );
    return 1;
  }
  try {
    const ctx = await d.contexte();
    switch (commande) {
      case 'statut':
        return await statut(ctx, d);
      case 'connecter':
        return await connecter(ctx, d);
      case 'deconnecter':
        return await deconnecter(ctx, d);
      default:
        return await ip(ctx, d, reste.includes('--confirmer'));
    }
  } catch (e) {
    d.ecrire(`Échec (${typeErreur(e)}).`);
    return 1;
  }
}

export async function organisationCourante(
  pool: ReturnType<typeof createPool>,
  env: Dependances['env'],
): Promise<string> {
  if (env.JAY_REACH_ORGANISATION_ID) return env.JAY_REACH_ORGANISATION_ID;
  const res = await pool.query<{ id: string }>('select id from organizations limit 2');
  if (res.rows.length !== 1) {
    throw new Error('Organisation ambiguë : poser JAY_REACH_ORGANISATION_ID');
  }
  return res.rows[0]!.id;
}

/** Navigateur et relevés réels, partagés par le terminal et le chemin web. */
export const pilotageReel = {
  // Import dynamique : puppeteer-core ne se charge que si une commande ouvre le navigateur.
  ouvrirNavigateur: async () => (await import('./navigateur.js')).ouvrirNavigateur(),
  releverSortie: async (p: Pilote) => (await import('./navigateur.js')).releverSortie(p),
  releverTitulaire: async (p: Pilote, ip: string) =>
    (await import('./navigateur.js')).releverTitulaire(p, ip),
  ipDuProcessus,
  pause: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};
