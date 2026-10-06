import { describe, expect, it } from 'vitest';
import { etatCollecteMaintenant } from './collecte-maintenant';

// « Collecter maintenant » obéit à la règle du worker (R72) : sans campagne ACTIVE rattachée, une
// demande est consommée sans rien collecter. Le bouton ne promet donc que ce que le worker fera.
describe('etatCollecteMaintenant', () => {
  it('campagne en brouillon : bouton désactivé, bandeau de brouillon, aide « une fois la campagne lancée »', () => {
    expect(etatCollecteMaintenant('draft', { active: true })).toEqual({
      actif: false,
      bandeauBrouillon: true,
      cleAide: 'collectNowDraft',
    });
  });

  it('brouillon et source pas encore créée : le brouillon prime (une seule explication)', () => {
    expect(etatCollecteMaintenant('draft', null)).toEqual({
      actif: false,
      bandeauBrouillon: true,
      cleAide: 'collectNowDraft',
    });
  });

  it('campagne active, source pas encore enregistrée : désactivé, sans bandeau', () => {
    expect(etatCollecteMaintenant('active', null)).toEqual({
      actif: false,
      bandeauBrouillon: false,
      cleAide: 'collectNowUnsaved',
    });
  });

  it('campagne active et source enregistrée : le bouton marche', () => {
    expect(etatCollecteMaintenant('active', { active: true })).toEqual({ actif: true, bandeauBrouillon: false, cleAide: null });
  });

  it('campagne active, source en pause : désactivé (lancerPassage exigerait is_active), avec son explication', () => {
    expect(etatCollecteMaintenant('active', { active: false })).toEqual({
      actif: false,
      bandeauBrouillon: false,
      cleAide: 'collectNowPaused',
    });
  });

  it.each(['paused', 'archived'] as const)('campagne %s : désactivé, sans bandeau de brouillon', (statut) => {
    expect(etatCollecteMaintenant(statut, { active: true })).toEqual({
      actif: false,
      bandeauBrouillon: false,
      cleAide: 'collectNowInactive',
    });
  });
});
