import { describe, expect, it, vi } from 'vitest';
import { libelleModification } from './libelle-modification';

/** Même patron que `motif-pause.test.ts` : un faux `t` qui rend visible la clé ET les valeurs reçues. */
function fauxT() {
  return vi.fn((cle: string, valeurs?: Record<string, string>) => {
    const suffixe = valeurs
      ? Object.entries(valeurs)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')
      : '';
    return suffixe ? `${cle}:${suffixe}` : cle;
  });
}

const MAINTENANT = new Date('2026-09-18T12:00:00.000Z');

describe('libelleModification', () => {
  it('jamais réglé en base (modifieLe nul) : clé jamaisModifie, sans date ni auteur', () => {
    const t = fauxT();
    const r = libelleModification(null, null, t, MAINTENANT, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('jamaisModifie');
    expect(r).toBe('jamaisModifie');
  });

  // Le bug corrigé : un réglage posé hors écran (SQL direct, moteur) a `updated_by` nul mais
  // `updated_at` réel — rougirait si le résultat retombait sur `jamaisModifie`.
  it('réglé hors écran sans auteur résoluble (modifiePar nul, modifieLe renseigné) : la date, jamais « jamais »', () => {
    const t = fauxT();
    const r = libelleModification(null, '2026-09-18T07:59:00.000Z', t, MAINTENANT, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('modifieSansAuteur', { date: expect.any(String), estRelatif: expect.any(String) });
    expect(r).toMatch(/^modifieSansAuteur:/);
  });

  // Constat recette du 18/09 : « Modifié le aujourd'hui, 09:59 » — le gabarit ICU décide
  // lui-même du connecteur, mais encore faut-il qu'il reçoive de quoi choisir.
  it('modifié aujourd’hui : estRelatif vaut "oui"', () => {
    const t = fauxT();
    libelleModification(null, '2026-09-18T07:59:00.000Z', t, MAINTENANT, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('modifieSansAuteur', { date: expect.any(String), estRelatif: 'oui' });
  });

  it('modifié il y a plusieurs jours : estRelatif vaut "non"', () => {
    const t = fauxT();
    libelleModification(null, '2026-09-01T07:59:00.000Z', t, MAINTENANT, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('modifieSansAuteur', { date: expect.any(String), estRelatif: 'non' });
  });

  it('réglé depuis l’écran (auteur et date connus) : clé modifiePar avec le nom et la date', () => {
    const t = fauxT();
    const r = libelleModification('Camille Martin', '2026-09-18T07:59:00.000Z', t, MAINTENANT, 'Europe/Paris');
    expect(t).toHaveBeenCalledWith('modifiePar', { nom: 'Camille Martin', date: expect.any(String) });
    expect(r).toMatch(/^modifiePar:nom=Camille Martin,date=/);
  });

  // F11/lot 2 : la date suit le fuseau de l'organisation, jamais un fuseau fixe — même instant,
  // deux libellés différents (« aujourd'hui » ou pas) selon le fuseau.
  it('formate la date dans le fuseau donné, pas un fuseau fixe', () => {
    const t = fauxT();
    const instant = '2026-09-18T07:59:00.000Z';
    const enParis = libelleModification(null, instant, t, MAINTENANT, 'Europe/Paris');
    const enAuckland = libelleModification(null, instant, t, MAINTENANT, 'Pacific/Auckland');
    expect(enParis).toContain('aujourd');
    expect(enAuckland).not.toContain('aujourd');
  });
});
