import { describe, expect, it } from 'vitest';
import { runGuards, type GuardContext } from './guards.js';

const base: GuardContext = { channel: 'email', now: 1000 };

describe('garde-fous', () => {
  it('laisse passer quand tout est clair', () => {
    expect(runGuards(base).kind).toBe('allow');
  });

  it('bloque sur une suppression, avec le motif en clair', () => {
    const d = runGuards({ ...base, suppression: { scope: 'account', reason: 'Client présent dans votre liste' } });
    expect(d).toMatchObject({ kind: 'block', reason: 'Client présent dans votre liste' });
  });

  it('l’arrêt global est prioritaire sur tout', () => {
    const d = runGuards({ ...base, killSwitch: true, suppression: { scope: 'email', reason: 'x' } });
    expect(d.kind).toBe('block');
    if (d.kind === 'block') {
      expect(d.reason).toContain('Arrêt global');
    }
  });

  it('bloque et nomme les variables non résolues', () => {
    const d = runGuards({ ...base, unresolvedVariables: ['prenom', 'entreprise'] });
    expect(d).toMatchObject({ kind: 'block' });
    if (d.kind === 'block') {
      expect(d.reason).toContain('prenom');
    }
  });

  it('bloque un courrier sans adresse vérifiée', () => {
    expect(runGuards({ ...base, channel: 'letter', postalVerified: false }).kind).toBe('block');
    expect(runGuards({ ...base, channel: 'letter', postalVerified: true }).kind).toBe('allow');
  });

  it('reporte (pas bloque) quand le quota est atteint', () => {
    const d = runGuards({ ...base, quotaRemaining: 0, quotaResetAt: 5000 });
    expect(d).toMatchObject({ kind: 'defer', until: 5000 });
  });

  it('reporte hors fenêtre horaire', () => {
    const d = runGuards({ ...base, businessHoursNextSlot: 9999 });
    expect(d).toMatchObject({ kind: 'defer', until: 9999 });
  });

  it('reporte si cette persona a déjà été touchée aujourd’hui chez ce compte', () => {
    const d = runGuards({ ...base, personaContactedToday: true, nextAccountSlot: 8000 });
    expect(d).toMatchObject({ kind: 'defer', until: 8000 });
  });

  it('bloque au plafond de dépense', () => {
    expect(runGuards({ ...base, spendWouldExceed: true }).kind).toBe('block');
  });

  it('une étape call ignore quotas, fenêtre et plafond d’envoi', () => {
    const d = runGuards({
      ...base,
      channel: 'call',
      quotaRemaining: 0,
      businessHoursNextSlot: 9999,
      spendWouldExceed: true,
      personaContactedToday: true,
    });
    expect(d.kind).toBe('allow');
  });

  it('mais une suppression bloque même un call', () => {
    const d = runGuards({ ...base, channel: 'call', suppression: { scope: 'account', reason: 'opposition' } });
    expect(d.kind).toBe('block');
  });
});

describe('deux campagnes sur le même compte', () => {
  const base = {
    channel: 'email',
    now: 1000,
  } as const;

  it('laisse partir deux personas différentes du même compte le même jour', () => {
    // Le cas que la règle d'origine interdisait : « un contact par compte et
    // par jour » regardait le compte sans distinguer la personne. Dès que le
    // directeur commercial recevait quelque chose, tous les commerciaux de la
    // même entreprise étaient repoussés au lendemain — et comme la première
    // campagne touche le compte presque chaque jour pendant deux semaines, la
    // seconde glissait indéfiniment sans jamais partir.
    const d = runGuards({
      ...base,
      personaContactedToday: false,
      accountPeopleToday: 1,
      accountPeopleCap: 2,
    });
    expect(d.kind).toBe('allow');
  });

  it('reporte la même persona touchée deux fois dans la journée', () => {
    const d = runGuards({
      ...base,
      personaContactedToday: true,
      nextAccountSlot: 8000,
      accountPeopleToday: 1,
      accountPeopleCap: 2,
    });
    expect(d).toMatchObject({ kind: 'defer', until: 8000 });
  });

  it('reporte au-delà du nombre de personnes admis par entreprise et par jour', () => {
    // Ce qui conserve la protection d'origine : sur les données réelles, une
    // entreprise publiant huit offres générait huit messages le même jour.
    const d = runGuards({
      ...base,
      personaContactedToday: false,
      nextAccountSlot: 8000,
      accountPeopleToday: 2,
      accountPeopleCap: 2,
    });
    expect(d).toMatchObject({ kind: 'defer', until: 8000 });
  });

  it('une étape call ignore ces deux plafonds', () => {
    const d = runGuards({
      ...base,
      channel: 'call',
      personaContactedToday: true,
      accountPeopleToday: 9,
      accountPeopleCap: 2,
    });
    expect(d.kind).toBe('allow');
  });
});
