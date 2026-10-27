import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Evenement } from '@jay-reach/core';

// Faux `next-intl` minimal : rend namespace, clé et valeurs, pour voir CE QUE l'écran demande de traduire.
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

const { SectionHistorique } = await import('./SectionHistorique');

function evenement(surcharge: Partial<Evenement>): Evenement {
  return { id: 'e1', quand: '2026-10-20T10:00:00.000Z', type: 'action_skipped', libelle: '', detail: null, ...surcharge };
}

describe('SectionHistorique (#181)', () => {
  it('un événement en CODE est traduit à l’écran avec ses paramètres, libellé et détail', () => {
    const html = renderToStaticMarkup(
      <SectionHistorique
        historique={[evenement({ code: 'linkedin_message_saute', parametres: { jours: 7 } })]}
        fuseau="Europe/Paris"
      />,
    );
    expect(html).toContain('campagne.fiche.history.codes.linkedin_message_saute.libelle:jours=7');
    expect(html).toContain('campagne.fiche.history.codes.linkedin_message_saute.detail:jours=7');
  });

  it('un événement ancien en texte libre reste affiché tel quel, en repli', () => {
    const html = renderToStaticMarkup(
      <SectionHistorique
        historique={[evenement({ libelle: 'Message LinkedIn passé : l’invitation n’a pas été acceptée en 7 jours.', detail: 'La séquence continue à l’étape suivante.' })]}
        fuseau="Europe/Paris"
      />,
    );
    expect(html).toContain('Message LinkedIn passé : l’invitation n’a pas été acceptée en 7 jours.');
    expect(html).toContain('La séquence continue à l’étape suivante.');
    expect(html).not.toContain('history.codes');
  });
});
