import Link from 'next/link';
import { ORDRE_STATUTS, type StatutContactCampagne } from '@jay-reach/core';

export interface FiltresStatutsProps {
  /** Route de base (`/campaigns/<id>/contacts`) — la variante `global` (tâche 18) pointera vers une autre route. */
  base: string;
  compteurs: Record<StatutContactCampagne | 'tous', number>;
  filtreActif: StatutContactCampagne | 'tous';
  /** Recherche courante (`?q=`), préservée en changeant de filtre. */
  recherche?: string;
  libelles: { tous: string } & Record<StatutContactCampagne, string>;
}

function classePuce(actif: boolean): string {
  return ['jr-puce', actif ? 'accent' : undefined].filter(Boolean).join(' ');
}

function lien(base: string, recherche: string | undefined, filtre: StatutContactCampagne | 'tous'): string {
  const params = new URLSearchParams();
  if (filtre !== 'tous') params.set('filtre', filtre);
  if (recherche) params.set('q', recherche);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Puces de filtre par statut (spec §6.5) : chaque puce est un lien vers
 * `?filtre=...` (le filtrage se fait à la lecture de `searchParams`, page
 * serveur — même motif que `PucesDeFiltre`, liste des campagnes, tâche 9) ;
 * `q` est préservé d'un filtre à l'autre.
 */
export function FiltresStatuts({ base, compteurs, filtreActif, recherche, libelles }: FiltresStatutsProps) {
  return (
    <div className="jr-puces">
      <Link href={lien(base, recherche, 'tous')} className={classePuce(filtreActif === 'tous')}>
        {libelles.tous} {compteurs.tous}
      </Link>
      {ORDRE_STATUTS.map((statut) => (
        <Link key={statut} href={lien(base, recherche, statut)} className={classePuce(filtreActif === statut)}>
          {libelles[statut]} {compteurs[statut]}
        </Link>
      ))}
    </div>
  );
}
