import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CompteLinkedIn } from '@jay-reach/core';

/**
 * F15 (relecture) : la puce d'alerte `senderMissing` n'était couverte par
 * aucun test — pourtant la seule chose qui avertit l'opérateur qu'un compte
 * « connecté » n'enverra rien. Même motif que `SectionOuEnEstOn.test.tsx` :
 * un faux `next-intl` minimal (namespace + clé visibles, pas un
 * `NextIntlClientProvider` complet) et `next/navigation` réduit à un
 * `useRouter` muet, `CarteCompteLinkedIn` appelant les deux sans condition —
 * jamais `actionModifierCompteLinkedIn` (`app/actions/linkedin.ts`), non
 * invoquée par un rendu statique sans interaction.
 */
vi.mock('next-intl', () => ({
  useTranslations:
    (namespace: string) =>
    (cle: string, valeurs?: Record<string, string | number>) => {
      const suffixe = valeurs
        ? Object.entries(valeurs)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')
        : '';
      return suffixe ? `${namespace}.${cle}:${suffixe}` : `${namespace}.${cle}`;
    },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const { CarteCompteLinkedIn } = await import('./CarteCompteLinkedIn');

function compte(overrides: Partial<CompteLinkedIn> = {}): CompteLinkedIn {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    nom: 'Alexandre De Clercq',
    connecte: true,
    derniereActivite: '2026-09-18T11:35:24.000Z',
    active: true,
    envoiPossible: true,
    quotas: { parJour: 25, parSemaine: 100 },
    heures: { debut: '09:00', fin: '18:00', jours: [1, 2, 3, 4, 5], fuseau: 'Europe/Paris' },
    ...overrides,
  };
}

describe('CarteCompteLinkedIn', () => {
  // F15 : rougirait si la puce disparaissait, ou si elle s'affichait sans
  // condition (le cas qui compte : compte connecté, expéditeur pas encore
  // synchronisé — les deux jetons déjà actifs en base OSS avant la migration
  // de rattrapage).
  it('compte connecté sans expéditeur actif -> puce d’alerte affichée', () => {
    const html = renderToStaticMarkup(
      <CarteCompteLinkedIn compte={compte({ connecte: true, envoiPossible: false })} peutModifier />,
    );
    expect(html).toContain('reglages.expediteurs.linkedin.senderMissing');
    expect(html).toContain('jr-puce attention');
  });

  it('compte connecté avec un expéditeur actif -> pas de puce d’alerte', () => {
    const html = renderToStaticMarkup(
      <CarteCompteLinkedIn compte={compte({ connecte: true, envoiPossible: true })} peutModifier />,
    );
    expect(html).not.toContain('senderMissing');
  });

  // Un compte jamais connecté n'a rien de trompeur à signaler ici : « Non
  // connecté » (déjà affiché) suffit, même sans expéditeur.
  it('compte non connecté sans expéditeur -> pas de puce d’alerte (déjà « Non connecté »)', () => {
    const html = renderToStaticMarkup(
      <CarteCompteLinkedIn compte={compte({ connecte: false, envoiPossible: false })} peutModifier />,
    );
    expect(html).not.toContain('senderMissing');
    expect(html).toContain('reglages.expediteurs.linkedin.notConnected');
  });
});
