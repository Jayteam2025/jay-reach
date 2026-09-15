import { describe, it, expect } from 'vitest';
import { normaliserInboxProvider } from './senders';

describe('normaliserInboxProvider', () => {
  it('accepte microsoft_graph', () => {
    expect(normaliserInboxProvider('microsoft_graph')).toBe('microsoft_graph');
  });

  it('accepte null : aucune lecture directe, seule la détection du transport s’applique', () => {
    expect(normaliserInboxProvider(null)).toBeNull();
  });

  it('ramène une chaîne vide à null', () => {
    expect(normaliserInboxProvider('')).toBeNull();
  });

  it('ramène undefined à null', () => {
    expect(normaliserInboxProvider(undefined)).toBeNull();
  });

  it('refuse un fournisseur qu’on ne sait pas relever', () => {
    expect(normaliserInboxProvider('gmail')).toBe('invalide');
  });
});
