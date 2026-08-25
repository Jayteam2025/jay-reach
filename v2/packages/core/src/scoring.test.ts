import { describe, expect, it } from 'vitest';
import {
  buildScoringUserMessage,
  estimateScoringCostEur,
  parseScoringResponse,
  passesRules,
} from './scoring.js';

describe('parseScoringResponse', () => {
  it('parse un JSON avec fences et préambule, et clampe le score', () => {
    const raw =
      'Voici le résultat :\n```json\n[{"id":"a","score":150,"reason":"top"},{"id":"b","score":-5,"reason":"non"}]\n```';
    const out = parseScoringResponse(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'a', score: 100 });
    expect(out[1]).toMatchObject({ id: 'b', score: 0 });
  });

  it('rejette une sortie invalide (reason manquante)', () => {
    expect(() => parseScoringResponse('[{"id":"a","score":50}]')).toThrow();
  });
});

describe('passesRules (règles avant modèle)', () => {
  const now = Date.parse('2026-08-17T00:00:00Z');

  it('écarte un cabinet de recrutement (coût nul)', () => {
    expect(
      passesRules({ company: 'Adecco', occurredAt: '2026-08-10T00:00:00Z', freshnessWindowDays: 30, now }),
    ).toBe(false);
  });

  it('écarte une offre trop ancienne', () => {
    expect(
      passesRules({ company: 'Société Témoin', occurredAt: '2026-01-01T00:00:00Z', freshnessWindowDays: 30, now }),
    ).toBe(false);
  });

  it('laisse passer une offre fraîche et légitime', () => {
    expect(
      passesRules({
        company: 'Société Témoin',
        naf: '4690Z',
        occurredAt: '2026-08-10T00:00:00Z',
        freshnessWindowDays: 30,
        now,
      }),
    ).toBe(true);
  });
});

describe('coût & message', () => {
  it('estime le coût d’un lot', () => {
    expect(estimateScoringCostEur(50, 0.002)).toBeCloseTo(0.1);
  });

  it('construit le message utilisateur', () => {
    const msg = buildScoringUserMessage([{ id: 'a', company: 'X', title: 'Commercial' }]);
    expect(msg).toContain('ID: a');
    expect(msg).toContain('tableau JSON');
  });
});
