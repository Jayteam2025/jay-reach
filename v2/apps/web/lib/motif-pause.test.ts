import { describe, expect, it, vi } from 'vitest';
import { libelleMotifPause, libelleProchainMessage } from './motif-pause';

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
    const r = libelleMotifPause('email_gate:bouncer_invalid', null, t, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('emailGate');
    expect(r).toEqual({ texte: 'emailGate', title: null });
  });

  it('salesblink_client_error → clé salesblinkError', () => {
    const t = fauxT();
    const r = libelleMotifPause('salesblink_client_error', null, t, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('salesblinkError');
    expect(r).toEqual({ texte: 'salesblinkError', title: null });
  });

  it('sender_unavailable:* → clé senderUnavailable', () => {
    const t = fauxT();
    const r = libelleMotifPause('sender_unavailable:email', null, t, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('senderUnavailable');
    expect(r).toEqual({ texte: 'senderUnavailable', title: null });
  });

  it('absence avec une date de reprise : clé absence avec {date} formatée', () => {
    const t = fauxT();
    const r = libelleMotifPause('absence', '2026-09-22T08:00:00.000Z', t, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('absence', { date: expect.any(String) });
    expect(r.texte).toMatch(/^absence:date=/);
    expect(r.title).toBeNull();
  });

  it('absence sans date de reprise : clé absenceNoDate, sans paramètre', () => {
    const t = fauxT();
    const r = libelleMotifPause('absence', null, t, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('absenceNoDate');
    expect(r).toEqual({ texte: 'absenceNoDate', title: null });
  });

  it('motif inconnu : clé generic, le code brut en title (jamais dans le texte)', () => {
    const t = fauxT();
    const r = libelleMotifPause('un_code_jamais_vu', null, t, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('generic');
    expect(r).toEqual({ texte: 'generic', title: 'un_code_jamais_vu' });
  });

  // Correctif du 18/09 : la date de reprise vivait juste au-dessus de celle du prochain
  // message (`libelleProchainMessage`, déjà correcte) et suivait encore le fuseau du process
  // faute de `timeZone`. Rougirait si `fuseau` était ignoré (ou codé en dur) — même instant,
  // deux jours calendaires différents selon le fuseau de l'organisation.
  it('formate la date de reprise dans le fuseau donné, pas un fuseau fixe', () => {
    const t = fauxT();
    const instant = '2026-09-27T23:00:00.000Z';
    const enParis = libelleMotifPause('absence', instant, t, 'Europe/Paris');
    const enUtc = libelleMotifPause('absence', instant, t, 'UTC');
    expect(enParis.texte).toContain('28 septembre');
    expect(enUtc.texte).toContain('27 septembre');
  });
});

describe('libelleProchainMessage', () => {
  it('sans échéance connue : null, sans appeler t (jamais un texte vide affiché)', () => {
    const t = fauxT();
    const r = libelleProchainMessage(null, t, 'Europe/Paris');
    expect(r).toBeNull();
    expect(t).not.toHaveBeenCalled();
  });

  it('clé nextMessage avec {date} formatée (jour numérique + mois en toutes lettres)', () => {
    const t = fauxT();
    const r = libelleProchainMessage('2026-09-28T08:00:00.000Z', t, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('nextMessage', { date: expect.any(String) });
    expect(r).toMatch(/^nextMessage:date=/);
  });

  // F11 : rougirait si `fuseau` était ignoré (ou codé en dur sur `Europe/Paris`) — même instant,
  // deux jours calendaires différents selon le fuseau de l'organisation.
  it('formate la date dans le fuseau donné, pas un fuseau fixe', () => {
    const t = fauxT();
    const instant = '2026-09-27T23:00:00.000Z';
    const enParis = libelleProchainMessage(instant, t, 'Europe/Paris');
    const enUtc = libelleProchainMessage(instant, t, 'UTC');
    expect(enParis).toContain('28 septembre');
    expect(enUtc).toContain('27 septembre');
  });
});

// Un refus d'envoi LinkedIn met l'inscription en pause avec `linkedin_refus:<code>`. Les huit
// codes sont regroupés par ce que l'opérateur doit FAIRE, pas par ce que l'API a répondu.
describe('libelleMotifPause — refus LinkedIn', () => {
  const libelle = (code: string) =>
    libelleMotifPause(`linkedin_refus:${code}`, null, fauxT(), 'Europe/Paris');

  it('la note d invitation a son propre libellé : c est le seul qui se corrige', () => {
    expect(libelle('note_non_supportee').texte).toBe('linkedinNote');
  });

  it('un message sans relation acceptée ne se lit pas comme une panne', () => {
    expect(libelle('cannot_message').texte).toBe('linkedinPasRelation');
  });

  it.each(['profile_not_found', 'invalid_url'])('%s renvoie à l adresse du contact', (code) => {
    expect(libelle(code).texte).toBe('linkedinProfil');
  });

  it('un résultat indéterminé envoie vérifier sur LinkedIn', () => {
    expect(libelle('resultat_indetermine').texte).toBe('linkedinIndetermine');
  });

  it.each(['cannot_invite', 'bad_request'])('%s retombe sur le refus générique', (code) => {
    expect(libelle(code).texte).toBe('linkedinRefus');
  });

  // Le code brut reste atteignable pour qui veut creuser, sans être lu par accident.
  it('le code brut reste en title, jamais dans le texte', () => {
    const r = libelle('note_non_supportee');
    expect(r.title).toBe('linkedin_refus:note_non_supportee');
    expect(r.texte).not.toContain('note_non_supportee');
  });

  // Sans ce test, un motif LinkedIn inconnu tomberait sur `generic` sans qu'on le voie.
  it('un motif LinkedIn inconnu reste un refus LinkedIn, pas le générique', () => {
    expect(libelle('code_que_personne_n_a_encore_vu').texte).toBe('linkedinRefus');
  });
});
