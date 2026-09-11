import { describe, it, expect } from 'vitest';
import type { Rapport as RapportCore, EnvoiSorti as EnvoiSortiCore } from '@jay-reach/core/email-transport/rapports.js';
import type { Rapport as RapportProviders, EnvoiSorti as EnvoiSortiProviders } from './salesblink.js';

/**
 * `packages/core` redéclare `Rapport` et `EnvoiSorti` (email-transport/rapports.ts)
 * pour éviter un cycle de dépendance vers `@jay-reach/providers` : rien ne garde
 * les deux formes alignées à part la relecture humaine. Cette assertion de
 * compilation (mineur, revue finale du 11/09) échoue au premier champ qui
 * diverge — aucune exécution, seul le typecheck compte ici.
 */
describe('Rapport / EnvoiSorti : mêmes champs que @jay-reach/core', () => {
  it('les deux formes sont mutuellement assignables (assertion de type)', () => {
    const rapportVersCore: RapportCore = {} as RapportProviders;
    const rapportVersProviders: RapportProviders = {} as RapportCore;
    const envoiVersCore: EnvoiSortiCore = {} as EnvoiSortiProviders;
    const envoiVersProviders: EnvoiSortiProviders = {} as EnvoiSortiCore;
    void rapportVersCore;
    void rapportVersProviders;
    void envoiVersCore;
    void envoiVersProviders;

    expect(true).toBe(true);
  });
});
