/**
 * La liste de démarrage de l'écran Aujourd'hui (lot 5).
 *
 * Elle n'a aucun état à elle : elle lit six vérités en base à chaque affichage. C'est ce qui la
 * distingue d'un tutoriel qu'on coche — elle disparaît quand tout est branché, et **revient** si
 * quelque chose se débranche. Un opérateur neuf s'en sert pour démarrer, un opérateur installé
 * s'en sert comme diagnostic.
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
  /** Tout est branché et rien n'a lâché : l'écran n'affiche plus le bloc. */
  terminee: boolean;
}

interface LigneComptes {
  cles: number;
  boites: number;
  personas: number;
  linkedin_statut: string | null;
  sources: number;
  campagnes: number;
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
  const statutLinkedIn = n?.linkedin_statut ?? null;

  const lignes: LigneDemarrage[] = [
    { cle: 'fournisseurs', faite: cles > 0, compte: cles, casse: false, lien: '/settings/providers' },
    { cle: 'boites', faite: boites > 0, compte: boites, casse: false, lien: '/settings/senders' },
    { cle: 'persona', faite: personas > 0, compte: personas, casse: false, lien: '/settings/personas' },
    {
      cle: 'linkedin',
      faite: statutLinkedIn === 'active',
      compte: null,
      // Une session branchée puis tombée n'est pas une session jamais branchée. Mais une
      // session RÉVOQUÉE est un choix de l'opérateur, pas une panne : l'accueil ne doit pas
      // titrer « un branchement a lâché » parce que quelqu'un vient de cliquer « Déconnecter ».
      casse: statutLinkedIn !== null && statutLinkedIn !== 'active' && statutLinkedIn !== 'revoquee',
      lien: '/settings/linkedin',
    },
    { cle: 'source', faite: sources > 0, compte: sources, casse: false, lien: '/campaigns' },
    { cle: 'campagne', faite: campagnes > 0, compte: campagnes, casse: false, lien: '/campaigns' },
  ];

  const faites = lignes.filter((l) => l.faite).length;
  return { lignes, faites, total: lignes.length, terminee: faites === lignes.length };
}

/**
 * Tant que la liste de démarrage est à l'écran, `canal_sans_expediteur` dirait exactement ce que
 * dit déjà sa ligne « votre compte LinkedIn ». Deux fois la même phrase au même endroit, et on
 * cesse de les lire : c'est ainsi qu'une alerte vraie finit par être ignorée.
 *
 * La seule autre subordination du produit est celle de `rien_ne_part`, qui cède devant toute
 * autre alerte (`lireAujourdhui`).
 */
export function alertesSansDoublonDemarrage(alertes: Alerte[], demarrage: Demarrage): Alerte[] {
  if (demarrage.terminee) return alertes;
  return alertes.filter((a) => a.type !== 'canal_sans_expediteur');
}
