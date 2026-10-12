import { describe, expect, it } from 'vitest';
import { etatChoixRythme, type CranRythme } from './rythme-affichage';

const CRANS: readonly CranRythme[] = ['prudent', 'normal', 'soutenu'];

describe('l’état du choix de rythme', () => {
  it('marque le cran appliqué et ne propose rien tant que l’opérateur n’a rien touché', () => {
    const etat = etatChoixRythme(CRANS, 'normal', null);
    expect(etat.crans.find((c) => c.cle === 'normal')?.applique).toBe(true);
    expect(etat.crans.filter((c) => c.applique)).toHaveLength(1);
    expect(etat.aAppliquer).toBeNull();
    expect(etat.surMesure).toBe(false);
  });

  it('le cran appliqué est celui que l’on voit sélectionné avant tout clic', () => {
    const etat = etatChoixRythme(CRANS, 'soutenu', null);
    expect(etat.crans.find((c) => c.cle === 'soutenu')?.choisi).toBe(true);
    expect(etat.crans.filter((c) => c.choisi)).toHaveLength(1);
  });

  it('sélectionner un autre cran fait apparaître ce qu’il y a à appliquer', () => {
    const etat = etatChoixRythme(CRANS, 'normal', 'soutenu');
    expect(etat.aAppliquer).toBe('soutenu');
    expect(etat.crans.find((c) => c.cle === 'soutenu')?.choisi).toBe(true);
    // Le cran en vigueur reste signalé : on compare ce qu'on va faire à ce qui se fait.
    expect(etat.crans.find((c) => c.cle === 'normal')?.applique).toBe(true);
    expect(etat.crans.find((c) => c.cle === 'normal')?.choisi).toBe(false);
  });

  it('re-sélectionner le cran déjà appliqué ne propose rien à écrire', () => {
    expect(etatChoixRythme(CRANS, 'normal', 'normal').aAppliquer).toBeNull();
  });

  it('sur mesure : aucun cran n’est appliqué, et le premier clic propose d’écrire', () => {
    const avant = etatChoixRythme(CRANS, 'personnalise', null);
    expect(avant.surMesure).toBe(true);
    expect(avant.crans.some((c) => c.applique)).toBe(false);
    // Rien n'est sélectionné d'office : proposer un cran coché laisserait croire qu'il s'applique.
    expect(avant.crans.some((c) => c.choisi)).toBe(false);
    expect(avant.aAppliquer).toBeNull();

    const apres = etatChoixRythme(CRANS, 'personnalise', 'prudent');
    expect(apres.aAppliquer).toBe('prudent');
    expect(apres.crans.some((c) => c.applique)).toBe(false);
  });
});
