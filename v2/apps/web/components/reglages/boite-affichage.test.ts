import { describe, expect, it } from 'vitest';
import { boiteArretee, puceEtatBoite, titreBoite } from './boite-affichage';

describe('puceEtatBoite', () => {
  it('boîte non reliée à SalesBlink : priorité absolue, même active', () => {
    expect(puceEtatBoite({ active: true, sante: { etat: 'sans_objet' } })).toEqual({ ton: 'gris', cle: 'notLinked' });
  });

  it('santé indisponible (délai dépassé ou erreur) prime sur l’activation', () => {
    expect(puceEtatBoite({ active: true, sante: { etat: 'indisponible' } })).toEqual({
      ton: 'attention',
      cle: 'healthUnavailable',
    });
  });

  it('santé connue mais déconnectée', () => {
    expect(puceEtatBoite({ active: true, sante: { etat: 'connue', connectee: false, score: null } })).toEqual({
      ton: 'attention',
      cle: 'disconnected',
    });
  });

  it('active et connectée', () => {
    expect(puceEtatBoite({ active: true, sante: { etat: 'connue', connectee: true, score: 90 } })).toEqual({
      ton: 'bon',
      cle: 'active',
    });
  });

  it('inactive et connectée : l’activation prime (aucun blocage technique)', () => {
    expect(puceEtatBoite({ active: false, sante: { etat: 'connue', connectee: true, score: 90 } })).toEqual({
      ton: 'gris',
      cle: 'inactive',
    });
  });
});

describe('une boîte dont le quota du jour est à zéro', () => {
  const quotas = (jour: number | null) => ({ active: true, quotas: { jour, heure: null } });

  it('est signalée comme arrêtée', () => {
    expect(boiteArretee(quotas(0))).toBe(true);
  });

  it('ne l’est pas quand aucune limite n’est réglée', () => {
    // `null` veut dire « sans limite », pas « zéro » : les confondre couperait l'affichage d'une
    // boîte qui envoie sans plafond.
    expect(boiteArretee(quotas(null))).toBe(false);
  });

  it('ne l’est pas quand elle envoie', () => {
    expect(boiteArretee(quotas(30))).toBe(false);
  });

  it('ne l’est pas quand la boîte est déjà inactive : sa puce le dit déjà', () => {
    expect(boiteArretee({ active: false, quotas: { jour: 0, heure: null } })).toBe(false);
  });
});

describe('titreBoite', () => {
  // Constat du 27/10 : trois boîtes s'affichaient toutes « Alexandre De Clercq ».
  const trois = [
    { identite: 'a.declercq@get-jay.fr', nomAffiche: 'Alexandre De Clercq' },
    { identite: 'Alex.declercq@get-jay.fr', nomAffiche: 'Alexandre De Clercq' },
    { identite: 'alexandre@get-jay.fr', nomAffiche: 'Alexandre De Clercq' },
  ];

  it('trois boîtes au même nom d’affichage se distinguent par leur adresse complète, lue en premier', () => {
    const titres = trois.map((b) => titreBoite(b).titre);
    expect(titres).toEqual(['a.declercq@get-jay.fr', 'Alex.declercq@get-jay.fr', 'alexandre@get-jay.fr']);
    expect(new Set(titres).size).toBe(3);
  });

  it('le nom d’affichage passe en complément', () => {
    expect(titreBoite(trois[0]!).complement).toBe('Alexandre De Clercq');
  });

  it('sans nom d’affichage, ou avec l’adresse comme nom, aucun complément redondant', () => {
    expect(titreBoite({ identite: 'hey@get-jay.fr', nomAffiche: null }).complement).toBeNull();
    expect(titreBoite({ identite: 'hey@get-jay.fr', nomAffiche: 'HEY@get-jay.fr' }).complement).toBeNull();
    expect(titreBoite({ identite: 'hey@get-jay.fr', nomAffiche: '  ' }).complement).toBeNull();
  });
});
