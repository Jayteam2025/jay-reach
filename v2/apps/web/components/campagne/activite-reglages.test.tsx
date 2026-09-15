import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Evenement } from '@jay-reach/core';
import { JournalCampagne, type FiltreActiviteCampagne } from './JournalCampagne';
import { CorpsReglagesCampagne, type BoiteReglage } from './FormulaireReglagesCampagne';

const LIBELLES_JOURNAL = {
  filtres: {
    tout: 'Tout',
    sources: 'Sources',
    scoring: 'Scoring',
    envois: 'Envois',
    reponses: 'Réponses',
    erreurs: 'Erreurs',
  } satisfies Record<FiltreActiviteCampagne, string>,
  videTitre: 'Aucune activité pour l’instant',
  videTexte: 'Dès le lancement, chaque événement s’inscrira ici.',
  videFiltre: 'Aucune activité pour ce filtre.',
};

function evenement(overrides: Partial<Evenement> = {}): Evenement {
  return {
    id: 'ev-1',
    quand: '2026-09-14T08:00:00Z',
    type: 'scoring_batch',
    libelle: 'Scoring : 58 offres lues, 6 retenues',
    detail: 'meilleur score 91',
    ...overrides,
  };
}

describe('JournalCampagne', () => {
  it('un filtre choisi construit `?filtre=` et marque la puce active, les autres restent neutres', () => {
    const html = renderToStaticMarkup(
      <JournalCampagne
        base="/campaigns/c1/activity"
        filtreActif="scoring"
        evenements={[evenement()]}
        libelles={LIBELLES_JOURNAL}
      />,
    );
    expect(html).toContain('href="/campaigns/c1/activity?filtre=scoring"');
    expect(html).toContain('jr-puce accent');
    // Le filtre « tout » ne porte jamais `?filtre=` (route de base).
    expect(html).toContain('href="/campaigns/c1/activity"');
  });

  it('affiche libellé et détail de chaque événement, tels quels (pas de retraduction)', () => {
    const html = renderToStaticMarkup(
      <JournalCampagne
        base="/campaigns/c1/activity"
        filtreActif="tout"
        evenements={[evenement()]}
        libelles={LIBELLES_JOURNAL}
      />,
    );
    expect(html).toContain('Scoring : 58 offres lues, 6 retenues');
    expect(html).toContain('meilleur score 91');
  });

  it('une erreur moteur porte le ton « erreur »', () => {
    const html = renderToStaticMarkup(
      <JournalCampagne
        base="/campaigns/c1/activity"
        filtreActif="erreurs"
        evenements={[evenement({ type: 'engine_error', libelle: 'Échec du cycle' })]}
        libelles={LIBELLES_JOURNAL}
      />,
    );
    expect(html).toContain('erreur');
    expect(html).toContain('Échec du cycle');
  });

  it('filtre « tout » sans aucun événement -> état vide plein écran, sans puces de filtre', () => {
    const html = renderToStaticMarkup(
      <JournalCampagne base="/campaigns/c1/activity" filtreActif="tout" evenements={[]} libelles={LIBELLES_JOURNAL} />,
    );
    expect(html).toContain('Aucune activité pour l’instant');
    expect(html).not.toContain('jr-filtres');
  });

  it('filtre précis sans résultat -> message léger, les puces de filtre restent affichées', () => {
    const html = renderToStaticMarkup(
      <JournalCampagne base="/campaigns/c1/activity" filtreActif="erreurs" evenements={[]} libelles={LIBELLES_JOURNAL} />,
    );
    expect(html).toContain('Aucune activité pour ce filtre.');
    expect(html).toContain('jr-filtres');
  });
});

const LIBELLES_REGLAGES = {
  identite: 'Identité',
  nom: 'Nom de la campagne',
  ciblageEtRythme: 'Ciblage et rythme',
  scoreMin: 'Score minimal',
  scoreMinSuffixe: '/ 100',
  scoreMinAide: 'de 0 à 100',
  plafondJour: 'Nouveaux contacts par jour',
  plafondJourSuffixe: 'contacts',
  plafondJourAide: 'plafond de la campagne',
  relecture: 'Relecture des premiers envois',
  relectureSuffixe: 'envois',
  relectureAide: '0 = tout part sans relecture',
  boites: 'Boîtes d’envoi',
  boitesAide: 'chaque contact reste lié à la boîte qui lui a écrit la première',
  boitesNote: 'Cadence, heures et jours se règlent par boîte.',
  aucuneBoite: 'Aucune boîte email active pour l’instant.',
};

function boite(overrides: Partial<BoiteReglage> = {}): BoiteReglage {
  return { id: 'b1', identite: 'prospection@exemple.fr', marque: 'outlook', active: true, ...overrides };
}

describe('CorpsReglagesCampagne', () => {
  it('affiche les valeurs initiales transmises (nom, score, plafond, relecture)', () => {
    const html = renderToStaticMarkup(
      <CorpsReglagesCampagne
        nom="Directeur commercial"
        onNomChange={() => {}}
        scoreMin="70"
        onScoreMinChange={() => {}}
        plafondJour="30"
        onPlafondJourChange={() => {}}
        relecture="5"
        onRelectureChange={() => {}}
        boites={[boite()]}
        onToggleBoite={() => {}}
        disabled={false}
        libelles={LIBELLES_REGLAGES}
      />,
    );
    expect(html).toContain('value="Directeur commercial"');
    expect(html).toContain('value="70"');
    expect(html).toContain('value="30"');
    expect(html).toContain('value="5"');
  });

  it('relecture à 0 (désactivée par défaut) s’affiche bien à 0, pas vide', () => {
    const html = renderToStaticMarkup(
      <CorpsReglagesCampagne
        nom="Directeur commercial"
        onNomChange={() => {}}
        scoreMin="70"
        onScoreMinChange={() => {}}
        plafondJour="30"
        onPlafondJourChange={() => {}}
        relecture="0"
        onRelectureChange={() => {}}
        boites={[]}
        onToggleBoite={() => {}}
        disabled={false}
        libelles={LIBELLES_REGLAGES}
      />,
    );
    expect(html).toContain('value="0"');
  });

  it('une boîte active -> interrupteur sans classe `eteint` ; inactive -> `eteint`', () => {
    const html = renderToStaticMarkup(
      <CorpsReglagesCampagne
        nom="x"
        onNomChange={() => {}}
        scoreMin="70"
        onScoreMinChange={() => {}}
        plafondJour="30"
        onPlafondJourChange={() => {}}
        relecture="0"
        onRelectureChange={() => {}}
        boites={[boite({ id: 'b1', active: true }), boite({ id: 'b2', identite: 'autre@exemple.fr', active: false })]}
        onToggleBoite={() => {}}
        disabled={false}
        libelles={LIBELLES_REGLAGES}
      />,
    );
    expect(html).toContain('prospection@exemple.fr');
    expect(html).toContain('autre@exemple.fr');
    expect(html).toContain('jr-interrupteur eteint');
  });

  it('aucune boîte -> message dédié, pas de ligne', () => {
    const html = renderToStaticMarkup(
      <CorpsReglagesCampagne
        nom="x"
        onNomChange={() => {}}
        scoreMin="70"
        onScoreMinChange={() => {}}
        plafondJour="30"
        onPlafondJourChange={() => {}}
        relecture="0"
        onRelectureChange={() => {}}
        boites={[]}
        onToggleBoite={() => {}}
        disabled={false}
        libelles={LIBELLES_REGLAGES}
      />,
    );
    expect(html).toContain('Aucune boîte email active pour l’instant.');
    expect(html).not.toContain('jr-source');
  });
});
