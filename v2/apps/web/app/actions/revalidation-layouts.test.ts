/**
 * P5 : sans rechargement complet, une Server Action n'actualise un layout que
 * si elle le revalide. Deux layouts affichent des données que des actions
 * modifient : la barre latérale (`app/(app)/layout.tsx`) et l'en-tête de
 * campagne (`campaigns/[id]/layout.tsx`). Chaque action revalide celui dont une
 * donnée change, et seulement celui-là.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../lib/contexte', () => ({ contexteCourant: vi.fn() }));
vi.mock('../../lib/salesblink', () => ({ resolveSalesblinkKey: vi.fn(), listerBoitesSalesBlink: vi.fn() }));
vi.mock('@jay-reach/providers/outreach', () => ({ activerLectureBoite: vi.fn(), santeBoite: vi.fn(), repondreDansLeFil: vi.fn() }));
vi.mock('@jay-reach/core', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@jay-reach/core')>();
  const ok = () => vi.fn(async () => ({ ok: true, ajoutes: 0, id: 'x', sourcesDeclenchees: 0 }));
  return {
    ...reel,
    lancer: ok(),
    mettreEnPause: ok(),
    reporterEnvoi: ok(),
    ecarterDuneCampagne: ok(),
    relancerEnvoi: ok(),
    approuverEnvoi: ok(),
    rejeterEnvoi: ok(),
    lancerTache: ok(),
    basculerPauseEnvoi: ok(),
    ecrireReglage: ok(),
    modifierBoite: ok(),
    relierBoite: ok(),
    nePlusContacter: ok(),
    reprendreInscription: ok(),
    creerSource: ok(),
    ajouterDepuisListe: ok(),
    modifierReglagesCampagne: ok(),
  };
});

import { revalidatePath } from 'next/cache';
import { contexteCourant } from '../../lib/contexte';
import { actionLancer, actionMettreEnPause } from './campagne-cycle';
import { actionEcarterDuneCampagne, actionReporterEnvoi, actionRelancerEnvoi } from './file-du-jour';
import { setActionApproval } from './approvals';
import { actionLancerTache, actionBasculerPauseEnvoi } from './moteur';
import { actionEcrireReglage } from './plafonds';
import { actionModifierBoite } from './senders';
import { actionNePlusContacter } from './contacts';
import { reprendreInscription } from './campaigns';
import { actionCreerSource, actionAjouterDepuisListe } from './sources';
import { actionModifierReglagesCampagne } from './campagne-reglages';

const ROOT = ['/', 'layout'] as const;
const campagne = (id: string) => [`/campaigns/${id}`, 'layout'] as const;

function aEteRevalide(chemin: readonly [string, string]): boolean {
  return vi.mocked(revalidatePath).mock.calls.some((c) => c[0] === chemin[0] && c[1] === chemin[1]);
}

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  vi.mocked(contexteCourant).mockResolvedValue({
    organisationId: 'org-1',
    role: 'admin',
    ex: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  } as unknown as Awaited<ReturnType<typeof contexteCourant>>);
});

describe('actions qui changent l’en-tête ET la jauge (envois planifiés, statut de campagne)', () => {
  it.each([
    ['actionLancer', () => actionLancer('c1'), 'c1'],
    ['actionMettreEnPause', () => actionMettreEnPause('c1'), 'c1'],
    ['actionEcarterDuneCampagne', () => actionEcarterDuneCampagne('ct1', 'c1'), 'c1'],
    ['actionReporterEnvoi', () => actionReporterEnvoi('a1', 'c1'), 'c1'],
    ['actionRelancerEnvoi', () => actionRelancerEnvoi('a1', 'c1'), 'c1'],
    ['setActionApproval', () => setActionApproval('org-1', 'a1', 'approve'), '[id]'],
    ['actionNePlusContacter', () => actionNePlusContacter('ct1'), '[id]'],
    ['reprendreInscription', () => reprendreInscription('i1', 'c1'), 'c1'],
  ])('%s revalide le layout de campagne et celui de la barre latérale', async (_nom, appel, id) => {
    await appel();
    expect(aEteRevalide(campagne(id))).toBe(true);
    expect(aEteRevalide(ROOT)).toBe(true);
  });
});

describe('actions qui ne changent que l’en-tête ou les compteurs d’onglets de la campagne', () => {
  it.each([
    ['actionCreerSource', () => actionCreerSource('c1', { providerId: 'x' })],
    ['actionAjouterDepuisListe', () => actionAjouterDepuisListe('c1', { listId: 'l1' })],
    ['actionModifierReglagesCampagne', () => actionModifierReglagesCampagne('c1', { name: 'N' })],
  ])('%s revalide le layout de campagne, pas celui de la barre latérale', async (_nom, appel) => {
    await appel();
    expect(aEteRevalide(campagne('c1'))).toBe(true);
    expect(aEteRevalide(ROOT)).toBe(false);
  });
});

describe('actions qui changent la barre latérale seulement', () => {
  it.each([
    ['actionLancerTache (carte Moteur)', () => actionLancerTache('scrape')],
    ['actionBasculerPauseEnvoi (carte Moteur)', () => actionBasculerPauseEnvoi(true)],
    ['actionModifierBoite (plafond = quotas des boîtes actives)', () => actionModifierBoite({})],
    ['actionEcrireReglage fuseau (bornes du jour, heures)', () => actionEcrireReglage('fuseau', 'Europe/Paris')],
  ])('%s', async (_nom, appel) => {
    await appel();
    expect(aEteRevalide(ROOT)).toBe(true);
  });

  it('un réglage que le layout ne lit pas (scoring par jour) ne revalide pas la barre latérale', async () => {
    await actionEcrireReglage('scoring_par_jour', 100);
    expect(revalidatePath).toHaveBeenCalledWith('/settings/limits');
    expect(aEteRevalide(ROOT)).toBe(false);
  });
});

describe('un échec ne revalide rien de plus', () => {
  it('lancer refusé (manques) ne touche aucun layout', async () => {
    const { lancer } = await import('@jay-reach/core');
    vi.mocked(lancer).mockResolvedValueOnce({ ok: false, manques: ['pas de boîte'] } as never);
    await actionLancer('c1');
    expect(aEteRevalide(ROOT)).toBe(false);
    expect(aEteRevalide(campagne('c1'))).toBe(false);
  });
});
