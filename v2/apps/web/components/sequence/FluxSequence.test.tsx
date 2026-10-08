import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EtapeVue, VueSequence } from '@jay-reach/core';
import { FluxSequence } from './FluxSequence';

// Seul `useTranslations` est utilisé par l'arbre rendu ici : la clé et ses valeurs suffisent,
// on veut prouver QUEL avertissement s'affiche, pas son texte traduit.
vi.mock('next-intl', () => ({
  useTranslations: () => (cle: string, valeurs?: Record<string, unknown>) =>
    `${cle}${valeurs ? JSON.stringify(valeurs) : ''}`,
}));

const etape = (position: number, canalDetaille: EtapeVue['canalDetaille'], corps = ''): EtapeVue => ({
  id: `etape-${position}`,
  position,
  canal: canalDetaille === 'email' ? 'email' : 'linkedin',
  canalDetaille,
  titre: 'Étape',
  sujet: null,
  corps,
  delaiHeures: 48,
  passes: 0,
  repondusIci: { total: 0, contacts: [] },
});

const vue = (etapes: EtapeVue[]): VueSequence => ({
  sources: [],
  qualifies: 0,
  etapes,
  finDeSequence: { termines: 0 },
  listeSource: null,
});

/**
 * Ce fichier existe à cause d'un vrai bug : la logique d'avertissement a d'abord été écrite
 * contre une fixture maison où le canal valait `linkedin_message`, alors que `lireSequence`
 * rend un canal collapsé. Les tests de la fonction pure étaient verts, et les deux
 * avertissements ne se déclenchaient jamais à l'écran. Un test de rendu l'aurait vu.
 */
describe('FluxSequence — les avertissements atteignent vraiment l écran', () => {
  it('un message LinkedIn sans invitation avant lui affiche son avertissement', () => {
    const html = renderToStaticMarkup(
      <FluxSequence campagneId="camp-1" vue={vue([etape(1, 'email', 'Bonjour'), etape(2, 'linkedin_message', 'Suite')])} />,
    );
    expect(html).toContain('avertissements.messageSansInvitation');
    expect(html).toContain('jr-avertissement');
  });

  it('une invitation qui porte une note affiche son avertissement', () => {
    const html = renderToStaticMarkup(
      <FluxSequence campagneId="camp-1" vue={vue([etape(1, 'linkedin_invite', 'On se connecte ?')])} />,
    );
    expect(html).toContain('avertissements.noteDInvitation');
  });

  it('une séquence saine n affiche aucun avertissement', () => {
    const html = renderToStaticMarkup(
      <FluxSequence campagneId="camp-1" vue={vue([etape(1, 'linkedin_invite', ''), etape(2, 'linkedin_message', 'Suite')])} />,
    );
    expect(html).not.toContain('jr-avertissement');
  });
});

/**
 * Même piège que ci-dessus, côté carte : `canal` est collapsé à `linkedin`, donc une
 * invitation et un message portaient la même tuile et la même mention. Depuis que
 * l'invitation est créable (lot 4b), l'opérateur doit lire laquelle il a posée.
 */
describe('CarteEtape — la carte nomme le canal réel', () => {
  it('une invitation se lit comme une invitation, et son absence de corps est normale', () => {
    const html = renderToStaticMarkup(
      <FluxSequence campagneId="camp-1" vue={vue([etape(1, 'linkedin_invite', '')])} />,
    );
    expect(html).toContain('card.channelLinkedinInvite');
    expect(html).toContain('card.inviteSansNote');
    // « Aucun message écrit pour cette étape » accuserait l'opérateur d'un oubli.
    expect(html).not.toContain('card.noMessage');
  });

  it('un message se lit comme un message, et montre son corps', () => {
    const html = renderToStaticMarkup(
      <FluxSequence campagneId="camp-1" vue={vue([etape(1, 'linkedin_invite', ''), etape(2, 'linkedin_message', 'Suite')])} />,
    );
    expect(html).toContain('card.channelLinkedinMessage');
    expect(html).toContain('Suite');
  });

  it('un email ne porte aucune mention de canal LinkedIn', () => {
    const html = renderToStaticMarkup(
      <FluxSequence campagneId="camp-1" vue={vue([etape(1, 'email', 'Bonjour')])} />,
    );
    expect(html).not.toContain('card.channelLinkedin');
  });
});
