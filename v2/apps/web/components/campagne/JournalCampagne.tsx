import Link from 'next/link';
import type { ActionJournal, Evenement } from '@jay-reach/core';
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
  libelles: JournalCampagneLibelles;
}

function lienFiltre(base: string, filtre: FiltreActiviteCampagne): string {
  return filtre === 'tout' ? base : `${base}?filtre=${filtre}`;
}

function classePuce(actif: boolean): string {
  return ['jr-puce', actif ? 'accent' : undefined].filter(Boolean).join(' ');
}

/**
 * `heure` de `Journal` (kit ui) : date courte + heure — le journal d'une
 * campagne mélange des événements d'aujourd'hui et de jours précédents,
 * contrairement à la file du jour (une seule journée, `TableFileDuJour`) qui
 * n'affiche qu'une heure.
 */
function heureEvenement(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
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
export function JournalCampagne({ base, filtreActif, evenements, libelles }: JournalCampagneProps) {
  if (filtreActif === 'tout' && evenements.length === 0) {
    return <EtatVide titre={libelles.videTitre} texte={libelles.videTexte} />;
  }

  const entrees: EntreeJournal[] = evenements.map((e) => ({
    heure: heureEvenement(e.quand),
    texte: e.libelle,
    note: e.detail ?? undefined,
    ton: tonEvenement(e.type),
  }));

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
        {entrees.length === 0 ? <div className="jr-vide">{libelles.videFiltre}</div> : <Journal entrees={entrees} />}
      </div>
    </div>
  );
}
