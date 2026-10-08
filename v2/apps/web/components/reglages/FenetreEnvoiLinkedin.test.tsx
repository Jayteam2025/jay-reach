import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HeuresEnvoiLinkedIn } from '@jay-reach/core';
import { FenetreEnvoiLinkedin, memeFenetre, refusFenetreEnvoi } from './FenetreEnvoiLinkedin';

vi.mock('next-intl', () => ({
  useTranslations: () => (cle: string, valeurs?: Record<string, unknown>) =>
    `${cle}${valeurs ? JSON.stringify(valeurs) : ''}`,
}));

/**
 * La valeur rendue par l'écran DÉRIVE du type du cœur (`HeuresEnvoiLinkedIn`), elle
 * n'est pas redéclarée ici : une fixture écrite à la main a déjà gardé vivant, sur
 * cette branche, un défaut que treize tests verts prétendaient verrouiller — la
 * production fournissait une autre forme que la fixture.
 */
const fenetre = (p: Partial<HeuresEnvoiLinkedIn> = {}): HeuresEnvoiLinkedIn => ({
  debutHeure: 9,
  finHeure: 18,
  jours: [1, 2, 3, 4, 5],
  fuseau: 'Europe/Paris',
  ...p,
});

describe('refusFenetreEnvoi', () => {
  it('accepte une fenêtre ordinaire', () => {
    expect(refusFenetreEnvoi(fenetre())).toBeNull();
  });

  it('refuse une fin antérieure au début', () => {
    expect(refusFenetreEnvoi(fenetre({ debutHeure: 18, finHeure: 9 }))).toBe('ordre');
  });

  it('refuse une fenêtre vide, début et fin confondus', () => {
    expect(refusFenetreEnvoi(fenetre({ debutHeure: 9, finHeure: 9 }))).toBe('ordre');
  });

  it('refuse une semaine sans aucun jour : le moteur n enverrait jamais, en silence', () => {
    expect(refusFenetreEnvoi(fenetre({ jours: [] }))).toBe('jours');
  });
});

describe('memeFenetre', () => {
  it('reconnaît deux fenêtres identiques', () => {
    expect(memeFenetre(fenetre(), fenetre())).toBe(true);
  });

  it('voit un jour retiré', () => {
    expect(memeFenetre(fenetre(), fenetre({ jours: [1, 2, 3, 4] }))).toBe(false);
  });

  it('voit un jour échangé contre un autre, à nombre de jours égal', () => {
    expect(memeFenetre(fenetre({ jours: [1, 2, 3, 4, 5] }), fenetre({ jours: [1, 2, 3, 4, 6] }))).toBe(false);
  });

  it('voit un changement de fuseau, à heures égales', () => {
    expect(memeFenetre(fenetre(), fenetre({ fuseau: 'Europe/London' }))).toBe(false);
  });
});

describe('FenetreEnvoiLinkedin — ce que l écran rend vraiment', () => {
  it('affiche la fenêtre enregistrée, pas une valeur par défaut', () => {
    const html = renderToStaticMarkup(<FenetreEnvoiLinkedin valeur={fenetre({ debutHeure: 10, finHeure: 17 })} peutModifier />);
    expect(html).toContain('<option value="10" selected="">10:00</option>');
    expect(html).toContain('<option value="17" selected="">17:00</option>');
  });

  it('marque les jours actifs, et seulement eux', () => {
    const html = renderToStaticMarkup(<FenetreEnvoiLinkedin valeur={fenetre({ jours: [1, 3] })} peutModifier />);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(5);
  });

  it('ne propose pas d enregistrer tant que rien n a changé', () => {
    const html = renderToStaticMarkup(<FenetreEnvoiLinkedin valeur={fenetre()} peutModifier />);
    // La clé rendue par le mock, pas son chemin complet : chercher « fenetre.enregistrer »
    // rendrait ce test vert quoi qu il arrive, puisque ce préfixe n apparaît jamais.
    expect(html).not.toContain('>enregistrer<');
  });

  it('laisse lire mais pas agir sans droit de modification', () => {
    const html = renderToStaticMarkup(<FenetreEnvoiLinkedin valeur={fenetre()} peutModifier={false} />);
    expect(html).toContain('>heures.nom<');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(9);
  });

  it('propose les 24 heures de début et les 24 heures de fin, jusqu à minuit', () => {
    const html = renderToStaticMarkup(<FenetreEnvoiLinkedin valeur={fenetre()} peutModifier />);
    expect(html).toContain('<option value="0">00:00</option>');
    expect(html).toContain('<option value="24">24:00</option>');
    expect(html).not.toContain('<option value="25">');
  });
});
