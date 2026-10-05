import { describe, it, expect } from 'vitest';
import { echeanceEtapeSuivante, graineDeterministe, jitterMs, RATIO_JITTER_ECHEANCE } from './scheduling.js';

describe('echeanceEtapeSuivante (issue #111)', () => {
  const dispatchedAtMs = 1_726_500_000_000;
  const enrollmentId = 'enrollment-1';

  it('dernière étape (pas de délai suivant) → null, rien à planifier', () => {
    expect(echeanceEtapeSuivante(dispatchedAtMs, enrollmentId, null)).toBeNull();
  });

  it('applique le délai à l’instant du DÉPART RÉEL, pas à un autre instant', () => {
    const delayHours = 120;
    const brute = dispatchedAtMs + delayHours * 3_600_000;
    const attendu = brute + jitterMs(brute - dispatchedAtMs, RATIO_JITTER_ECHEANCE, graineDeterministe(enrollmentId));

    expect(echeanceEtapeSuivante(dispatchedAtMs, enrollmentId, delayHours)).toBe(attendu);
  });

  it('déterministe : deux appels identiques donnent la même échéance (rejeu d’un dispatch idempotent)', () => {
    const a = echeanceEtapeSuivante(dispatchedAtMs, enrollmentId, 168);
    const b = echeanceEtapeSuivante(dispatchedAtMs, enrollmentId, 168);
    expect(a).toBe(b);
  });

  it('deux inscriptions différentes reçoivent un jitter différent (dispersion)', () => {
    const a = echeanceEtapeSuivante(dispatchedAtMs, 'enrollment-a', 24);
    const b = echeanceEtapeSuivante(dispatchedAtMs, 'enrollment-b', 24);
    expect(a).not.toBe(b);
  });

  it('délai nul (étape immédiate) → échéance au voisinage immédiat du départ, jamais négative', () => {
    const r = echeanceEtapeSuivante(dispatchedAtMs, enrollmentId, 0);
    expect(r).not.toBeNull();
    expect(r).toBe(dispatchedAtMs); // base + jitter(0, ratio, seed) = base (spacing nul)
  });
});

describe('graineDeterministe', () => {
  it('formule stable (même algorithme que l’ancien `graine` du tick)', () => {
    const attendu = (() => {
      let h = 0;
      const id = 'enrollment-xyz';
      for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
      return h;
    })();
    expect(graineDeterministe('enrollment-xyz')).toBe(attendu);
  });
});
