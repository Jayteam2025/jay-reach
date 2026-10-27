import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CANAUX_ETAPE_SEQUENCE, estCanalEtapeSequence, lireCanalEtape, lireCanauxEtapes } from './etapes-sql.js';

describe('canaux d’étape lus en base', () => {
  it('chaque canal connu est reconnu tel quel', () => {
    for (const canal of CANAUX_ETAPE_SEQUENCE) {
      expect(estCanalEtapeSequence(canal)).toBe(true);
      expect(lireCanalEtape(canal)).toBe(canal);
    }
  });

  it('un canal inconnu lève une erreur au lieu de se replier sur email', () => {
    expect(estCanalEtapeSequence('sms')).toBe(false);
    expect(() => lireCanalEtape('sms')).toThrow(/sms/);
    expect(() => lireCanauxEtapes(['linkedin_invite', 'sms'])).toThrow(/sms/);
  });

  it('une liste garde l’ordre de la séquence, et la liste vide reste vide', () => {
    expect(lireCanauxEtapes(['linkedin_invite', 'email', 'linkedin_message'])).toEqual([
      'linkedin_invite',
      'email',
      'linkedin_message',
    ]);
    expect(lireCanauxEtapes([])).toEqual([]);
  });

  /**
   * Garde de dérive : `channel_kind` est un enum SQL. Si une migration lui ajoute une valeur sans
   * que `CANAUX_ETAPE_SEQUENCE` suive, cet écart se voit ici, pas sur un écran en production.
   */
  it('CANAUX_ETAPE_SEQUENCE reprend exactement l’enum channel_kind de la migration initiale', () => {
    const sql = readFileSync(
      new URL('../../../../supabase/migrations/20260817120000_init_schema.sql', import.meta.url),
      'utf8',
    );
    const m = /create type channel_kind as enum \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    const valeurs = (m?.[1] ?? '').split(',').map((v) => v.trim().replace(/'/g, ''));
    expect([...CANAUX_ETAPE_SEQUENCE].sort()).toEqual([...valeurs].sort());
  });
});
