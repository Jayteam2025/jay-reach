import { describe, expect, it } from 'vitest';
import { compterEnFile, compterPartis, etatAffichage, segmentsNonNuls } from './file-du-jour';

describe('compterPartis', () => {
  it(
    'F12 : compte le départ RÉEL (`livre`), pas la simple remise au transporteur (`envoye`) — ' +
      'un email remis à SalesBlink mais pas encore envoyé n’est pas « déjà parti »',
    () => {
      const fileDuJour = [
        { livre: true }, // parti (email livré, ou canal sans transporteur asynchrone)
        { livre: false }, // remis, pas encore parti
      ];
      expect(compterPartis(fileDuJour)).toBe(1);
    },
  );

  it('aucun envoi parti : zéro', () => {
    expect(compterPartis([{ livre: false }, { livre: false }])).toBe(0);
  });

  it('file vide : zéro', () => {
    expect(compterPartis([])).toBe(0);
  });
});

describe('compterEnFile (G2)', () => {
  it(
    'compte les envois remis au transporteur mais pas encore réellement partis (`envoye` vrai, ' +
      '`livre` faux) — le cas réel « Jay coach - RH » (47 remis, 0 parti)',
    () => {
      const fileDuJour = Array.from({ length: 47 }, () => ({ envoye: true, livre: false }));
      expect(compterEnFile(fileDuJour)).toBe(47);
    },
  );

  it('n’entre pas dans ce compte : un envoi pas encore remis du tout (`envoye` faux)', () => {
    // Porté par `possibles`/`reportes` (projeterEnvoisDuJour), jamais par `compterEnFile` — sans
    // ce garde-fou, un envoi simplement planifié serait compté deux fois sur l'écran.
    expect(compterEnFile([{ envoye: false, livre: false }])).toBe(0);
  });

  it('n’entre pas dans ce compte : un envoi réellement parti (`livre` vrai)', () => {
    expect(compterEnFile([{ envoye: true, livre: true }])).toBe(0);
  });

  it('mélange réaliste : partis, en file et pas encore remis se partagent la file sans recouvrement', () => {
    const fileDuJour = [
      { envoye: true, livre: true }, // parti
      { envoye: true, livre: false }, // en file
      { envoye: true, livre: false }, // en file
      { envoye: false, livre: false }, // pas encore remis (possibles/reportes)
    ];
    expect(compterPartis(fileDuJour)).toBe(1);
    expect(compterEnFile(fileDuJour)).toBe(2);
  });

  it('file vide : zéro', () => {
    expect(compterEnFile([])).toBe(0);
  });
});

describe('segmentsNonNuls (G2, retour produit)', () => {
  it(
    'le cas réel « Jay coach - RH » (0 parti, 47 en file, 0 possible, 0 reporté) ne garde ' +
      'que le segment non nul — plus « 0 parti · 0 encore possible · 0 reporté » au-dessus de 47 messages',
    () => {
      const segments = segmentsNonNuls([
        { compte: 0, nom: 'partis' },
        { compte: 47, nom: 'enFile' },
        { compte: 0, nom: 'possibles' },
        { compte: 0, nom: 'reportes' },
      ]);
      expect(segments).toEqual([{ compte: 47, nom: 'enFile' }]);
    },
  );

  it('garde l’ordre et tous les segments quand aucun n’est nul', () => {
    const segments = segmentsNonNuls([
      { compte: 3, nom: 'partis' },
      { compte: 2, nom: 'enFile' },
      { compte: 1, nom: 'possibles' },
    ]);
    expect(segments.map((s) => s.nom)).toEqual(['partis', 'enFile', 'possibles']);
  });

  it('tout à zéro : aucun segment (la carte doit dire « rien », pas aligner des zéros)', () => {
    expect(segmentsNonNuls([{ compte: 0, nom: 'partis' }, { compte: 0, nom: 'enFile' }])).toEqual([]);
  });

  it('liste vide : aucun segment', () => {
    expect(segmentsNonNuls([])).toEqual([]);
  });
});

describe('etatAffichage (F13, décision du 18/09)', () => {
  it('un email `dispatched` (remis à SalesBlink, pas encore envoyé) reste « remis »', () => {
    expect(etatAffichage({ etatDetaille: 'dispatched', envoye: true, livre: false })).toBe('dispatched');
  });

  it('un email `delivered` (SalesBlink a fini d’envoyer) devient « parti »', () => {
    expect(etatAffichage({ etatDetaille: 'delivered', envoye: true, livre: true })).toBe('delivered');
  });

  it(
    'une action LinkedIn `dispatched` est un départ RÉEL (pas de transporteur asynchrone, F12) — ' +
      'jamais « remis » à vie : elle doit se lire comme « parti », au même titre qu’un email delivered',
    () => {
      expect(etatAffichage({ etatDetaille: 'dispatched', envoye: true, livre: true })).toBe('delivered');
    },
  );

  it('un statut sans rapport (prévu, échoué, bloqué…) passe inchangé, quel que soit `envoye`/`livre`', () => {
    expect(etatAffichage({ etatDetaille: 'scheduled', envoye: false, livre: false })).toBe('scheduled');
    expect(etatAffichage({ etatDetaille: 'pending_approval', envoye: false, livre: false })).toBe('pending_approval');
    // Rebond détecté après remise (`releve-salesblink.ts`, `status = 'failed'` posé SANS effacer
    // `dispatched_at`) : `envoye` reste vrai, mais l'état affiché doit rester « échoué », jamais
    // retomber sur « remis »/« parti ».
    expect(etatAffichage({ etatDetaille: 'failed', envoye: true, livre: false })).toBe('failed');
    expect(etatAffichage({ etatDetaille: 'blocked', envoye: false, livre: false })).toBe('blocked');
  });

  it('sans `etatDetaille` (colonne non chargée) : replie sur « prévu »', () => {
    expect(etatAffichage({ etatDetaille: undefined, envoye: false, livre: false })).toBe('scheduled');
  });
});
