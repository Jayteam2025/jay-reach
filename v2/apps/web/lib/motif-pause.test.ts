import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CodeRefus } from '@jay-reach/worker/linkedin/envoi';
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

  it('cannot_invite retombe sur le refus générique', () => {
    expect(libelle('cannot_invite').texte).toBe('linkedinRefus');
  });

  // `bad_request` ne vient PAS de LinkedIn : le handler le pose lui-même quand l'étape
  // n'a aucun message à envoyer. Le ranger avec les refus de LinkedIn envoyait
  // l'opérateur vérifier son compte au lieu de sa séquence.
  it('une étape sans message dit que c est l étape, pas LinkedIn, qui manque', () => {
    expect(libelle('bad_request').texte).toBe('linkedinSansMessage');
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

/**
 * Le câblage entre les codes que le worker produit et les phrases que l'écran affiche.
 *
 * Ce bloc existe parce que les deux bouts ont déjà divergé sans que rien ne rougisse :
 * six phrases LinkedIn n'avaient été posées que dans l'un des deux blocs de traduction
 * jumeaux, et l'écran Contacts affichait un chemin de clé brut. La liste des codes est
 * DÉRIVÉE du type réel du worker (`Record<CodeRefus, true>`) : ajouter un code là-bas
 * sans passer ici ne compile plus, au lieu de laisser un refus muet atteindre l'écran.
 */
describe('tout refus que le worker peut produire a sa phrase, dans les trois langues', () => {
  const CODES_DU_WORKER: Record<CodeRefus, true> = {
    not_logged_in: true,
    restricted: true,
    already_invited: true,
    cannot_invite: true,
    cannot_message: true,
    profile_not_found: true,
    invalid_url: true,
    bad_request: true,
    note_non_supportee: true,
    defi: true,
  };

  // Posé par la réparation des lignes coincées, pas par un appel à LinkedIn : il
  // n'appartient pas à `CodeRefus` et doit être nommé à la main.
  const CODES = [...Object.keys(CODES_DU_WORKER), 'resultat_indetermine'];

  const blocs = (['fr', 'en', 'nl'] as const).map((langue) => ({
    langue,
    cles: JSON.parse(readFileSync(join(__dirname, `../../../packages/i18n/src/messages/${langue}.json`), 'utf8')).motifsPause as Record<
      string,
      string
    >,
  }));

  it.each(blocs)('$langue : chaque code mène à une phrase existante et non vide', ({ cles }) => {
    for (const code of CODES) {
      const cle = libelleMotifPause(`linkedin_refus:${code}`, null, (c) => c, 'Europe/Paris').texte;
      expect(cles[cle], `${code} → ${cle}`).toBeTruthy();
    }
  });

  it('les trois langues portent exactement les mêmes clés', () => {
    const [fr, ...autres] = blocs;
    for (const bloc of autres) {
      expect(Object.keys(bloc.cles).sort(), bloc.langue).toEqual(Object.keys(fr!.cles).sort());
    }
  });
});
