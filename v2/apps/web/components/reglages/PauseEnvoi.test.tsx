import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CorpsPauseEnvoi, type PauseEnvoiLibelles } from './PauseEnvoi';

const LIBELLES: PauseEnvoiLibelles = {
  titre: "Pause d'envoi globale",
  description: 'Coupe tous les envois.',
  etat: 'État',
  levee: 'levée',
  active: 'active',
  dernierePause: 'Dernière pause',
  aucunePause: 'Aucune pause enregistrée.',
  dernierePauseGabarit: '{depuis} à {jusqua} · {parQui}',
};

describe('CorpsPauseEnvoi', () => {
  it("affiche l'état « levée » (puce bon) quand la pause n'est pas active", () => {
    const html = renderToStaticMarkup(
      <CorpsPauseEnvoi actif={false} dernierePause={null} disabled={false} onChange={() => {}} libelles={LIBELLES} />,
    );
    expect(html).toContain('jr-puce bon');
    expect(html).toContain('levée');
    expect(html).toContain('Aucune pause enregistrée.');
    // L'interrupteur reflète l'état « non actif » (pas de pause en cours).
    expect(html).toContain('jr-interrupteur eteint');
  });

  it("affiche l'état « active » (puce erreur) et la dernière fenêtre refermée quand la pause est en cours", () => {
    const html = renderToStaticMarkup(
      <CorpsPauseEnvoi
        actif
        dernierePause={{ depuis: '11 sept., 14:20', jusqua: '16:05', parQui: 'Claire Moreau' }}
        disabled={false}
        onChange={() => {}}
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('jr-puce erreur');
    expect(html).toContain('active');
    expect(html).toContain('11 sept., 14:20 à 16:05 · Claire Moreau');
  });
});
