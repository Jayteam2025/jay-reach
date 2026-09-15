import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import {
  listerListesOrganisation,
  listerSourcesCampagne,
  type ListeResume,
  type SourceCarte,
} from '@jay-reach/core';
import { contexteCourant } from '../../../../../lib/contexte';
import { lireVueDEnsembleCourante } from '../../../../../lib/campagne';
import { EtatVide, Puce } from '../../../../../components/ui';
import type { TuileLogoMarque } from '../../../../../components/ui';
import { CarteSource, type BlocCarteSource } from '../../../../../components/sources/CarteSource';
import { MenuAjouterSource } from '../../../../../components/sources/MenuAjouterSource';
import { TiroirSourceOffres } from '../../../../../components/sources/TiroirSourceOffres';
import {
  TiroirSourceLinkedIn,
  type TypeLinkedIn,
} from '../../../../../components/sources/TiroirSourceLinkedIn';
import { TiroirSourceCsv } from '../../../../../components/sources/TiroirSourceCsv';
import { TiroirSourceListe } from '../../../../../components/sources/TiroirSourceListe';
import { TiroirSourceAnnuaire } from '../../../../../components/sources/TiroirSourceAnnuaire';

export const revalidate = 0;

function estLinkedIn(providerId: string): providerId is TypeLinkedIn {
  return providerId.startsWith('linkedin_');
}

function heuresDeSchedule(schedule: string): number {
  const m = /^every (\d+)h$/.exec(schedule);
  return m ? Number(m[1]) : 6;
}

function marqueDe(providerId: SourceCarte['providerId']): TuileLogoMarque {
  if (providerId === 'adzuna') return 'adzuna';
  if (providerId === 'france_travail') return 'francetravail';
  return 'linkedin';
}

function sousTitreDe(carte: SourceCarte): string {
  const config = carte.config as { lieux?: string[]; departement?: string; compteId?: string };
  if (carte.providerId === 'adzuna' || carte.providerId === 'france_travail') {
    const zone =
      config.lieux && config.lieux.length > 0 ? config.lieux.join(', ') : config.departement;
    return zone ?? '—';
  }
  return config.compteId ?? '—';
}

function ListePuces({ valeurs }: { valeurs: string[] }) {
  if (valeurs.length === 0) return <span className="jr-secondaire">—</span>;
  return (
    <div className="jr-puces">
      {valeurs.map((v, i) => (
        <Puce key={i}>{v}</Puce>
      ))}
    </div>
  );
}

function construireBlocsOffres(
  carte: SourceCarte,
  t: Awaited<ReturnType<typeof getTranslations>>,
): BlocCarteSource[] {
  const config = carte.config as {
    motsCles?: string[];
    contrat?: string;
    typeContrat?: string;
    taille?: string;
    departement?: string;
    exclusions?: string[];
  };
  const filtres = [
    config.contrat === 'cdi' || config.typeContrat === 'cdi' ? t('drawer.contractCdi') : null,
    config.taille ?? null,
    config.departement ?? null,
    ...(config.exclusions ?? []),
  ].filter((v): v is string => Boolean(v));

  const formater = (iso: string) =>
    new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const cadence = t('card.everyNHours', { n: heuresDeSchedule(carte.schedule) });
  const passages = carte.dernierPassage
    ? t('card.schedule', {
        cadence,
        dernier: formater(carte.dernierPassage.quand),
        prochain: carte.prochainPassage ? formater(carte.prochainPassage) : '—',
      })
    : t('card.scheduleNoLast', { cadence, prochain: t('card.neverRun') });

  return [
    { libelle: t('card.query'), contenu: <ListePuces valeurs={config.motsCles ?? []} /> },
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

function construireBlocsLinkedIn(
  carte: SourceCarte,
  t: Awaited<ReturnType<typeof getTranslations>>,
): BlocCarteSource[] {
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
    contenu: <span>{t('card.everyNHours', { n: heuresDeSchedule(carte.schedule) })}</span>,
  });
  return blocs;
}

export default async function CampagneSourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const ctx = await contexteCourant();
  const [t, sp, sources, vue] = await Promise.all([
    getTranslations('campagne.sources'),
    searchParams,
    listerSourcesCampagne(ctx, { campagneId: id }),
    lireVueDEnsembleCourante(ctx, id),
  ]);

  const brutAjouter = Array.isArray(sp.ajouter) ? sp.ajouter[0] : sp.ajouter;
  const brutSource = Array.isArray(sp.source) ? sp.source[0] : sp.source;

  let listes: ListeResume[] = [];
  if (brutAjouter === 'list') {
    listes = await listerListesOrganisation(ctx, {});
  }

  let tiroir: ReactNode = null;
  if (brutSource) {
    const carte = sources.find((s) => s.id === brutSource);
    if (carte) {
      const source = {
        id: carte.id,
        nom: carte.nom,
        config: carte.config,
        schedule: carte.schedule,
      };
      tiroir =
        carte.providerId === 'adzuna' || carte.providerId === 'france_travail' ? (
          <TiroirSourceOffres campagneId={id} providerId={carte.providerId} source={source} />
        ) : (
          <TiroirSourceLinkedIn campagneId={id} providerId={carte.providerId} source={source} />
        );
    }
  } else if (brutAjouter === 'adzuna' || brutAjouter === 'france_travail') {
    tiroir = <TiroirSourceOffres campagneId={id} providerId={brutAjouter} source={null} />;
  } else if (brutAjouter && estLinkedIn(brutAjouter)) {
    tiroir = <TiroirSourceLinkedIn campagneId={id} providerId={brutAjouter} source={null} />;
  } else if (brutAjouter === 'csv') {
    tiroir = <TiroirSourceCsv campagneId={id} />;
  } else if (brutAjouter === 'list') {
    tiroir = <TiroirSourceListe campagneId={id} listes={listes} />;
  } else if (brutAjouter === 'directory') {
    tiroir = <TiroirSourceAnnuaire campagneId={id} />;
  }

  return (
    <section className="jr-contenu une-colonne">
      <div className="jr-section-entete">
        <div>
          <h2>{t('title')}</h2>
          <p>{t('description', { persona: vue.campagne.nom })}</p>
        </div>
        <MenuAjouterSource campagneId={id} />
      </div>

      {sources.length === 0 ? (
        <EtatVide titre={t('empty.title')} texte={t('empty.text')} />
      ) : (
        sources.map((carte) => (
          <CarteSource
            key={carte.id}
            campagneId={id}
            sourceId={carte.id}
            marque={marqueDe(carte.providerId)}
            titre={carte.nom}
            sousTitre={sousTitreDe(carte)}
            active={carte.active}
            collecteDisponible={carte.collecteDisponible}
            blocs={
              carte.providerId === 'adzuna' || carte.providerId === 'france_travail'
                ? construireBlocsOffres(carte, t)
                : construireBlocsLinkedIn(carte, t)
            }
            retenus7j={carte.dernierPassage ? carte.retenus7j : null}
          />
        ))
      )}

      {tiroir}
    </section>
  );
}
