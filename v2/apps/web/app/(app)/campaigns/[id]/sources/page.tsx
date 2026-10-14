import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { listerListesOrganisation, listerPersonasCampagne, listerSourcesCampagne, type ListeResume } from '@jay-reach/core';
import { contexteCourant } from '../../../../../lib/contexte';
import { lireVueDEnsembleCourante } from '../../../../../lib/campagne';
import { EtatVide, TuileLogo } from '../../../../../components/ui';
import { FUSEAU_PAR_DEFAUT, dateCourte } from '../../../../../lib/dates';
import { CarteSource } from '../../../../../components/sources/CarteSource';
import {
  construireBlocsLinkedIn,
  construireBlocsOffres,
  marquesDe,
  sousTitreDe,
} from '../../../../../components/sources/blocsCarteSource';
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

export default async function CampagneSourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const ctx = await contexteCourant();
  const [t, sp, sources, vue, personas] = await Promise.all([
    getTranslations('campagne.sources'),
    searchParams,
    listerSourcesCampagne(ctx, { campagneId: id }),
    lireVueDEnsembleCourante(ctx, id),
    listerPersonasCampagne(ctx, { campagneId: id }),
  ]);

  // Le persona se lit où Réglages le lit (`entry_rules.personas`) : le nom de la campagne n'est pas
  // un persona. Aucun persona ciblé => le texte ne prétend pas en citer un.
  const nomsPersonas = personas.map((p) => p.nom).join(', ');

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
        active: carte.active,
        totalLu: carte.totalLu,
        premierPassage: carte.premierPassage,
        providerIds: carte.providerIds.filter(
          (p): p is 'adzuna' | 'france_travail' => p === 'adzuna' || p === 'france_travail',
        ),
      };
      tiroir =
        carte.providerId === 'adzuna' || carte.providerId === 'france_travail' ? (
          <TiroirSourceOffres
            campagneId={id}
            providerId={carte.providerId}
            source={source}
            persona={nomsPersonas || null}
          />
        ) : (
          <TiroirSourceLinkedIn
            campagneId={id}
            providerId={carte.providerId}
            source={source}
            personas={personas}
            statutCampagne={vue.campagne.statut}
          />
        );
    }
  } else if (brutAjouter === 'adzuna' || brutAjouter === 'france_travail') {
    tiroir = (
      <TiroirSourceOffres
        campagneId={id}
        providerId={brutAjouter}
        source={null}
        persona={nomsPersonas || null}
      />
    );
  } else if (brutAjouter && estLinkedIn(brutAjouter)) {
    tiroir = (
      <TiroirSourceLinkedIn
        campagneId={id}
        providerId={brutAjouter}
        source={null}
        personas={personas}
        statutCampagne={vue.campagne.statut}
      />
    );
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
          <p>{nomsPersonas ? t('description', { persona: nomsPersonas }) : t('descriptionSansPersona')}</p>
        </div>
        <MenuAjouterSource campagneId={id} />
      </div>

      {vue.listeSource ? (
        // Campagne à liste importée : la liste EST sa source (même carte que la vue d'ensemble et
        // la Séquence). Sans elle cet onglet affirmait « Aucune source » face à trois écrans qui
        // en montraient une.
        <div className="jr-carte">
          <div className="jr-qui">
            <TuileLogo marque="lettre" lettre={vue.listeSource.nom.charAt(0).toUpperCase()} />
            <span>
              <b>{vue.listeSource.nom}</b>
              <small>
                {t('listSubtitle', {
                  n: vue.listeSource.contacts,
                  date: dateCourte(vue.listeSource.importeeLe, new Date(), FUSEAU_PAR_DEFAUT),
                })}
              </small>
            </span>
          </div>
        </div>
      ) : null}

      {sources.length === 0 && !vue.listeSource ? (
        <EtatVide titre={t('empty.title')} texte={t('empty.text')} />
      ) : (
        sources.map((carte) => (
          <CarteSource
            key={carte.id}
            campagneId={id}
            sourceId={carte.id}
            marques={marquesDe(carte.providerIds)}
            titre={carte.nom}
            sousTitre={sousTitreDe(carte, t)}
            active={carte.active}
            collecteDisponible={carte.collecteDisponible}
            blocs={
              carte.providerId === 'adzuna' || carte.providerId === 'france_travail'
                ? construireBlocsOffres(carte, t)
                : construireBlocsLinkedIn(carte, t)
            }
            retenus7j={carte.dernierPassage ? carte.retenus7j : null}
            sansGraphe={carte.providerId.startsWith('linkedin_')}
          />
        ))
      )}

      {tiroir}
    </section>
  );
}
