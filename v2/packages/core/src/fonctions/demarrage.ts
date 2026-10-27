/**
 * La liste de démarrage de l'écran Aujourd'hui (lot 5).
 *
 * Elle n'a aucun état à elle : elle lit six vérités en base à chaque affichage. C'est ce qui la
 * distingue d'un tutoriel qu'on coche. Elle ne se masque plus d'elle-même quand tout est branché
 * (une organisation qui porte déjà les restes d'une recette ou la campagne d'un collègue aurait
 * « tout vert » avant que l'opérateur ait rien fait) : l'opérateur la ferme, l'écran s'en souvient,
 * et elle **revient** si quelque chose se débranche. Un opérateur neuf s'en sert pour démarrer, un
 * opérateur installé s'en sert comme diagnostic.
 *
 * Elle ne double aucune des dix alertes de `aujourdhui.ts`, qui signalent un DÉRÈGLEMENT ; celle-ci
 * signale une MISE EN ROUTE. Seule `canal_sans_expediteur` dirait la même chose qu'une de ses
 * lignes : elle s'efface tant que la liste est visible (voir `lireAujourdhui`).
 */
import type { Contexte } from './contexte.js';
import { exiger } from './contexte.js';
import type { Alerte } from './aujourdhui.js';
import { SQL_DEMARRAGE } from './demarrage-sql.js';

export type CleDemarrage = 'fournisseurs' | 'boites' | 'persona' | 'linkedin' | 'source' | 'campagne';

export interface LigneDemarrage {
  cle: CleDemarrage;
  /** Le branchement est en place. */
  faite: boolean;
  /**
   * Ce qui a été mesuré quand la ligne est faite : jamais un chiffre inventé, et `null` quand la
   * ligne ne se compte pas (le compte LinkedIn est unique par instance).
   */
  compte: number | null;
  /** Branché un jour, cassé depuis : une session LinkedIn bloquée, par exemple. */
  casse: boolean;
  /** Où mène le bouton de la ligne. */
  lien: string;
}

export interface Demarrage {
  lignes: LigneDemarrage[];
  faites: number;
  total: number;
  /** Tout est branché et rien n'a lâché : l'écran le dit, et laisse l'opérateur fermer le bloc. */
  terminee: boolean;
}

interface LigneComptes {
  cles: number;
  boites: number;
  personas: number;
  linkedin_statut: string | null;
  linkedin_motif: string | null;
  sources: number;
  campagnes: number;
  brouillons: number;
}


export async function lireDemarrage(ctx: Contexte): Promise<Demarrage> {
  exiger(ctx, 'viewer');
  const res = await ctx.ex.query<LigneComptes>(SQL_DEMARRAGE, [ctx.organisationId]);
  const n = res.rows[0];

  const cles = n?.cles ?? 0;
  const boites = n?.boites ?? 0;
  const personas = n?.personas ?? 0;
  const sources = n?.sources ?? 0;
  const campagnes = n?.campagnes ?? 0;
  const brouillons = n?.brouillons ?? 0;
  const statutLinkedIn = n?.linkedin_statut ?? null;
  const motifLinkedIn = n?.linkedin_motif ?? null;

  const lignes: LigneDemarrage[] = [
    { cle: 'fournisseurs', faite: cles > 0, compte: cles, casse: false, lien: '/settings/providers' },
    { cle: 'boites', faite: boites > 0, compte: boites, casse: false, lien: '/settings/senders' },
    {
      cle: 'linkedin',
      faite: statutLinkedIn === 'active',
      compte: null,
      // Une session branchée puis tombée n'est pas une session jamais branchée. Mais une
      // session RÉVOQUÉE est un choix de l'opérateur, pas une panne : l'accueil ne doit pas
      // titrer « un branchement a lâché » parce que quelqu'un vient de cliquer « Déconnecter ».
      // Le statut ne suffit pas à les distinguer — une révocation s'écrit `bloquee` comme une
      // panne, et seul `blocked_reason` dit laquelle des deux c'est.
      casse: statutLinkedIn !== null && statutLinkedIn !== 'active' && motifLinkedIn !== 'revoquee',
      lien: '/settings/linkedin',
    },
    { cle: 'persona', faite: personas > 0, compte: personas, casse: false, lien: '/settings/personas' },
    { cle: 'source', faite: sources > 0, compte: sources, casse: false, lien: '/campaigns' },
    // Lancée = une campagne active ET plus de brouillon qui attend : une campagne construite et
    // jamais activée est précisément ce qu'il reste à lancer, même si une autre tourne déjà.
    { cle: 'campagne', faite: campagnes > 0 && brouillons === 0, compte: campagnes, casse: false, lien: '/campaigns' },
  ];

  const faites = lignes.filter((l) => l.faite).length;
  return { lignes, faites, total: lignes.length, terminee: faites === lignes.length };
}

/**
 * Le bloc est à l'écran tant que l'opérateur ne l'a pas fermé. Fermé, il ne revient que pour un
 * branchement qui a lâché : c'est le diagnostic, qu'une fermeture ne doit pas éteindre.
 */
export function demarrageAffichee(demarrage: Demarrage, ferme: boolean): boolean {
  return !ferme || demarrage.lignes.some((l) => l.casse);
}

/**
 * Tant que la liste de démarrage est à l'écran, `canal_sans_expediteur` dirait exactement ce que
 * dit déjà sa ligne « votre compte LinkedIn ». Deux fois la même phrase au même endroit, et on
 * cesse de les lire : c'est ainsi qu'une alerte vraie finit par être ignorée.
 *
 * La seule autre subordination du produit est celle de `rien_ne_part`, qui cède devant toute
 * autre alerte (`lireAujourdhui`).
 */
export function alertesSansDoublonDemarrage(
  alertes: Alerte[],
  demarrage: Demarrage,
  /** Le bloc est réellement à l'écran : fermé par l'opérateur, il ne redit plus rien. */
  affichee: boolean = true,
): Alerte[] {
  if (!affichee || demarrage.terminee) return alertes;
  return alertes.filter((a) => a.type !== 'canal_sans_expediteur');
}
