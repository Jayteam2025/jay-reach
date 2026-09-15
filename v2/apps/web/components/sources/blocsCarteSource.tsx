import type { getTranslations } from 'next-intl/server';
import { configFormulaireDepuisStockee, heuresDeSchedule, type SourceCarte } from '@jay-reach/core';
import { Puce } from '../ui';
import type { TuileLogoMarque } from '../ui';
import { heureAvecJour } from '../../lib/dates';
import type { BlocCarteSource } from './CarteSource';

type Traducteur = Awaited<ReturnType<typeof getTranslations>>;

export function marqueDe(providerId: SourceCarte['providerId']): TuileLogoMarque {
  if (providerId === 'adzuna') return 'adzuna';
  if (providerId === 'france_travail') return 'francetravail';
  return 'linkedin';
}

/** Un logo par fournisseur réel, dans l'ordre déjà posé par `resoudreProviders` (R44, core). */
export function marquesDe(providerIds: SourceCarte['providerIds']): TuileLogoMarque[] {
  return providerIds.map(marqueDe);
}

/**
 * Sous-titre de la carte Adzuna/France Travail (R43, tour de correction 2) :
 * lu par `configFormulaireDepuisStockee`, jamais directement `carte.config`
 * (dont les clés réelles sont celles du worker — `sousTitreDe` affichait
 * « — » pour toute source migrée avant ce lot). « France entière » plutôt
 * qu'un tiret seul quand aucun lieu n'est choisi : un tiret seul ne dit pas
 * si c'est un réglage ou une donnée manquante.
 */
export function sousTitreDe(carte: SourceCarte, t: Traducteur): string {
  if (carte.providerId !== 'adzuna' && carte.providerId !== 'france_travail') {
    const config = carte.config as { compteId?: string };
    return config.compteId ?? '—';
  }
  const config = configFormulaireDepuisStockee(carte.providerId, carte.config) as {
    lieux: string[];
  };
  return config.lieux.length > 0 ? config.lieux.join(', ') : t('card.franceEntiere');
}

export function ListePuces({ valeurs }: { valeurs: string[] }) {
  if (valeurs.length === 0) return <span className="jr-secondaire">—</span>;
  return (
    <div className="jr-puces">
      {valeurs.map((v, i) => (
        <Puce key={i}>{v}</Puce>
      ))}
    </div>
  );
}

/** Cadence affichée : « Une fois par jour » (clé existante) plutôt que « Toutes les 24 heures », que la valeur stockée soit `daily` ou `every 24h`. */
function cadenceDe(schedule: string, t: Traducteur): string {
  const heures = heuresDeSchedule(schedule);
  return heures === 24 ? t('card.dailySchedule') : t('card.everyNHours', { n: heures });
}

export function construireBlocsOffres(carte: SourceCarte, t: Traducteur): BlocCarteSource[] {
  const config = configFormulaireDepuisStockee(carte.providerId, carte.config) as {
    motsCles: string[];
    contrat?: string;
    typeContrat?: string;
    taille?: string;
    departement?: string;
    exclusions: string[];
  };
  const filtres = [
    config.contrat === 'cdi' || config.typeContrat === 'cdi' ? t('drawer.contractCdi') : null,
    config.taille ?? null,
    config.departement ?? null,
    ...config.exclusions,
  ].filter((v): v is string => Boolean(v));

  const formaterHeure = (iso: string) =>
    new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const cadence = cadenceDe(carte.schedule, t);
  const passages = carte.dernierPassage
    ? t('card.schedule', {
        cadence,
        dernier: formaterHeure(carte.dernierPassage.quand),
        prochain: carte.prochainPassage ? heureAvecJour(carte.prochainPassage) : '—',
      })
    : t('card.scheduleNoLast', { cadence, prochain: t('card.neverRun') });

  return [
    { libelle: t('card.query'), contenu: <ListePuces valeurs={config.motsCles} /> },
    { libelle: t('card.filters'), contenu: <ListePuces valeurs={filtres} /> },
    {
      libelle: t('card.passages'),
      contenu: (
        <div>
          {passages}
          {carte.dernierPassage && (
            <>
              <br />
              <span className="jr-secondaire">
                {t('card.readAndKept', {
                  lus: carte.dernierPassage.lus,
                  retenus: carte.dernierPassage.retenus,
                })}
              </span>
            </>
          )}
        </div>
      ),
    },
  ];
}

export function construireBlocsLinkedIn(carte: SourceCarte, t: Traducteur): BlocCarteSource[] {
  const config = carte.config as {
    urlPost?: string;
    garder?: string[];
    exclurePremierDegre?: boolean;
    comptesConcurrents?: string[];
    sujets?: string[];
    depuisJours?: number;
  };
  const blocs: BlocCarteSource[] = [];
  if (carte.providerId === 'linkedin_post_engagers') {
    blocs.push({ libelle: t('card.postFollowed'), contenu: <span>{config.urlPost ?? '—'}</span> });
    const garde = [
      config.garder?.includes('commente') ? t('drawer.commented') : null,
      config.garder?.includes('reagi') ? t('drawer.reacted') : null,
      config.exclurePremierDegre ? t('drawer.excludeFirstDegree') : null,
    ].filter((v): v is string => Boolean(v));
    blocs.push({ libelle: t('card.keep'), contenu: <ListePuces valeurs={garde} /> });
  } else if (carte.providerId === 'linkedin_competitor_followers') {
    blocs.push({
      libelle: t('drawer.competitorPages'),
      contenu: <ListePuces valeurs={config.comptesConcurrents ?? []} />,
    });
  } else if (carte.providerId === 'linkedin_keywords') {
    blocs.push({
      libelle: t('drawer.topics'),
      contenu: <ListePuces valeurs={config.sujets ?? []} />,
    });
  } else if (carte.providerId === 'linkedin_job_change') {
    blocs.push({
      libelle: t('drawer.sinceDays'),
      contenu: <span>{config.depuisJours ?? 90}</span>,
    });
  }
  blocs.push({
    libelle: t('card.passages'),
    contenu: <span>{cadenceDe(carte.schedule, t)}</span>,
  });
  return blocs;
}
