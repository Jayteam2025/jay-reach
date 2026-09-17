import { describe, expect, it, vi } from 'vitest';
import { libelleMotifPause } from './motif-pause';

/** Même patron que `etape-contact.test.tsx` : un faux `t` qui rend visible la clé ET les valeurs reçues. */
function fauxT() {
  return vi.fn((cle: string, valeurs?: Record<string, string | number>) => {
    const suffixe = valeurs
      ? Object.entries(valeurs)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')
      : '';
    return suffixe ? `${cle}:${suffixe}` : cle;
  });
}

describe('libelleMotifPause', () => {
  it('email_gate:* → clé emailGate, sans code en title', () => {
    const t = fauxT();
    const r = libelleMotifPause('email_gate:bouncer_invalid', null, t);
    expect(t).toHaveBeenCalledWith('emailGate');
    expect(r).toEqual({ texte: 'emailGate', title: null });
  });

  it('salesblink_client_error → clé salesblinkError', () => {
    const t = fauxT();
    const r = libelleMotifPause('salesblink_client_error', null, t);
    expect(t).toHaveBeenCalledWith('salesblinkError');
    expect(r).toEqual({ texte: 'salesblinkError', title: null });
  });

  it('sender_unavailable:* → clé senderUnavailable', () => {
    const t = fauxT();
    const r = libelleMotifPause('sender_unavailable:email', null, t);
    expect(t).toHaveBeenCalledWith('senderUnavailable');
    expect(r).toEqual({ texte: 'senderUnavailable', title: null });
  });

  it('absence avec une date de reprise : clé absence avec {date} formatée', () => {
    const t = fauxT();
    const r = libelleMotifPause('absence', '2026-09-22T08:00:00.000Z', t, 'fr-FR');
    expect(t).toHaveBeenCalledWith('absence', { date: expect.any(String) });
    expect(r.texte).toMatch(/^absence:date=/);
    expect(r.title).toBeNull();
  });

  it('absence sans date de reprise : clé absenceNoDate, sans paramètre', () => {
    const t = fauxT();
    const r = libelleMotifPause('absence', null, t);
    expect(t).toHaveBeenCalledWith('absenceNoDate');
    expect(r).toEqual({ texte: 'absenceNoDate', title: null });
  });

  it('motif inconnu : clé generic, le code brut en title (jamais dans le texte)', () => {
    const t = fauxT();
    const r = libelleMotifPause('un_code_jamais_vu', null, t);
    expect(t).toHaveBeenCalledWith('generic');
    expect(r).toEqual({ texte: 'generic', title: 'un_code_jamais_vu' });
  });
});
