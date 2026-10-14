/**
 * Seconde implémentation de `Dependances` (lot 5, spec §4) : la connexion LinkedIn conduite
 * depuis l'écran. La mécanique (`connecter`, `ouvrirLinkedIn`) reste UNE seule, celle du
 * terminal ; ici seul le dialogue change. L'identifiant et le mot de passe arrivent déjà
 * dans le message `secrets` ; le code arrive plus tard, par `livrerCode` (appelée par
 * l'écoute du canal chiffré).
 *
 * Rien de ce que dit la mécanique n'entre en base tel quel : `ecrire` traduit chaque ligne vers
 * la liste fermée des étapes, des statuts et des motifs, que la base contraint elle aussi. Aucun
 * secret ne peut donc atterrir dans la table, et une exception n'est jamais écrite.
 */
import type pg from 'pg';
import type { Contexte } from '@jay-reach/core';
import { SQL_ECRIRE_ETAT, SQL_VERIFIER_EN_COURS } from './dependances-web-sql.js';
import { pilotageReel, type Dependances, type Invite } from './pilotage.js';

/** Un humain va chercher son code dans sa boîte mail : le terminal garde ses 90 s, l'écran a 5 minutes. */
export const FENETRE_CODE_WEB_MS = 300_000;
const PAS_ATTENTE_CODE_MS = 2_000;

type Etape =
  | 'sortie_controlee'
  | 'navigateur_ouvert'
  | 'identifiants_transmis'
  | 'code_demande'
  | 'approbation_demandee'
  | 'session_active';
type Motif =
  | 'sortie_inattendue'
  | 'sortie_serveur'
  | 'verrou_occupe'
  | 'refuse'
  | 'defi'
  | 'delai';

/** La demande est annulée, expirée ou close : le travail s'arrête, rien n'est plus attendu. */
export class ErreurDemandeInterrompue extends Error {
  constructor() {
    super('Demande de connexion interrompue');
    this.name = 'ErreurDemandeInterrompue';
  }
}

/** Le code n'est pas arrivé dans la fenêtre. */
export class ErreurDelaiCode extends Error {
  constructor() {
    super('Le code n’est pas arrivé dans la fenêtre');
    this.name = 'ErreurDelaiCode';
  }
}

/** Lignes du CLI (`connecter`) vers étape ou issue. Comparaison sur le début de ligne, jamais sur le reste. */
const LIGNES: { debut: string; effet: { etape: Etape } | { motif: Motif } | { reussi: true } }[] = [
  { debut: 'Sortie du navigateur :', effet: { etape: 'sortie_controlee' } },
  { debut: 'Session LinkedIn active.', effet: { reussi: true } },
  { debut: 'Sortie inattendue', effet: { motif: 'sortie_inattendue' } },
  { debut: 'Le navigateur sort par l’IP du serveur', effet: { motif: 'sortie_serveur' } },
  { debut: 'Un autre processus conduit', effet: { motif: 'verrou_occupe' } },
  { debut: 'LinkedIn demande une vérification', effet: { motif: 'defi' } },
  // Même motif en base (la demande a bien buté sur une vérification), mais l'écran sait déjà
  // laquelle : il affichait l'attente d'approbation juste avant. Sans cette ligne, l'échec
  // n'écrirait aucun motif et l'écran resterait muet sur la cause.
  { debut: 'LinkedIn attendait une approbation', effet: { motif: 'defi' } },
  // Panne du défi chez LinkedIn, pas un défi que nous aurions échoué à passer. Même motif en base
  // (la demande a bien buté sur une vérification), mais un message qui dit laquelle, et quand.
  { debut: 'LinkedIn a refusé la vérification', effet: { motif: 'defi' } },
  { debut: 'Délai dépassé', effet: { motif: 'delai' } },
  { debut: 'Échec (ErreurDelaiCode)', effet: { motif: 'delai' } },
  { debut: 'Connexion refusée', effet: { motif: 'refuse' } },
];


export interface OptionsWeb {
  env?: Record<string, string | undefined>;
  /** Remplacables en test. */
  base?: Pick<
    Dependances,
    'ouvrirNavigateur' | 'releverSortie' | 'releverTitulaire' | 'ipDuProcessus' | 'pause'
  >;
  fenetreCodeMs?: number;
}

export type DependancesWeb = Dependances & {
  /** Remet le code reçu par le canal chiffré à la mécanique qui l'attend (ou le garde s'il arrive avant). */
  livrerCode(code: string): void;
  /** Attend que les écritures d'état parties depuis `ecrire` (synchrone) soient terminées. */
  vider(): Promise<void>;
};

export function dependancesWeb(
  demandeId: string,
  secrets: { identifiant: string; motDePasse: string },
  pool: pg.Pool,
  options: OptionsWeb = {},
): DependancesWeb {
  const base = options.base ?? pilotageReel;
  const fenetre = options.fenetreCodeMs ?? FENETRE_CODE_WEB_MS;
  let codeRecu: string | null = null;
  let ecritures: Promise<void> = Promise.resolve();
  let ctx: Contexte | null = null;

  /** Relit l'état : une demande annulée, expirée ou close interrompt. */
  async function verifierEnCours(): Promise<void> {
    const r = await pool.query<{ ok: boolean }>(
      SQL_VERIFIER_EN_COURS,
      [demandeId],
    );
    if (r.rows[0]?.ok !== true) throw new ErreurDemandeInterrompue();
  }

  /** Ne touche qu'une demande encore en cours : une annulation n'est jamais écrasée. */
  async function ecrireEtat(
    etape: Etape | null,
    statut: string | null,
    motif: Motif | null,
    delaiMs: number | null,
  ): Promise<void> {
    await pool.query(
      SQL_ECRIRE_ETAT,
      [demandeId, etape, statut, motif, delaiMs],
    );
  }

  const enfiler = (etape: Etape | null, statut: string | null, motif: Motif | null, delaiMs: number | null = null): void => {
    ecritures = ecritures
      .then(() => ecrireEtat(etape, statut, motif, delaiMs))
      // Type seul : une erreur de base peut porter la requête.
      .catch((e: unknown) =>
        console.error(`[dependances-web] écriture d'état abandonnée (${e instanceof Error ? e.name : 'erreur'})`),
      );
  };

  async function attendreCode(): Promise<string> {
    for (let ecoule = 0; ; ecoule += PAS_ATTENTE_CODE_MS) {
      if (codeRecu !== null) {
        const c = codeRecu;
        codeRecu = null;
        return c;
      }
      if (ecoule >= fenetre) throw new ErreurDelaiCode();
      await verifierEnCours();
      await base.pause(PAS_ATTENTE_CODE_MS);
    }
  }

  return {
    env: options.env ?? process.env,
    ecrire(ligne) {
      const regle = LIGNES.find((l) => ligne.startsWith(l.debut));
      if (!regle) {
        // Jamais son texte : une ligne imprévue peut porter autre chose que ce que nous écrivons.
        console.error('[connexion-linkedin] ligne non reconnue, ignorée');
        return;
      }
      // Les lignes de `LIGNES` sont les nôtres, et aucune n'interpole de secret. Ce sont les seules
      // traces de ce qui s'est passé : la base ne garde que l'étape et le motif, donc le détail qui
      // explique un échec (le chemin où LinkedIn s'est arrêté, l'IP de sortie vue) se perdait ici.
      console.log(`[connexion-linkedin] ${ligne}`);
      if ('etape' in regle.effet) enfiler(regle.effet.etape, null, null);
      else if ('motif' in regle.effet) enfiler(null, 'echec', regle.effet.motif);
      else enfiler('session_active', 'reussi', null);
    },
    async contexte() {
      if (ctx) return ctx;
      const r = await pool.query<{ organization_id: string }>(
        'select organization_id from linkedin_connexion_demandes where id = $1',
        [demandeId],
      );
      const organisationId = r.rows[0]?.organization_id;
      if (!organisationId) throw new ErreurDemandeInterrompue();
      ctx = { ex: pool, organisationId, utilisateurId: null, role: null };
      return ctx;
    },
    async ouvrirNavigateur() {
      // Avant tout : une demande annulée ou expirée ne doit pas faire piloter un navigateur pour un écran vide.
      await verifierEnCours();
      const pilote = await base.ouvrirNavigateur();
      enfiler('navigateur_ouvert', 'navigateur_ouvert', null);
      return pilote;
    },
    releverSortie: (p) => base.releverSortie(p),
    releverTitulaire: (p, ip) => base.releverTitulaire(p, ip),
    ipDuProcessus: () => base.ipDuProcessus(),
    pause: (ms) => base.pause(ms),
    async demander(invite: Invite) {
      if (invite !== 'identifiant') throw new Error('invite_inattendue');
      await verifierEnCours();
      return secrets.identifiant;
    },
    async demanderMasque(invite: Invite) {
      if (invite === 'motDePasse') {
        await verifierEnCours();
        enfiler('identifiants_transmis', null, null);
        return secrets.motDePasse;
      }
      if (invite !== 'code') throw new Error('invite_inattendue');
      // L'échéance de la demande devient celle de la saisie du code : c'est elle que l'écran annonce.
      enfiler('code_demande', 'code_demande', null, fenetre);
      return attendreCode();
    },
    /**
     * Rien n'est attendu de l'écran ici : l'opérateur approuve sur son téléphone, et c'est l'URL
     * que surveille la mécanique qui nous l'apprendra. On pose l'étape et son échéance — comme
     * pour le code, c'est elle que l'écran affiche en compte à rebours — puis on rend la main.
     */
    async annoncerApprobationMobile(delaiMs) {
      await verifierEnCours();
      enfiler('approbation_demandee', 'approbation_demandee', null, delaiMs);
    },
    livrerCode(code) {
      codeRecu = code;
    },
    vider: () => ecritures,
  };
}
