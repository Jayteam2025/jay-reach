import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CANAUX_ETAPE_AFFICHES,
  CANAUX_ETAPE_SEQUENCE,
  estCanalEtapeSequence,
  lireCanalEtape,
  lireCanauxEtapes,
  sqlRangEtape,
} from './etapes-sql.js';

describe('canaux d’étape lus en base', () => {
  it('chaque canal connu est reconnu tel quel', () => {
    for (const canal of CANAUX_ETAPE_SEQUENCE) {
      expect(estCanalEtapeSequence(canal)).toBe(true);
      expect(lireCanalEtape(canal)).toBe(canal);
    }
  });

  it('un canal inconnu dégrade en « autre » (jamais email, jamais une erreur) et laisse une trace console', () => {
    const trace = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(estCanalEtapeSequence('sms')).toBe(false);
      expect(lireCanalEtape('sms')).toBe('autre');
      expect(lireCanauxEtapes(['linkedin_invite', 'sms'])).toEqual(['linkedin_invite', 'autre']);
      expect(trace).toHaveBeenCalledTimes(1); // une trace par valeur, pas une par ligne lue
      expect(String(trace.mock.calls[0]?.[0])).toContain('sms');
    } finally {
      trace.mockRestore();
    }
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
   * Garde de dérive : `channel_kind` est un enum SQL. Si une migration lui ajoute une valeur sans que
   * `CANAUX_ETAPE_SEQUENCE` suive, cet écart se voit ici, pas sur un écran en production. Toutes les migrations sont
   * lues : la création de l'enum ET chaque `alter type channel_kind add value`.
   */
  it('CANAUX_ETAPE_SEQUENCE reprend exactement l’enum channel_kind, créé puis étendu par les migrations', () => {
    const dossier = new URL('../../../../supabase/migrations/', import.meta.url);
    const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.sql')).sort();
    expect(fichiers.length).toBeGreaterThan(0);
    const valeurs: string[] = [];
    for (const f of fichiers) {
      const sql = readFileSync(new URL(f, dossier), 'utf8');
      const creation = /create type (?:public\.)?channel_kind as enum \(([^)]*)\)/i.exec(sql);
      if (creation?.[1]) valeurs.push(...creation[1].split(',').map((v) => v.trim().replace(/'/g, '')));
      for (const ajout of sql.matchAll(/alter type (?:public\.)?channel_kind add value (?:if not exists )?'([^']+)'/gi)) {
        if (ajout[1]) valeurs.push(ajout[1]);
      }
    }
    expect(valeurs.length).toBeGreaterThan(0);
    expect([...CANAUX_ETAPE_SEQUENCE].sort()).toEqual([...new Set(valeurs)].sort());
  });

  it('l’ensemble numéroté par sqlRangEtape est celui que montre l’onglet Séquence', () => {
    const sql = sqlRangEtape('st');
    for (const canal of CANAUX_ETAPE_AFFICHES) expect(sql).toContain(`'${canal}'`);
    expect(sql).not.toContain("'letter'");
    expect(sql).not.toContain("'call'");
  });
});
