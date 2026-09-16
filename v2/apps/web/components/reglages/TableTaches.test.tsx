import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CorpsTableTaches, type LigneTache, type TableTachesLibelles } from './TableTaches';

const LIBELLES: TableTachesLibelles = {
  titre: 'Lancer une tâche maintenant',
  sousTitre: 'sans attendre le prochain passage planifié',
  lancer: 'Lancer',
  enCours: 'En cours',
};

const AIDE_CONTINU = 'Tourne en continu côté serveur, toutes les 15 minutes environ. Aucun déclenchement manuel possible ici.';

const LIGNES: LigneTache[] = [
  { cle: 'sources', titre: 'Passage de toutes les sources', detail: 'Adzuna, France Travail', lancable: true },
  { cle: 'scoring', titre: 'Scoring des signaux en attente', detail: '136 signaux', lancable: false, aide: AIDE_CONTINU },
  {
    cle: 'enrichissement',
    titre: 'Enrichissement des contacts sans email',
    detail: '2 contacts',
    lancable: false,
    aide: AIDE_CONTINU,
  },
  { cle: 'releve', titre: 'Relève des réponses SalesBlink', detail: 'dernière 10:47', lancable: false, enCours: true },
];

describe('CorpsTableTaches', () => {
  it('active le bouton Lancer seulement pour la tâche lançable', () => {
    const html = renderToStaticMarkup(
      <CorpsTableTaches lignes={LIGNES} enAttente={null} onLancer={() => {}} libelles={LIBELLES} />,
    );
    // Quatre lignes, trois désactivées (scoring, enrichissement, relève) — seule « sources » est lançable.
    expect(html).toContain('Passage de toutes les sources');
    expect((html.match(/disabled=""/g) ?? []).length).toBe(3);
  });

  it('affiche la puce « En cours » pour la tâche déjà en cours', () => {
    const html = renderToStaticMarkup(
      <CorpsTableTaches lignes={LIGNES} enAttente={null} onLancer={() => {}} libelles={LIBELLES} />,
    );
    expect(html).toContain('jr-puce accent');
    expect(html).toContain('En cours');
  });

  it('désactive tous les boutons pendant qu’une tâche est en attente', () => {
    const html = renderToStaticMarkup(
      <CorpsTableTaches lignes={LIGNES} enAttente="sources" onLancer={() => {}} libelles={LIBELLES} />,
    );
    expect((html.match(/disabled=""/g) ?? []).length).toBe(4);
  });

  it('affiche la ligne d’aide « traitement continu » pour scoring et enrichissement, jamais pour sources (tour de correction 1, Important n° 1)', () => {
    const html = renderToStaticMarkup(
      <CorpsTableTaches lignes={LIGNES} enAttente={null} onLancer={() => {}} libelles={LIBELLES} />,
    );
    // Un bouton désactivé sans explication laisserait croire à un bug : chaque tâche non
    // lançable (hors relève, déjà expliquée par sa propre carte en lecture seule) porte l'aide.
    expect((html.match(new RegExp(AIDE_CONTINU, 'g')) ?? []).length).toBe(2);

    const indexSources = html.indexOf('Passage de toutes les sources');
    const indexScoring = html.indexOf('Scoring des signaux en attente');
    const segmentSources = html.slice(indexSources, indexScoring);
    expect(segmentSources).not.toContain(AIDE_CONTINU);
  });
});
