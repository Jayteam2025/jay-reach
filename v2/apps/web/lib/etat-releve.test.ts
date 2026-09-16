import { describe, it, expect } from 'vitest';
import { FOURNISSEURS_AVEC_RELEVE, indexerEtatsReleve, resumeReleve } from './etat-releve';

describe('etat de relève par fournisseur', () => {
  it('les deux fournisseurs qui relèvent une boîte sont connus', () => {
    expect([...FOURNISSEURS_AVEC_RELEVE].sort()).toEqual(['microsoft_graph', 'salesblink']);
  });

  it('Microsoft Graph : dernier passage et dernière erreur remontent comme pour SalesBlink', () => {
    const etats = indexerEtatsReleve([
      { provider: 'salesblink', last_run_at: '2026-09-15T10:00:00.000Z', last_error: null },
      { provider: 'microsoft_graph', last_run_at: '2026-09-15T12:00:00.000Z', last_error: 'graph_http 403' },
    ]);

    expect(resumeReleve(etats, 'microsoft_graph')).toEqual({
      lastRunAt: '2026-09-15T12:00:00.000Z',
      lastError: 'graph_http 403',
    });
    expect(resumeReleve(etats, 'salesblink')).toEqual({
      lastRunAt: '2026-09-15T10:00:00.000Z',
      lastError: null,
    });
  });

  it("aucune ligne pour un fournisseur qui relève : l'écran dit « jamais », pas rien", () => {
    expect(resumeReleve(indexerEtatsReleve([]), 'microsoft_graph')).toEqual({ lastRunAt: null, lastError: null });
  });

  it("un fournisseur qui ne relève rien n'affiche aucun état", () => {
    const etats = indexerEtatsReleve([
      { provider: 'microsoft_graph', last_run_at: '2026-09-15T12:00:00.000Z', last_error: null },
    ]);
    expect(resumeReleve(etats, 'fullenrich')).toBeNull();
    expect(resumeReleve(etats, 'anthropic')).toBeNull();
  });

  it('une ligne inattendue en base ne crée pas un état pour un fournisseur sans relève', () => {
    const etats = indexerEtatsReleve([{ provider: 'fullenrich', last_run_at: '2026-09-15T12:00:00.000Z', last_error: null }]);
    expect(resumeReleve(etats, 'fullenrich')).toBeNull();
  });
});
