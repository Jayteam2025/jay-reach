import Link from 'next/link';
import type { ActionJournal, Evenement } from '@jay-reach/core';
import { libelleJour, regrouperParJour } from '../../lib/dates';
import { EtatVide, Filtres, Journal } from '../ui';
import type { EntreeJournal } from '../ui';

/**
 * Valeurs de `filtre` de `schemaActivite` (`packages/core/src/fonctions/campagnes.ts`),
 * dupliquées ici (chaîne littérale, pas d'import d'un schéma Zod côté web —
 * même convention que `ORDRE_STATUTS` réimporté directement là où c'est un
 * type exporté, ici un schéma ne l'est pas) pour piloter les puces de filtre.
 */
export const FILTRES_ACTIVITE = ['tout', 'sources', 'scoring', 'envois', 'reponses', 'erreurs'] as const;
export type FiltreActiviteCampagne = (typeof FILTRES_ACTIVITE)[number];

export interface JournalCampagneLibelles {
  filtres: Record<FiltreActiviteCampagne, string>;
  /** Titre/texte de l'état vide plein écran — campagne qui n'a encore aucune activité (filtre « tout »). */
  videTitre: string;
  videTexte: string;
  /** Message léger, campagne active mais aucun événement pour CE filtre précis. */
  videFiltre: string;
}

export interface JournalCampagneProps {
  /** Route de l'onglet (`/campaigns/<id>/activity`), pour construire les liens `?filtre=`. */
  base: string;
  filtreActif: FiltreActiviteCampagne;
  evenements: readonly Evenement[];
  /** Instant de référence pour « Aujourd'hui »/« Hier » (`regrouperParJour`/`libelleJour`) — un paramètre, jamais lu à l'intérieur (fonction pure, testable sans horloge). */
  maintenant: Date;
  /** Fuseau de l'organisation (R53) : le regroupement par jour et l'heure affichée suivent CE fuseau, pas celui du serveur qui exécute le rendu. */
  fuseau: string;
  libelles: JournalCampagneLibelles;
}

function lienFiltre(base: string, filtre: FiltreActiviteCampagne): string {
  return filtre === 'tout' ? base : `${base}?filtre=${filtre}`;
}

function classePuce(actif: boolean): string {
  return ['jr-puce', actif ? 'accent' : undefined].filter(Boolean).join(' ');
}

/**
 * `heure` de `Journal` (kit ui) — heure seule : le jour est déjà porté par
 * l'en-tête de son groupe (`regrouperParJour`/R53), une date répétée sur
 * chaque ligne serait redondante (même motif que `TableFileDuJour`, qui ne
 * montre que l'heure une fois groupée par tranche).
 */
function heureEvenement(iso: string, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: fuseau }).format(new Date(iso));
}

function tonEvenement(type: ActionJournal): 'erreur' | undefined {
  return type === 'engine_error' ? 'erreur' : undefined;
}

/**
 * Onglet Activité (tâche 13) : puces de filtre (liens `?filtre=`, la page
 * relit `listerActivite` d'après `searchParams`) + journal des événements.
 * Libellé et détail viennent tels quels de `diff.libelle`/`diff.detail`
 * (`ecrireEvenement`, `journal.ts`) — déjà en français, jamais retraduits ici
 * (décision du coordinateur, brief tâche 13).
 *
 * Le filtre « tout » sans aucun événement remplace tout l'écran par un état
 * vide plein écran (rien à filtrer si même « tout » est vide) ; un filtre
 * précis sans résultat garde les puces et affiche un message plus léger à
 * l'intérieur de la carte — comportement pur, aucun hook, testable par
 * `renderToStaticMarkup`.
 */
export function JournalCampagne({ base, filtreActif, evenements, maintenant, fuseau, libelles }: JournalCampagneProps) {
  if (filtreActif === 'tout' && evenements.length === 0) {
    return <EtatVide titre={libelles.videTitre} texte={libelles.videTexte} />;
  }

  const groupes = regrouperParJour(evenements, maintenant, fuseau);

  return (
    <div className="jr-carte">
      <Filtres>
        {FILTRES_ACTIVITE.map((filtre) => (
          <Link key={filtre} href={lienFiltre(base, filtre)} className={classePuce(filtre === filtreActif)}>
            {libelles.filtres[filtre]}
          </Link>
        ))}
      </Filtres>
      <div className="jr-corps">
        {groupes.length === 0 ? (
          <div className="jr-vide">{libelles.videFiltre}</div>
        ) : (
          groupes.map((groupe) => {
            const entrees: EntreeJournal[] = groupe.evenements.map((e) => ({
              heure: heureEvenement(e.quand, fuseau),
              texte: e.libelle,
              note: e.detail ?? undefined,
              ton: tonEvenement(e.type),
            }));
            return (
              <div key={groupe.jour.toISOString()}>
                <h4 className="jr-jour">{libelleJour(groupe.jour, maintenant, 'fr-FR', fuseau)}</h4>
                <Journal entrees={entrees} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
