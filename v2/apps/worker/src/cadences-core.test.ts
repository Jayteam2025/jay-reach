import { describe, expect, it } from 'vitest';
import { INTERVALLE_PRODUCTION_MS, INTERVALLE_TICK_MS } from '@jay-reach/core';
import { DISCOVER_INTERVAL_MS, TICK_INTERVAL_MS } from './traitements.js';

/**
 * `packages/core/src/fonctions/moteur.ts` duplique en dur deux cadences du
 * worker — `INTERVALLE_TICK_MS`/`INTERVALLE_PRODUCTION_MS` — pour composer un
 * texte d'affichage (Réglages › Moteur : prochain passage indicatif, aide
 * « tourne en continu ») sans que `packages/core` ait à importer `apps/worker`
 * (sens interdit, le worker importe le cœur, jamais l'inverse). Ce test vit
 * ICI, dans `apps/worker` (qui, lui, peut importer `@jay-reach/core`), et
 * compare les deux copies aux constantes qui pilotent RÉELLEMENT le worker
 * (`TICK_INTERVAL_MS` → `ticker` du `sequence.tick`, `DISCOVER_INTERVAL_MS` →
 * `producer` de `tourProduction`, toutes deux `apps/worker/src/index.ts`).
 * Une dérive future (cadence changée d'un seul côté) fait échouer ce test au
 * lieu d'afficher une cadence fausse dans l'écran.
 *
 * Les deux constantes du worker sont surchargeables par variable
 * d'environnement (repli 60 000 ms / 900 000 ms) : la comparaison porte sur
 * le DÉFAUT de chaque côté, pas sur une valeur d'exécution qui dépendrait de
 * l'environnement du test.
 */
describe('cadences dupliquées dans packages/core (moteur.ts)', () => {
  it('INTERVALLE_TICK_MS (core) correspond au défaut de TICK_INTERVAL_MS (worker, pilote sequence.tick)', () => {
    expect(process.env.TICK_INTERVAL_MS).toBeUndefined();
    expect(INTERVALLE_TICK_MS).toBe(TICK_INTERVAL_MS);
    expect(INTERVALLE_TICK_MS).toBe(60_000);
  });

  it('INTERVALLE_PRODUCTION_MS (core) correspond au défaut de DISCOVER_INTERVAL_MS (worker, pilote tourProduction)', () => {
    expect(process.env.DISCOVER_INTERVAL_MS).toBeUndefined();
    expect(INTERVALLE_PRODUCTION_MS).toBe(DISCOVER_INTERVAL_MS);
    expect(INTERVALLE_PRODUCTION_MS).toBe(15 * 60_000);
  });
});
