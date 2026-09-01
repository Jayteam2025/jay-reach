import { describe, it, expect } from 'vitest';
import {
  normalizeAgencyName,
  isRecruitmentByName,
  isRecruitmentByNaf,
  isRecruitmentAgency,
  normalizeLocation,
  signalFingerprint,
} from './signal-filters.js';

describe('normalizeAgencyName — parité avec la fonction SQL', () => {
  it('produit les mêmes clés que public.normalize_agency_name en base', () => {
    // Valeurs vérifiées sur le projet hébergé (SELECT name_normalized ...).
    expect(normalizeAgencyName('Adecco')).toBe('adecco');
    expect(normalizeAgencyName("Mercato de l'Emploi")).toBe('mercatodelemploi');
    expect(normalizeAgencyName("Orient'Action")).toBe('orientaction');
  });

  it('retire accents, espaces, tirets et apostrophes', () => {
    expect(normalizeAgencyName('Adéquat')).toBe('adequat');
    expect(normalizeAgencyName('Gi Group')).toBe('gigroup');
    expect(normalizeAgencyName('Job-Link')).toBe('joblink');
    expect(normalizeAgencyName('')).toBe('');
  });
});

describe('isRecruitmentByName', () => {
  it('détecte via le motif générique (sans blacklist)', () => {
    expect(isRecruitmentByName('Cabinet Durand Recrutement')).toBe(true);
    expect(isRecruitmentByName('Executive Search Partners')).toBe(true);
    expect(isRecruitmentByName('Agence Intérim Sud')).toBe(true);
  });

  it('détecte via le repli intégré', () => {
    expect(isRecruitmentByName('Adecco France')).toBe(true);
  });

  it('détecte via la blacklist DB passée en argument (noms normalisés)', () => {
    const bl = new Set([normalizeAgencyName('WIZBII'), normalizeAgencyName("Orient'Action")]);
    expect(isRecruitmentByName('WIZBII', bl)).toBe(true);
    expect(isRecruitmentByName('orient action', bl)).toBe(true); // normalisé pareil
  });

  it("n'écarte pas une vraie entreprise absente des listes", () => {
    expect(isRecruitmentByName('Boulangerie Martin')).toBe(false);
    expect(isRecruitmentByName('Boulangerie Martin', new Set(['wizbii']))).toBe(false);
  });
});

describe('isRecruitmentByNaf', () => {
  it('écarte la division 78 (recrutement/intérim/placement)', () => {
    expect(isRecruitmentByNaf('7810Z')).toBe(true);
    expect(isRecruitmentByNaf('78.20Z')).toBe(true);
    expect(isRecruitmentByNaf('7830Z')).toBe(true);
  });
  it('laisse passer les autres NAF', () => {
    expect(isRecruitmentByNaf('6201Z')).toBe(false);
    expect(isRecruitmentByNaf(null)).toBe(false);
  });
});

describe('isRecruitmentAgency — combine NAF + nom + blacklist', () => {
  it('écarte par NAF même si le nom est neutre', () => {
    expect(isRecruitmentAgency({ name: 'Groupe Alpha', naf: '7820Z' })).toBe(true);
  });
  it('écarte par blacklist DB', () => {
    const bl = new Set([normalizeAgencyName('Talenteeds')]);
    expect(isRecruitmentAgency({ name: 'Talenteeds', naf: '6201Z' }, bl)).toBe(true);
  });
  it('laisse passer un vrai prospect', () => {
    expect(isRecruitmentAgency({ name: 'Menuiserie du Bocage', naf: '1623Z' })).toBe(false);
  });
});

describe('empreinte de déduplication', () => {
  it('rapproche les deux écritures de la même commune', () => {
    // France Travail écrit « 44 - Rezé », Adzuna « Rezé, Loire-Atlantique ».
    // Sans mise en forme commune, la même offre parue chez les deux comptait
    // pour deux signaux distincts.
    expect(normalizeLocation('44 - Rezé')).toBe('reze');
    expect(normalizeLocation('Rezé, Loire-Atlantique')).toBe('reze');
    expect(signalFingerprint({ company: 'Acme', title: 'Technicien', location: '44 - Rezé' })).toBe(
      signalFingerprint({ company: 'Acme', title: 'Technicien', location: 'Rezé, Loire-Atlantique' }),
    );
  });

  it('garde le segment le plus précis, pas l’arrondissement', () => {
    // Le dernier segment désigne l'arrondissement : s'en servir confondrait
    // deux communes voisines du même ressort.
    expect(normalizeLocation('Maubeuge, Avesnes-sur-Helpe')).toBe('maubeuge');
    expect(normalizeLocation('Fourmies, Avesnes-sur-Helpe')).toBe('fourmies');
  });

  it('distingue le même poste dans deux communes', () => {
    // Le vrai bug corrigé : un employeur recrutant le même profil dans douze
    // communes produisait douze fois la même empreinte, et onze de ses offres
    // étaient rejetées à l'insertion.
    const villes = ['Albertville-Nord, Albertville', 'Dieppe-Est, Dieppe', 'Lumbres, Saint-Omer'];
    const empreintes = new Set(
      villes.map((location) =>
        signalFingerprint({ company: 'AB Stratégies Equilibre', title: 'Technicien en froid H/F', location }),
      ),
    );
    expect(empreintes.size).toBe(villes.length);
  });

  it('reconnaît la même offre republiée sous un autre identifiant', () => {
    // Ce que la déduplication doit continuer d'attraper : même employeur,
    // même intitulé, même commune.
    expect(
      signalFingerprint({ company: 'AB Stratégies', title: 'Technicien', location: 'Lumbres, Saint-Omer' }),
    ).toBe(signalFingerprint({ company: 'ab strategies', title: 'TECHNICIEN', location: 'Lumbres, Saint-Omer' }));
  });

  it('retombe sur le code postal quand le lieu manque', () => {
    expect(signalFingerprint({ company: 'Acme', title: 'Technicien', postalCode: '69003' })).toBe(
      'acme|technicien|69003',
    );
  });
});

describe('empreinte — parité avec les fonctions SQL', () => {
  it('produit les mêmes valeurs que public.signal_empreinte en base', () => {
    // Le worker calcule l'empreinte en TypeScript, pour ne pas payer un
    // aller-retour par signal ; le SQL sert au rattrapage des lignes déjà en
    // base. Deux implémentations de la même règle divergent en silence si rien
    // ne les compare — et une divergence recréerait des doublons sans que rien
    // ne le signale.
    //
    // Valeurs relevées sur le projet hébergé le 01/09/2026
    // (select public.signal_lieu_normalise(...), public.signal_empreinte(...)).
    expect(normalizeLocation('44 - Rezé')).toBe('reze');
    expect(normalizeLocation('Rezé, Loire-Atlantique')).toBe('reze');
    expect(normalizeLocation('Maubeuge, Avesnes-sur-Helpe')).toBe('maubeuge');
    expect(normalizeLocation('Albertville-Nord, Albertville')).toBe('albertville nord');
    expect(normalizeLocation('75 - PARIS 01')).toBe('paris 01');

    expect(
      signalFingerprint({
        company: 'AB Stratégies Equilibre',
        title: 'Technicien en froid H/F',
        location: 'Lumbres, Saint-Omer',
      }),
    ).toBe('ab strategies equilibre|technicien en froid h f|lumbres');

    expect(signalFingerprint({ company: 'Acme', title: 'Technicien', location: '69003 Lyon' })).toBe(
      'acme|technicien|69003 lyon',
    );
  });
});
