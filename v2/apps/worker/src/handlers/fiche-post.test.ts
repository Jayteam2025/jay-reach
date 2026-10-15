/**
 * Rattrapage des fiches de post : ce que ce fichier prouve, et ce qu'il laisse au harnais.
 *
 * Un pool factice ne prouve rien du SQL (voir `collecte-linkedin.test.ts`). La sélection des
 * fiches à lire (incomplète ou absente, tentatives bornées, plafond du jour) et le comportement
 * du handler sur une page illisible sont donc prouvés sur un vrai Postgres, par les sections
 * « rattrapage » de `test/pg-verify/accroche-post.mjs`. Ici : le câblage de la file, que rien
 * d'autre ne garde (l'oublier ferait ouvrir le navigateur depuis Vercel), le réglage, et la garde
 * du canal, qui doit sortir AVANT toute requête.
 */
import { describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { CLES_REGLAGES, QUEUES } from '@jay-reach/core';
import { FILES_AVEC_NAVIGATEUR, FILES_BRANCHEES } from '../traitements.js';
import { traiterFichePost, type DependancesFichePost } from './fiche-post.js';

describe('la file linkedin.fiche-post', () => {
  it('est déclarée, avec deux reprises', () => {
    const file = QUEUES.find((q) => q.name === 'linkedin.fiche-post');
    expect(file?.descriptionKey).toBe('jobs.q.linkedinFichePost');
    expect(file?.retry).toEqual({ retryLimit: 2, retryBackoff: true });
  });

  it('est consommée par le worker', () => {
    expect(FILES_BRANCHEES).toContain('linkedin.fiche-post');
  });

  it('est exclue de la route cron : elle ouvre un navigateur', () => {
    expect(FILES_AVEC_NAVIGATEUR).toContain('linkedin.fiche-post');
  });
});

describe('le plafond linkedin_fiches_post_par_jour', () => {
  it('vaut 20 par défaut et se règle par LINKEDIN_POST_SHEETS_DAILY_CAP', () => {
    const reglage = CLES_REGLAGES.find((r) => r.cle === 'linkedin_fiches_post_par_jour');
    expect(reglage).toEqual({ cle: 'linkedin_fiches_post_par_jour', defaut: 20, env: 'LINKEDIN_POST_SHEETS_DAILY_CAP' });
  });
});

describe('traiterFichePost', () => {
  it('sans le canal LinkedIn, ne touche ni la base ni le navigateur', async () => {
    const pool = new Pool();
    const requete = vi.spyOn(pool, 'query');
    const ouvrir = vi.fn(async () => {
      throw new Error('ne doit pas être appelé');
    });
    const d: DependancesFichePost = {
      pool,
      env: {},
      ouvrirNavigateur: ouvrir,
      releverSortie: async () => ({ ip: '203.0.113.7' }),
      redacteur: async () => null,
    };
    await traiterFichePost(d, { organizationId: 'org-1', postId: 'post-1' });
    expect(requete).not.toHaveBeenCalled();
    expect(ouvrir).not.toHaveBeenCalled();
    await pool.end();
  });
});
