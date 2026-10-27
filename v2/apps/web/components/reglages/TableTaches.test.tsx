import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { CorpsTableTaches, type CorpsTableTachesProps, type LigneTache, type TableTachesLibelles } from './TableTaches';

const tm = fr.reglages.moteur.taches;
const LIBELLES: TableTachesLibelles = {
  titre: tm.titre,
  sousTitre: tm.sousTitre,
  lancer: tm.lancer,
  enCours: tm.enCours,
  confirmer: tm.confirmer,
  annuler: tm.annuler,
};

/** Les props qui ne sont pas le sujet : aucune confirmation ouverte, rien d'en cours. */
const SANS_ACTION: Pick<CorpsTableTachesProps, 'aConfirmer' | 'onDemander' | 'onAnnuler'> = {
  aConfirmer: null,
  onDemander: () => {},
  onAnnuler: () => {},
};

/** React échappe l'apostrophe (`&#x27;`) : on relit le texte tel que l'humain le voit. */
function texte(html: string): string {
  return html.replace(/&#x27;/g, "'");
}

/**
 * Les tests de ce dépôt tournent sous Node, sans DOM : pour « cliquer », on cherche dans l'arbre
 * d'éléments que rend le composant (sans état, sans hook) celui qui porte le rappel voulu, et on
 * l'appelle. On ne déroule pas les sous-composants : leurs props suffisent à dire quel rappel y est
 * branché, et leur rendu se prouve par `renderToStaticMarkup`.
 */
function trouverRappel(noeud: unknown, nomProp: string, enfant?: string): (() => void) | null {
  if (Array.isArray(noeud)) {
    for (const n of noeud) {
      const trouve = trouverRappel(n, nomProp, enfant);
      if (trouve) return trouve;
    }
    return null;
  }
  if (typeof noeud !== 'object' || noeud === null || !isValidElement<Record<string, unknown>>(noeud)) return null;
  const props = noeud.props;
  const rappel = props[nomProp];
  if (typeof rappel === 'function' && (enfant === undefined || props.children === enfant)) {
    return () => rappel();
  }
  // `titre` et `children` : les deux endroits où `Carte` reçoit du contenu.
  return trouverRappel(props.children, nomProp, enfant) ?? trouverRappel(props.titre, nomProp, enfant);
}

const AIDE_CONTINU = 'Tourne en continu côté serveur, toutes les 15 minutes environ. Aucun déclenchement manuel possible ici.';

const LIGNES: LigneTache[] = [
  {
    cle: 'sources',
    titre: 'Passage de toutes les sources',
    detail: 'Adzuna, France Travail',
    lancable: true,
    confirmation: tm.sources.confirmation,
  },
  { cle: 'scoring', titre: 'Scoring des signaux en attente', detail: '136 signaux', lancable: false, aide: AIDE_CONTINU },
  {
    cle: 'enrichissement',
    titre: 'Enrichissement des contacts sans email',
    detail: '2 contacts',
    lancable: false,
    aide: AIDE_CONTINU,
  },
  {
    cle: 'releve',
    titre: 'Relève des réponses SalesBlink',
    detail: 'dernière 10:47',
    lancable: false,
    enCours: true,
    confirmation: tm.releve.confirmation,
  },
];

describe('CorpsTableTaches', () => {
  it('active le bouton Lancer seulement pour la tâche lançable', () => {
    const html = renderToStaticMarkup(
      <CorpsTableTaches lignes={LIGNES} enAttente={null} {...SANS_ACTION} onLancer={() => {}} libelles={LIBELLES} />,
    );
    // Quatre lignes : scoring et enrichissement portent une aide et n'ont pas de bouton (tour de
    // correction F6, point 15 — un bouton grisé qui ne fera jamais rien n'a pas sa place) ; seules
    // « sources » (lançable) et « relève » (désactivée, sans aide) gardent un bouton.
    expect(html).toContain('Passage de toutes les sources');
    expect((html.match(/disabled=""/g) ?? []).length).toBe(1);
  });

  it('ne montre aucun bouton « Lancer » pour les tâches à traitement continu (scoring, enrichissement)', () => {
    const html = renderToStaticMarkup(
      <CorpsTableTaches lignes={LIGNES} enAttente={null} {...SANS_ACTION} onLancer={() => {}} libelles={LIBELLES} />,
    );
    const indexScoring = html.indexOf('Scoring des signaux en attente');
    const indexEnrichissement = html.indexOf('Enrichissement des contacts sans email');
    const indexReleve = html.indexOf('Relève des réponses SalesBlink');
    expect(html.slice(indexScoring, indexEnrichissement)).not.toContain('>Lancer<');
    expect(html.slice(indexEnrichissement, indexReleve)).not.toContain('>Lancer<');
  });

  it('affiche la puce « En cours » pour la tâche déjà en cours', () => {
    const html = renderToStaticMarkup(
      <CorpsTableTaches lignes={LIGNES} enAttente={null} {...SANS_ACTION} onLancer={() => {}} libelles={LIBELLES} />,
    );
    expect(html).toContain('jr-puce accent');
    expect(html).toContain('En cours');
  });

  it('désactive tous les boutons restants pendant qu’une tâche est en attente', () => {
    const html = renderToStaticMarkup(
      <CorpsTableTaches lignes={LIGNES} enAttente="sources" {...SANS_ACTION} onLancer={() => {}} libelles={LIBELLES} />,
    );
    // Seuls « sources » et « relève » ont un bouton (scoring/enrichissement n'en ont pas, aide n° 15).
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it('affiche la ligne d’aide « traitement continu » pour scoring et enrichissement, jamais pour sources (tour de correction 1, Important n° 1)', () => {
    const html = renderToStaticMarkup(
      <CorpsTableTaches lignes={LIGNES} enAttente={null} {...SANS_ACTION} onLancer={() => {}} libelles={LIBELLES} />,
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

describe('la confirmation avant « Lancer »', () => {
  function corps(surcharge: Partial<CorpsTableTachesProps> = {}) {
    return CorpsTableTaches({
      lignes: LIGNES,
      enAttente: null,
      ...SANS_ACTION,
      onLancer: () => {},
      libelles: LIBELLES,
      ...surcharge,
    });
  }

  it('un clic sur « Lancer » demande confirmation et ne lance rien', () => {
    const onDemander = vi.fn();
    const onLancer = vi.fn();
    const clic = trouverRappel(corps({ onDemander, onLancer }), 'onClick', 'Lancer');
    expect(clic).not.toBeNull();
    clic?.();
    expect(onDemander).toHaveBeenCalledWith('sources');
    expect(onLancer).not.toHaveBeenCalled();
  });

  it('sans demande en cours, aucune confirmation n’est affichée', () => {
    const html = renderToStaticMarkup(corps());
    expect(texte(html)).not.toContain(tm.sources.confirmation);
    expect(html).not.toContain(tm.confirmer);
  });

  it('une fois demandée, la confirmation dit ce que « Lancer » déclenche', () => {
    const html = texte(renderToStaticMarkup(corps({ aConfirmer: 'sources' })));
    expect(html).toContain(
      'Cela lance dès maintenant la collecte de toutes les sources actives, sans attendre leur passage prévu.',
    );
    expect(html).toContain('Oui, lancer');
    expect(html).toContain('Annuler');
    // La confirmation est sous la tâche demandée, pas sous une autre.
    const iSources = html.indexOf('Passage de toutes les sources');
    const iConfirmation = html.indexOf('Cela lance dès maintenant');
    const iScoring = html.indexOf('Scoring des signaux en attente');
    expect(iConfirmation).toBeGreaterThan(iSources);
    expect(iConfirmation).toBeLessThan(iScoring);
  });

  it('« Oui, lancer » est la seule voie qui exécute la tâche, « Annuler » n’exécute rien', () => {
    const onLancer = vi.fn();
    const onAnnuler = vi.fn();
    const arbre = corps({ aConfirmer: 'sources', onLancer, onAnnuler });
    // Les deux boutons vivent dans la confirmation : on lit les rappels que la table lui a branchés.
    trouverRappel(arbre, 'onAnnuler')?.();
    expect(onAnnuler).toHaveBeenCalledTimes(1);
    expect(onLancer).not.toHaveBeenCalled();
    trouverRappel(arbre, 'onConfirmer')?.();
    expect(onLancer).toHaveBeenCalledWith('sources');
  });
});
