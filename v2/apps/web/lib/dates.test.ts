import { describe, expect, it } from 'vitest';
import { dateHeureMessage, dateRelativeCourte, heureAvecJour, libelleJour, regrouperParJour } from './dates';

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

describe('dateHeureMessage', () => {
  const maintenant = new Date('2026-09-16T10:00:00.000Z'); // 12:00 Paris

  it("aujourd'hui -> « aujourd'hui, HH:MM »", () => {
    expect(dateHeureMessage('2026-09-16T08:22:00.000Z', maintenant)).toBe("aujourd'hui, 10:22");
  });

  it('hier -> « hier, HH:MM » (même si peu d’heures se sont écoulées, près de minuit à Paris)', () => {
    expect(dateHeureMessage('2026-09-14T22:10:00.000Z', maintenant)).toBe('hier, 00:10');
  });

  it('avant-hier ou plus tôt -> date courte + heure', () => {
    expect(dateHeureMessage('2026-09-11T07:12:00.000Z', maintenant)).toBe('11 sept., 09:12');
  });

  it('respecte le fuseau donné, pas celui du process', () => {
    expect(dateHeureMessage('2026-09-16T08:22:00.000Z', maintenant, 'UTC')).toBe("aujourd'hui, 08:22");
  });
});

/**
 * R43/Group B (tour de correction 2) : « prochain 16:45 » était identique à
 * « dernier 16:45 » alors que le prochain passage tombait le lendemain.
 * R67 (16/09) : les instants sont désormais des ISO UTC explicites (pas une
 * construction en heure locale) — `heureAvecJour` rend dans `Europe/Paris`
 * par défaut quel que soit le fuseau du PROCESS qui exécute le test ; une
 * date locale aurait signifié une chose différente selon `process.env.TZ`,
 * ce qui aurait masqué une régression plutôt que la prouver. Septembre est
 * en heure d'été à Paris (CEST, UTC+2) : 16:45 Paris = 14:45 UTC.
 */
describe('heureAvecJour', () => {
  it('aujourd’hui -> heure seule', () => {
    const maintenant = new Date('2026-09-15T10:00:00.000Z'); // 12:00 Paris
    const prochain = '2026-09-15T14:45:00.000Z'; // 16:45 Paris, même jour
    expect(heureAvecJour(prochain, maintenant)).toBe('16:45');
  });

  it('demain -> « demain HH:MM »', () => {
    const maintenant = new Date('2026-09-15T10:00:00.000Z'); // 12:00 Paris, le 15
    const prochain = '2026-09-16T14:45:00.000Z'; // 16:45 Paris, le 16
    expect(heureAvecJour(prochain, maintenant)).toBe('demain 16:45');
  });

  it('au-delà de demain -> date courte + heure', () => {
    const maintenant = new Date('2026-09-15T10:00:00.000Z'); // 12:00 Paris, le 15
    const prochain = '2026-09-18T14:45:00.000Z'; // 16:45 Paris, le 18
    expect(heureAvecJour(prochain, maintenant)).toBe('18/09 16:45');
  });

  it('frontière de minuit à Paris : « demain » même si le process qui exécute le rendu est en UTC (R67)', () => {
    // « maintenant » = 23:50 Paris le 15 (21:50 UTC) ; l'instant à classer =
    // 00:10 Paris le 16 (22:10 UTC), vingt minutes plus tard en absolu mais un
    // jour calendaire plus tard À PARIS. En UTC les deux tombent le même jour
    // calendaire (15) : une comparaison par accesseurs locaux sous un process
    // en UTC (Vercel) aurait donc classé ceci « aujourd'hui » (00:10 nu) au
    // lieu de « demain 00:10 » — exactement le bug de `estMemeJour` corrigé
    // par `cleJourDansFuseau` (même mécanisme que `regrouperParJour`/R53).
    const maintenant = new Date('2026-09-15T21:50:00.000Z'); // 23:50 Paris le 15
    const instant = '2026-09-15T22:10:00.000Z'; // 00:10 Paris le 16
    expect(heureAvecJour(instant, maintenant)).toBe('demain 00:10');
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
