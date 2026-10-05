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
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import {
  activerSessionLinkedIn,
  bloquerSessionLinkedIn,
  confirmerIpAttendue,
  enregistrerObservationSortie,
  lireSessionLinkedIn,
  prendreVerrouLinkedIn,
  type Contexte,
  type Sortie,
} from '@jay-reach/core';
import { createPool } from '../db.js';
import { controlerSortie } from '../linkedin/controle-sortie.js';
// Type seul : effacé à la compilation. L'import réel du navigateur est dynamique (voir `dependancesReelles`).
import type { Pilote } from '../linkedin/navigateur.js';

export interface Dependances {
  env: Record<string, string | undefined>;
  ecrire(ligne: string): void;
  contexte(): Promise<Contexte>;
  ouvrirNavigateur(): Promise<Pilote>;
  releverSortie(pilote: Pilote): Promise<Sortie>;
  demander(invite: string): Promise<string>;
  demanderMasque(invite: string): Promise<string>;
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
const SEL = {
  identifiant: '#username',
  motDePasse: '#password',
  envoyer: 'button[type="submit"]',
  erreurMotDePasse: '#error-for-password',
  code: 'input[name="pin"]',
};
const DUREE_VERROU_MS = 15 * 60_000;
const ATTENTE_MAX_CONNEXION_MS = 90_000;
const PAS_MS = 1_000;
const DELAI_APRES_CODE_MS = 20_000;

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

/**
 * Résultat de la saisie des identifiants : connecté, refusé, ou bloqué par une
 * vérification que le terminal ne sait pas passer.
 */
async function ouvrirLinkedIn(
  ctx: Contexte,
  pilote: Pilote,
  d: Dependances,
): Promise<'connecte' | 'refuse' | 'defi'> {
  const identifiant = await d.demander('Identifiant LinkedIn : ');
  const motDePasse = await d.demanderMasque('Mot de passe : ');
  await pilote.aller(URL_CONNEXION);
  await pilote.saisir(SEL.identifiant, identifiant);
  await pilote.saisir(SEL.motDePasse, motDePasse);
  await pilote.cliquer(SEL.envoyer);

  // Après l'envoi du code, LinkedIn met quelques secondes à quitter le défi : on patiente avant de conclure.
  let codeEnvoyeA: number | null = null;
  for (let ecoule = 0; ecoule < ATTENTE_MAX_CONNEXION_MS; ecoule += PAS_MS) {
    const url = await pilote.url();
    if (surLinkedIn(url, '/feed')) return 'connecte';
    if (surLinkedIn(url, '/checkpoint')) {
      if (codeEnvoyeA === null && (await pilote.attendre(SEL.code, 1_500))) {
        const code = await d.demanderMasque('Code reçu de LinkedIn : ');
        await pilote.saisir(SEL.code, code);
        await pilote.cliquer(SEL.envoyer);
        codeEnvoyeA = ecoule;
      } else if (codeEnvoyeA === null || ecoule - codeEnvoyeA >= DELAI_APRES_CODE_MS) {
        // Captcha, validation sur l'application mobile, ou code refusé : rien que ce terminal sache passer.
        await bloquerSessionLinkedIn(ctx, 'defi');
        return 'defi';
      }
    } else if (await pilote.attendre(SEL.erreurMotDePasse, 500)) {
      return 'refuse';
    }
    await d.pause(PAS_MS);
  }
  return 'refuse';
}

async function connecter(ctx: Contexte, d: Dependances): Promise<number> {
  const session = await lireSessionLinkedIn(ctx);
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

    // Le verrou suppose la ligne de session : l'observation ci-dessus l'a créée au besoin.
    verrouPris = await prendreVerrouLinkedIn(ctx, proprietaire, DUREE_VERROU_MS);
    if (!verrouPris) {
      d.ecrire('Un autre processus conduit déjà le navigateur LinkedIn : réessayer plus tard.');
      return 1;
    }

    const issue = await ouvrirLinkedIn(ctx, pilote, d);
    if (issue === 'connecte') {
      // Première connexion : l'IP attendue se fige sur la sortie vue.
      await activerSessionLinkedIn(ctx, session?.ipAttendue ?? sortie.ip);
      d.ecrire('Session LinkedIn active.');
      return 0;
    }
    d.ecrire(
      issue === 'defi'
        ? 'LinkedIn demande une vérification que ce terminal ne sait pas passer : session bloquée.'
        : 'Connexion refusée : identifiant ou mot de passe incorrect.',
    );
    return 1;
  } finally {
    // Durée nulle, même propriétaire : le verrou expire tout de suite. Sans cela le
    // worker attendrait la fin des quinze minutes pour reprendre la main.
    if (verrouPris) await prendreVerrouLinkedIn(ctx, proprietaire, 0).catch(() => false);
    await pilote.fermer().catch(() => undefined);
  }
}

async function deconnecter(ctx: Contexte, d: Dependances): Promise<number> {
  try {
    const pilote = await d.ouvrirNavigateur();
    try {
      await pilote.aller(URL_DECONNEXION);
    } finally {
      await pilote.fermer().catch(() => undefined);
    }
  } catch (e) {
    d.ecrire(
      `Navigateur injoignable (${typeErreur(e)}) : la session est révoquée côté Jay Reach seulement.`,
    );
  }
  await bloquerSessionLinkedIn(ctx, 'revoquee');
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
    d.ecrire(`IP attendue : ${session?.ipAttendue ?? '-'}`);
    if (!confirmer) {
      if (session?.ipAttendue && session.ipAttendue !== sortie.ip) {
        d.ecrire(
          'Écart : « jay-reach linkedin ip --confirmer » pose cette sortie comme IP attendue.',
        );
      }
      return 0;
    }
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

/** Saisie visible (identifiant). */
function demander(invite: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(invite, (r) => (rl.close(), resolve(r.trim()))));
}

/** Saisie masquée : rien n'est écho sur le terminal. Exige un terminal interactif. */
function demanderMasque(invite: string): Promise<string> {
  if (!process.stdin.isTTY)
    return Promise.reject(new Error('Terminal interactif requis (lancer avec -it)'));
  let muet = false;
  const sortie = new Writable({
    write(morceau, encodage, suite) {
      if (!muet) process.stdout.write(morceau, encodage);
      suite();
    },
  });
  const rl = createInterface({ input: process.stdin, output: sortie, terminal: true });
  process.stdout.write(invite);
  muet = true;
  return new Promise((resolve) =>
    rl.question('', (r) => {
      muet = false;
      rl.close();
      process.stdout.write('\n');
      resolve(r);
    }),
  );
}

async function organisationCourante(
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

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const etat: { pool: ReturnType<typeof createPool> | null } = { pool: null };
  const d: Dependances = {
    env: process.env,
    ecrire: (l) => console.log(l),
    contexte: async () => {
      if (!connectionString) throw new Error('DATABASE_URL manquant');
      const pool = (etat.pool ??= createPool(connectionString));
      const organisationId = await organisationCourante(pool, process.env);
      return { ex: pool, organisationId, utilisateurId: null, role: null };
    },
    // Import dynamique : puppeteer-core ne se charge que si une commande ouvre le navigateur.
    ouvrirNavigateur: async () => (await import('../linkedin/navigateur.js')).ouvrirNavigateur(),
    releverSortie: async (p) => (await import('../linkedin/navigateur.js')).releverSortie(p),
    demander,
    demanderMasque,
    pause: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
  const code = await executerCommande(process.argv.slice(2), d);
  await etat.pool?.end();
  process.exit(code);
}

// Lancé directement (pas importé par les tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
