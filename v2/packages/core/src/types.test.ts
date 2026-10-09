import { describe, expect, it } from 'vitest';
import { KINDS_PERSONNE, estSignalDePersonne, sqlEstSignalDePersonne } from './types.js';

/**
 * Ces contrôles gardent la VÉRITÉ de la famille, pas sa forme.
 *
 * Partout ailleurs, les contrôles dérivent de `sqlEstSignalDePersonne` pour ne pas figer une
 * typographie — mais une assertion dérivée suit le code, y compris dans l'erreur. Si la famille
 * perdait `people_search`, tous ces contrôles dérivés resteraient verts et la source
 * « recherche par mot-clé » cesserait silencieusement d'être scorée, purgée et enrichie.
 * Ceux-ci nomment donc les valeurs attendues.
 */
describe('la famille des signaux de personne', () => {
  it('porte les deux natures qui décrivent une personne, et elles seules', () => {
    expect([...KINDS_PERSONNE].sort()).toEqual(['people_search', 'post_engagement']);
  });

  it('reconnaît chaque membre, et refuse les signaux d’entreprise', () => {
    for (const kind of KINDS_PERSONNE) expect(estSignalDePersonne(kind)).toBe(true);
    for (const kind of ['job_posting', 'appointment', 'tradeshow', '', 'people']) {
      expect(estSignalDePersonne(kind)).toBe(false);
    }
  });

  it('produit un fragment SQL qui nomme chaque membre et porte l’alias demandé', () => {
    const fragment = sqlEstSignalDePersonne('s');
    expect(fragment.startsWith('s.kind = any(')).toBe(true);
    for (const kind of KINDS_PERSONNE) expect(fragment).toContain(kind);
    // Le transtypage compte : sans lui, Postgres compare un enum à du texte et refuse.
    expect(fragment).toContain('::signal_kind[]');
    expect(sqlEstSignalDePersonne('sig')).toContain('sig.kind');
  });
});
