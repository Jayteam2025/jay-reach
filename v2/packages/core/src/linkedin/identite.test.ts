import { describe, expect, it, vi } from 'vitest';
import { memoriserUrnDuContact, normaliserUrnLinkedIn } from './identite.js';

describe('normaliserUrnLinkedIn', () => {
  it.each([
    ['urn:li:fsd_profile:ACoAAB1234567890', 'ACoAAB1234567890'],
    ['ACoAAB1234567890', 'ACoAAB1234567890'],
    ['urn:li:fs_miniProfile:ACoAAB1234567890', 'ACoAAB1234567890'],
    ['  urn:li:fsd_profile:ACoAAB1234567890 ', 'ACoAAB1234567890'],
    ['urn:li:fsd_profile:AEMAAB1234567890', 'AEMAAB1234567890'],
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

  it('n écrit rien pour un URN illisible', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    await memoriserUrnDuContact({ query }, 'org-1', 'c-1', 'https://www.linkedin.com/in/x');
    expect(query).not.toHaveBeenCalled();
  });
});
