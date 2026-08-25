import { describe, expect, it } from 'vitest';
import {
  parseCampaignCreate,
  parseStep,
  toEntryRules,
  toStepConditions,
} from './validation.js';

const UUID = '11111111-1111-1111-1111-111111111111';

describe('création de campagne', () => {
  it('accepte une campagne adossée à une source', () => {
    const r = parseCampaignCreate({ name: 'Relance', entryKind: 'source', entryId: UUID, minScore: 60 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.name).toBe('Relance');
  });

  it('refuse un nom vide', () => {
    const r = parseCampaignCreate({ name: '  ', entryKind: 'list', entryId: UUID });
    expect(r.ok).toBe(false);
  });

  it('refuse un entryId non-uuid', () => {
    expect(parseCampaignCreate({ name: 'X', entryKind: 'source', entryId: 'nope' }).ok).toBe(false);
  });

  it('refuse un minScore hors bornes', () => {
    expect(parseCampaignCreate({ name: 'X', entryKind: 'source', entryId: UUID, minScore: 140 }).ok).toBe(false);
  });

  it('refuse un champ inconnu (strict)', () => {
    expect(parseCampaignCreate({ name: 'X', entryKind: 'source', entryId: UUID, source_id: UUID }).ok).toBe(false);
  });
});

describe('étape de séquence', () => {
  it('accepte une étape email avec délai', () => {
    const r = parseStep({ channel: 'email', delayHours: 48, templateParentId: UUID });
    expect(r.ok).toBe(true);
  });

  it('refuse un canal inconnu', () => {
    expect(parseStep({ channel: 'sms', delayHours: 0 }).ok).toBe(false);
  });

  it('refuse un délai négatif', () => {
    expect(parseStep({ channel: 'email', delayHours: -1 }).ok).toBe(false);
  });

  it('accepte une condition connue et refuse une inconnue', () => {
    expect(parseStep({ channel: 'email', delayHours: 0, condition: 'no_reply' }).ok).toBe(true);
    expect(parseStep({ channel: 'email', delayHours: 0, condition: 'maybe' }).ok).toBe(false);
  });
});

describe('projections jsonb', () => {
  it('construit entry_rules', () => {
    expect(toEntryRules({ minScore: 60, personaIds: [UUID] })).toEqual({ min_score: 60, personas: [UUID] });
    expect(toEntryRules({})).toEqual({});
    expect(toEntryRules({ minScore: null, personaIds: [] })).toEqual({});
  });

  it('construit conditions', () => {
    expect(toStepConditions('previous_opened')).toEqual({ requires: 'previous_opened' });
    expect(toStepConditions(null)).toEqual({});
    expect(toStepConditions()).toEqual({});
  });
});
