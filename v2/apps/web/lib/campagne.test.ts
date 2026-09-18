import { describe, expect, it } from 'vitest';
import { compteurOngletSources } from './campagne';

// Constat recette du 18/09 : l'onglet « Sources 0 » d'une campagne à liste laissait croire à un
// réglage manquant, alors que `nombreSources` (campaign_sources) est légitimement nul pour ce
// type de campagne — alimentée par sa liste importée, pas par des sources signal.
describe('compteurOngletSources', () => {
  it('campagne à sources : le compteur réel, même à 0', () => {
    expect(compteurOngletSources('sources', 3)).toBe(3);
    expect(compteurOngletSources('sources', 0)).toBe(0);
  });

  it('campagne à liste : jamais de badge, quel que soit `nombreSources`', () => {
    expect(compteurOngletSources('liste', 0)).toBeUndefined();
    expect(compteurOngletSources('liste', 2)).toBeUndefined();
  });
});
