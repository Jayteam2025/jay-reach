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

// Lundi 14 septembre 2026, en journée à Paris — même référence que
// `dates.test.ts` (`libelleJour`) : « aujourd'hui » pour un événement du 14.
const MAINTENANT = new Date('2026-09-14T18:00:00.000Z');
const FUSEAU = 'Europe/Paris';

describe('JournalCampagne', () => {
  it('un filtre choisi construit `?filtre=` et marque la puce active, les autres restent neutres', () => {
    const html = renderToStaticMarkup(
      <JournalCampagne
        base="/campaigns/c1/activity"
        filtreActif="scoring"
        evenements={[evenement()]}
        maintenant={MAINTENANT}
        fuseau={FUSEAU}
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
        maintenant={MAINTENANT}
        fuseau={FUSEAU}
        libelles={LIBELLES_JOURNAL}
      />,
    );
    expect(html).toContain('Scoring : 58 offres lues, 6 retenues');
    expect(html).toContain('meilleur score 91');
  });

  it('regroupe les événements par jour, avec un en-tête « Aujourd’hui » (R53)', () => {
    const html = renderToStaticMarkup(
      <JournalCampagne
        base="/campaigns/c1/activity"
        filtreActif="tout"
        evenements={[evenement(), evenement({ id: 'ev-2', quand: '2026-09-13T08:00:00Z', libelle: 'Passage terminé' })]}
        maintenant={MAINTENANT}
        fuseau={FUSEAU}
        libelles={LIBELLES_JOURNAL}
      />,
    );
    expect(html).toContain('jr-jour');
    // React échappe l'apostrophe en entité HTML dans le texte rendu.
    expect(html).toContain('Aujourd&#x27;hui, lundi 14 septembre');
    expect(html).toContain('Hier, dimanche 13 septembre');
  });

  it('une erreur moteur porte le ton « erreur »', () => {
    const html = renderToStaticMarkup(
      <JournalCampagne
        base="/campaigns/c1/activity"
        filtreActif="erreurs"
        evenements={[evenement({ type: 'engine_error', libelle: 'Échec du cycle' })]}
        maintenant={MAINTENANT}
        fuseau={FUSEAU}
        libelles={LIBELLES_JOURNAL}
      />,
    );
    expect(html).toContain('erreur');
    expect(html).toContain('Échec du cycle');
  });

  it('filtre « tout » sans aucun événement -> état vide plein écran, sans puces de filtre', () => {
    const html = renderToStaticMarkup(
      <JournalCampagne
        base="/campaigns/c1/activity"
        filtreActif="tout"
        evenements={[]}
        maintenant={MAINTENANT}
        fuseau={FUSEAU}
        libelles={LIBELLES_JOURNAL}
      />,
    );
    expect(html).toContain('Aucune activité pour l’instant');
    expect(html).not.toContain('jr-filtres');
  });

  it('filtre précis sans résultat -> message léger, les puces de filtre restent affichées', () => {
    const html = renderToStaticMarkup(
      <JournalCampagne
        base="/campaigns/c1/activity"
        filtreActif="erreurs"
        evenements={[]}
        maintenant={MAINTENANT}
        fuseau={FUSEAU}
        libelles={LIBELLES_JOURNAL}
      />,
    );
    expect(html).toContain('Aucune activité pour ce filtre.');
    expect(html).toContain('jr-filtres');
  });
});

const LIBELLES_REGLAGES = {
  identite: 'Identité',
  nom: 'Nom de la campagne',
  personasTitre: 'Persona ciblé',
  personasVide: 'Aucun persona ciblé.',
  personasAide: 'Les personas se modifient dans',
  personasLien: 'Personas',
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
  boitesNoteAide: 'Cadence, heures et jours se règlent par boîte dans',
  boitesNoteLien: 'Réglages › Expéditeurs',
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
        personas={[]}
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
    expect(html).toContain('href="/settings/senders"');
    expect(html).toContain('Réglages › Expéditeurs');
  });

  it('relecture à 0 (désactivée par défaut) s’affiche bien à 0, pas vide', () => {
    const html = renderToStaticMarkup(
      <CorpsReglagesCampagne
        nom="Directeur commercial"
        onNomChange={() => {}}
        personas={[]}
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
        personas={[]}
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
        personas={[]}
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

  it('deux personas ciblés -> une puce par persona, lien vers l’écran Personas (R54)', () => {
    const html = renderToStaticMarkup(
      <CorpsReglagesCampagne
        nom="x"
        onNomChange={() => {}}
        personas={[
          { id: 'p1', nom: 'Directeur commercial' },
          { id: 'p2', nom: 'Responsable RH' },
        ]}
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
    expect(html).toContain('Directeur commercial');
    expect(html).toContain('Responsable RH');
    expect(html).toContain('href="/settings/personas"');
    expect(html).toContain('Personas');
  });

  it('aucun persona ciblé -> état vide dédié, pas de lien manquant', () => {
    const html = renderToStaticMarkup(
      <CorpsReglagesCampagne
        nom="x"
        onNomChange={() => {}}
        personas={[]}
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
    expect(html).toContain('Aucun persona ciblé.');
  });
});
