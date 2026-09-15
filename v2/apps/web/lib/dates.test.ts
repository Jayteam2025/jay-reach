import { describe, expect, it } from 'vitest';
import { dateRelativeCourte, heureAvecJour, libelleJour, regrouperParJour } from './dates';

describe('dateRelativeCourte', () => {
  const maintenant = new Date('2026-09-15T12:00:00.000Z');

  it('moins d’une heure -> minutes (jamais 0, même à quelques secondes)', () => {
    expect(dateRelativeCourte('2026-09-15T11:45:00.000Z', maintenant)).toBe('il y a 15 min');
    expect(dateRelativeCourte('2026-09-15T11:59:50.000Z', maintenant)).toBe('il y a 1 min');
  });

  it('entre une heure et un jour -> heures', () => {
    expect(dateRelativeCourte('2026-09-15T10:00:00.000Z', maintenant)).toBe('il y a 2 h');
    expect(dateRelativeCourte('2026-09-14T13:00:00.000Z', maintenant)).toBe('il y a 23 h');
  });

  it('entre 24 et 48 h -> « hier »', () => {
    expect(dateRelativeCourte('2026-09-14T12:00:00.000Z', maintenant)).toBe('hier');
    expect(dateRelativeCourte('2026-09-13T13:00:00.000Z', maintenant)).toBe('hier');
  });

  it('au-delà de 48 h -> date courte (jour + mois abrégé)', () => {
    expect(dateRelativeCourte('2026-09-10T13:00:00.000Z', maintenant)).toBe('10 sept.');
  });
});

/**
 * R43/Group B (tour de correction 2) : « prochain 16:45 » était identique à
 * « dernier 16:45 » alors que le prochain passage tombait le lendemain — la
 * date construite en heure locale (pas l'ISO UTC brut) pour rester
 * indépendante du fuseau d'exécution du test.
 */
describe('heureAvecJour', () => {
  it('aujourd’hui -> heure seule', () => {
    const maintenant = new Date(2026, 8, 15, 12, 0, 0);
    const prochain = new Date(2026, 8, 15, 16, 45, 0);
    expect(heureAvecJour(prochain.toISOString(), maintenant)).toBe('16:45');
  });

  it('demain -> « demain HH:MM »', () => {
    const maintenant = new Date(2026, 8, 15, 12, 0, 0);
    const prochain = new Date(2026, 8, 16, 16, 45, 0);
    expect(heureAvecJour(prochain.toISOString(), maintenant)).toBe('demain 16:45');
  });

  it('au-delà de demain -> date courte + heure', () => {
    const maintenant = new Date(2026, 8, 15, 12, 0, 0);
    const prochain = new Date(2026, 8, 18, 16, 45, 0);
    expect(heureAvecJour(prochain.toISOString(), maintenant)).toBe('18/09 16:45');
  });
});

/**
 * R53 (tour de correction 1, tâche 13) : le journal de l'onglet Activité se
 * regroupe par jour DANS LE FUSEAU de l'organisation, pas celui du serveur.
 */
describe('regrouperParJour', () => {
  it('trois événements sur deux jours -> deux groupes, dans l’ordre reçu', () => {
    const evenements = [
      { quand: '2026-09-14T09:00:00.000Z' },
      { quand: '2026-09-14T08:00:00.000Z' },
      { quand: '2026-09-13T08:00:00.000Z' },
    ];
    const groupes = regrouperParJour(evenements, new Date('2026-09-15T12:00:00.000Z'), 'Europe/Paris');
    expect(groupes).toHaveLength(2);
    expect(groupes[0]!.evenements).toEqual([evenements[0], evenements[1]]);
    expect(groupes[1]!.evenements).toEqual([evenements[2]]);
  });

  it('frontière de minuit à Paris : 23h50 et 00h10 (Paris) tombent dans deux jours, même s’ils sont à 20 minutes d’écart', () => {
    // Paris = UTC+2 en septembre (CEST) : 23:50 Paris le 14 = 21:50 UTC le 14 ;
    // 00:10 Paris le 15 = 22:10 UTC le 14 — même jour calendaire en UTC, mais
    // pas à Paris. Un regroupement naïf en UTC fusionnerait les deux à tort.
    const evenements = [
      { quand: '2026-09-14T22:10:00.000Z' }, // 00:10 Paris le 15
      { quand: '2026-09-14T21:50:00.000Z' }, // 23:50 Paris le 14
    ];
    const groupes = regrouperParJour(evenements, new Date('2026-09-15T12:00:00.000Z'), 'Europe/Paris');
    expect(groupes).toHaveLength(2);
    expect(groupes[0]!.evenements).toEqual([evenements[0]]);
    expect(groupes[1]!.evenements).toEqual([evenements[1]]);
  });
});

describe('libelleJour', () => {
  const maintenant = new Date('2026-09-14T18:00:00.000Z'); // lundi 14 septembre, en journée à Paris

  it('le jour de `maintenant` -> « Aujourd’hui, {jour de semaine} {date} »', () => {
    const jour = new Date('2026-09-14T12:00:00.000Z');
    expect(libelleJour(jour, maintenant, 'fr-FR', 'Europe/Paris')).toBe("Aujourd'hui, lundi 14 septembre");
  });

  it('la veille -> « Hier, {jour de semaine} {date} »', () => {
    const jour = new Date('2026-09-13T12:00:00.000Z');
    expect(libelleJour(jour, maintenant, 'fr-FR', 'Europe/Paris')).toBe('Hier, dimanche 13 septembre');
  });

  it('un jour plus ancien -> date pleine, majuscule initiale, sans préfixe', () => {
    const jour = new Date('2026-09-11T12:00:00.000Z');
    expect(libelleJour(jour, maintenant, 'fr-FR', 'Europe/Paris')).toBe('Vendredi 11 septembre');
  });
});
