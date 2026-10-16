import { describe, expect, it, vi } from 'vitest';
import { memoriserUrnDuContact, normaliserUrnLinkedIn } from './identite.js';

describe('normaliserUrnLinkedIn', () => {
  it.each([
    ['urn:li:fsd_profile:ACoAAB1234567890', 'ACoAAB1234567890'],
    ['ACoAAB1234567890', 'ACoAAB1234567890'],
    ['urn:li:fs_miniProfile:ACoAAB1234567890', 'ACoAAB1234567890'],
    ['  urn:li:fsd_profile:ACoAAB1234567890 ', 'ACoAAB1234567890'],
    ['urn:li:fsd_profile:AEMAAB1234567890', 'AEMAAB1234567890'],
    ['ACoAAada', 'ACoAAada'],
    ['ACwAAB1234567890', 'ACwAAB1234567890'],
    // frontière basse : 5 caractères passent
    ['ACoAA', 'ACoAA'],
    // derrière un préfixe d'URN de profil, un début inconnu passe : le préfixe atteste
    ['urn:li:fsd_profile:XYZAAB1234567890', 'XYZAAB1234567890'],
  ])('%s -> %s', (entree, attendu) => {
    expect(normaliserUrnLinkedIn(entree)).toBe(attendu);
  });

  it.each([
    [''],
    ['   '],
    ['https://www.linkedin.com/in/ACoAAB1234567890'],
    ['https://www.linkedin.com/in/jeanne-dupont'],
    ['jeanne-dupont'],
    ['urn:li:fsd_profile:'],
    ['urn:li:fsd_company:ACoAAB1234567890'],
    // frontière basse : 4 caractères ne passent pas
    ['ACoA'],
    ['urn:li:fsd_profile:ACoA'],
    // nu et de début inconnu : rien ne l'atteste
    ['XYZAAB1234567890'],
    // l'identifiant FullEnrich, nu ou derrière un préfixe
    ['015fc7a2-abd9-500c-a379-b5268f293c13'],
    ['urn:li:fsd_profile:015fc7a2-abd9-500c-a379-b5268f293c13'],
    ['ACoAA bad'],
  ])('%j -> null', (entree) => {
    expect(normaliserUrnLinkedIn(entree)).toBeNull();
  });
});

describe('memoriserUrnDuContact', () => {
  it('écrit la forme nue, filtrée par organisation', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    await memoriserUrnDuContact({ query }, 'org-1', 'c-1', 'urn:li:fsd_profile:ACoAAB1234567890');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, valeurs] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('organization_id = $2');
    expect(valeurs).toEqual(['c-1', 'org-1', 'ACoAAB1234567890']);
  });

  it('n écrit rien pour un URN illisible, et le dit sans recopier la valeur', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await memoriserUrnDuContact({ query }, 'org-1', 'c-1', 'https://www.linkedin.com/in/jeanne-dupont');
    expect(query).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('41 caractères');
    expect(message).not.toContain('jeanne-dupont');
    warn.mockRestore();
  });
});
