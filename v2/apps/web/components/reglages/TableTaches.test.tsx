import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CorpsTableTaches, type LigneTache, type TableTachesLibelles } from './TableTaches';

const LIBELLES: TableTachesLibelles = {
  titre: 'Lancer une tâche maintenant',
  sousTitre: 'sans attendre le prochain passage planifié',
  lancer: 'Lancer',
  enCours: 'En cours',
};

const LIGNES: LigneTache[] = [
  { cle: 'sources', titre: 'Passage de toutes les sources', detail: 'Adzuna, France Travail', lancable: true },
  { cle: 'scoring', titre: 'Scoring des signaux en attente', detail: '136 signaux', lancable: false },
  { cle: 'releve', titre: 'Relève des réponses SalesBlink', detail: 'dernière 10:47', lancable: false, enCours: true },
];

describe('CorpsTableTaches', () => {
  it('active le bouton Lancer seulement pour la tâche lançable', () => {
    const html = renderToStaticMarkup(
      <CorpsTableTaches lignes={LIGNES} enAttente={null} onLancer={() => {}} libelles={LIBELLES} />,
    );
    // Trois lignes, deux désactivées (scoring, relève) — seule « sources » est lançable.
    expect(html).toContain('Passage de toutes les sources');
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
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
    expect((html.match(/disabled=""/g) ?? []).length).toBe(3);
  });
});
