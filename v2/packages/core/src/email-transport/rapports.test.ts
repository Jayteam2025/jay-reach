import { describe, expect, it } from 'vitest';
import { curseurSuivant, evenementsDepuisEnvois, evenementsDepuisRapports } from './rapports.js';
import type { EnvoiSorti, Rapport } from './rapports.js';

function rapport(partiel: Partial<Rapport>): Rapport {
  return {
    id: 'r1',
    horodatageMs: 1000,
    type: 'outreach',
    message: 'Sent',
    email: 'marie@exemple.fr',
    sequenceId: 'seq-1',
    corps: null,
    ...partiel,
  };
}

function envoi(partiel: Partial<EnvoiSorti>): EnvoiSorti {
  return {
    id: 'e1',
    messageId: '<abc@exemple.fr>',
    email: 'marie@exemple.fr',
    sequenceId: 'seq-1',
    termine: true,
    termineMs: 2000,
    planifieMs: 1500,
    typeTache: 'email',
    corpsHtml: null,
    sujet: null,
    deSoi: false,
    destinataire: null,
    references: [],
    ...partiel,
  };
}

describe('evenementsDepuisRapports', () => {
  it('un rapport Bounced donne rebond', () => {
    const [ev] = evenementsDepuisRapports([rapport({ message: 'Bounced', horodatageMs: 4242 })]);
    expect(ev).toEqual({ type: 'rebond', email: 'marie@exemple.fr', aMs: 4242 });
  });

  it('un Sent donne envoyé', () => {
    const [ev] = evenementsDepuisRapports([rapport({ message: 'Sent', horodatageMs: 111 })]);
    expect(ev).toEqual({
      type: 'envoye',
      email: 'marie@exemple.fr',
      sequenceId: 'seq-1',
      messageId: null,
      aMs: 111,
    });
  });

  it('un Error porte son motif (JSON dans corps)', () => {
    const [ev] = evenementsDepuisRapports([
      rapport({
        message: 'Error',
        type: 'error',
        corps: '{"message":"Email Sender sending disabled. Needs to reconnect."}',
        horodatageMs: 555,
      }),
    ]);
    expect(ev).toEqual({
      type: 'erreur',
      email: 'marie@exemple.fr',
      sequenceId: 'seq-1',
      motif: 'Email Sender sending disabled. Needs to reconnect.',
      aMs: 555,
    });
  });

  it('un Error avec corps non-JSON reprend le texte brut tronqué à 200 caractères', () => {
    const long = 'x'.repeat(250);
    const [ev] = evenementsDepuisRapports([rapport({ message: 'Error', corps: long, horodatageMs: 1 })]);
    expect(ev?.type).toBe('erreur');
    expect((ev as { motif: string }).motif).toHaveLength(200);
  });

  it('un Error sans corps porte un motif vide', () => {
    const [ev] = evenementsDepuisRapports([rapport({ message: 'Error', corps: null })]);
    expect((ev as { motif: string }).motif).toBe('');
  });

  it('un message inconnu est ignoré', () => {
    expect(evenementsDepuisRapports([rapport({ message: 'Opened' })])).toEqual([]);
  });

  it('un rapport sans email est ignoré', () => {
    expect(evenementsDepuisRapports([rapport({ message: 'Sent', email: null })])).toEqual([]);
  });
});

describe('evenementsDepuisEnvois', () => {
  it('un envoi email terminé donne envoyé', () => {
    const [ev] = evenementsDepuisEnvois([envoi({})]);
    expect(ev).toEqual({
      type: 'envoye',
      email: 'marie@exemple.fr',
      sequenceId: 'seq-1',
      messageId: '<abc@exemple.fr>',
      aMs: 2000,
    });
  });

  it('reprend planifieMs si termineMs manque', () => {
    const [ev] = evenementsDepuisEnvois([envoi({ termineMs: null })]);
    expect((ev as { aMs: number }).aMs).toBe(1500);
  });

  it('une tâche non terminée ne produit aucun événement', () => {
    expect(evenementsDepuisEnvois([envoi({ termine: false })])).toEqual([]);
  });

  it('une tâche reply ne produit aucun événement', () => {
    expect(evenementsDepuisEnvois([envoi({ typeTache: 'reply' })])).toEqual([]);
  });

  it('une tâche en erreur ne produit aucun événement', () => {
    expect(evenementsDepuisEnvois([envoi({ erreur: 'Email Sender sending disabled.' })])).toEqual([]);
  });
});

describe('curseurSuivant', () => {
  it('avance au max + 1', () => {
    const evenements = evenementsDepuisRapports([
      rapport({ message: 'Sent', horodatageMs: 10 }),
      rapport({ message: 'Bounced', horodatageMs: 20 }),
    ]);
    expect(curseurSuivant(evenements, 0)).toBe(21);
  });

  it("n'avance jamais en arrière", () => {
    const evenements = evenementsDepuisRapports([rapport({ message: 'Sent', horodatageMs: 5 })]);
    expect(curseurSuivant(evenements, 100)).toBe(100);
  });
});
