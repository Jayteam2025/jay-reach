import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeconnexionCompte } from './DeconnexionCompte';

describe('DeconnexionCompte', () => {
  it('affiche un bouton « Se déconnecter » dans un formulaire relié à l’action fournie', () => {
    const html = renderToStaticMarkup(
      <DeconnexionCompte action={() => {}} libelles={{ titre: 'Session', bouton: 'Se déconnecter' }} />,
    );
    expect(html).toContain('Session');
    expect(html).toContain('<form');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Se déconnecter<\/button>/);
  });
});
