import { describe, expect, it, vi } from 'vitest';
import type { SessionLinkedIn } from '@jay-reach/core';

// `react` fournit `cache` : le module n'en a pas besoin pour ce qu'on teste ici.
vi.mock('react', async () => ({ ...(await vi.importActual<Record<string, unknown>>('react')), cache: <T>(f: T) => f }));

const lire = vi.hoisted(() => vi.fn());
vi.mock('@jay-reach/core', () => ({ lireSessionLinkedIn: lire }));

import type { Contexte } from '@jay-reach/core';
import { composerLigneLinkedIn, lireSessionLinkedInPourLaCoquille } from './linkedin-session';

const MAINTENANT = new Date('2026-10-05T12:00:00Z');
const base: SessionLinkedIn = {
  etat: 'active',
  motif: null,
  connecteeLe: new Date('2026-10-02T09:00:00Z'),
  bloqueeLe: null,
  ipAttendue: '82.65.14.207',
  ipVue: '82.65.14.207',
  operateur: 'Free SAS',
  pays: 'France',
  derniereCollecte: new Date('2026-10-05T10:00:00Z'),
};
// Rend la clé et ses valeurs : prouve QUELLE phrase est choisie, pas son texte traduit.
const t = (cle: string, valeurs?: Record<string, string>) => `${cle}${valeurs ? JSON.stringify(valeurs) : ''}`;

describe('composerLigneLinkedIn', () => {
  it('aucune session en base : la ligne existe quand même, « aucune session », ton gris', () => {
    expect(composerLigneLinkedIn(null, t, MAINTENANT, 'Europe/Paris')).toEqual({
      ton: 'gris',
      libelle: 'coquille.linkedin.libelle.aucune',
      detail: 'coquille.linkedin.detail.absente{"quand":""}',
    });
  });

  it('session prête : libellé « prêt » et dernière collecte relative', () => {
    expect(composerLigneLinkedIn(base, t, MAINTENANT, 'Europe/Paris')).toEqual({
      ton: 'bon',
      libelle: 'coquille.linkedin.libelle.pret',
      detail: 'coquille.linkedin.detail.derniereCollecte{"quand":"il y a 2 h"}',
    });
  });

  it('session bloquée : libellé « arrêté », ton erreur, détail du motif, jamais « prochaine collecte »', () => {
    const ligne = composerLigneLinkedIn({ ...base, etat: 'bloquee', motif: 'defi' }, t, MAINTENANT, 'Europe/Paris');
    expect(ligne?.ton).toBe('erreur');
    expect(ligne?.libelle).toBe('coquille.linkedin.libelle.arrete');
    expect(ligne?.detail).toContain('detail.defi');
    expect(JSON.stringify(ligne)).not.toMatch(/prochain|next/i);
  });
});

describe('lireSessionLinkedInPourLaCoquille', () => {
  const ctx = {} as Contexte;

  it('une lecture qui échoue (table absente, base injoignable) rend `undefined` (ligne masquée, pas « aucune session ») au lieu d’emporter toutes les pages', async () => {
    lire.mockRejectedValueOnce(new Error('relation "linkedin_server_sessions" does not exist'));
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(lireSessionLinkedInPourLaCoquille(ctx)).resolves.toBeUndefined();
    // Le type de l'erreur seulement : son message peut citer une requête.
    expect(avertir.mock.calls.flat().join(' ')).not.toContain('linkedin_server_sessions');
    avertir.mockRestore();
  });

  it('une lecture qui réussit rend la session telle quelle', async () => {
    lire.mockResolvedValueOnce(base);
    await expect(lireSessionLinkedInPourLaCoquille(ctx)).resolves.toBe(base);
  });
});
