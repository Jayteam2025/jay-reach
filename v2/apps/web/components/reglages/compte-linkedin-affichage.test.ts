import { describe, expect, it } from 'vitest';
import { puceEtatCompteLinkedIn } from './compte-linkedin-affichage';

// Constat recette du 18/09 : « Active » et « Aucun envoi ne partira » affichées côte à côte pour
// le même compte — deux affirmations contradictoires. Une seule puce doit désormais porter les
// deux faits.
describe('puceEtatCompteLinkedIn', () => {
  it('actif et connecté, expéditeur activé : puce « active », ton bon', () => {
    expect(puceEtatCompteLinkedIn({ active: true, connecte: true, envoiPossible: true })).toEqual({
      ton: 'bon',
      cle: 'active',
    });
  });

  it('actif et connecté, MAIS expéditeur non activé : une seule puce combinée, ton attention (jamais deux affirmations séparées)', () => {
    expect(puceEtatCompteLinkedIn({ active: true, connecte: true, envoiPossible: false })).toEqual({
      ton: 'attention',
      cle: 'activeSenderMissing',
    });
  });

  it('inactif et connecté, expéditeur non activé : puce « senderMissing » seule (pas « active »)', () => {
    expect(puceEtatCompteLinkedIn({ active: false, connecte: true, envoiPossible: false })).toEqual({
      ton: 'attention',
      cle: 'senderMissing',
    });
  });

  it('inactif et connecté, expéditeur activé : puce « inactive »', () => {
    expect(puceEtatCompteLinkedIn({ active: false, connecte: true, envoiPossible: true })).toEqual({
      ton: 'gris',
      cle: 'inactive',
    });
  });

  it('non connecté : l’absence d’expéditeur ne prime pas (rien à envoyer de toute façon)', () => {
    expect(puceEtatCompteLinkedIn({ active: true, connecte: false, envoiPossible: false })).toEqual({
      ton: 'bon',
      cle: 'active',
    });
  });
});
