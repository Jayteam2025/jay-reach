import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { ActionDeconnexion, type ActionDeconnexionProps } from './ActionDeconnexion';
import { ConnexionLinkedin } from './ConnexionLinkedin';

const c = fr.reglages.linkedin.connexion;
const libelles: ActionDeconnexionProps['libelles'] = {
  deconnecter: c.deconnecter,
  confirmation: c.deconnecterConfirmation,
  confirmer: c.deconnecterConfirmer,
  annuler: c.annuler,
};

/** React échappe l'apostrophe (`&#x27;`) : on relit le texte tel que l'humain le voit. */
function texte(html: string): string {
  return html.replace(/&#x27;/g, "'");
}

/**
 * Sous Node, sans DOM : pour « cliquer », on cherche dans l'arbre d'éléments rendu le rappel voulu
 * et on l'appelle (même démarche que `TableTaches.test.tsx`).
 */
function trouverRappel(noeud: unknown, nomProp: string, enfant?: string): (() => void) | null {
  if (Array.isArray(noeud)) {
    for (const n of noeud) {
      const trouve = trouverRappel(n, nomProp, enfant);
      if (trouve) return trouve;
    }
    return null;
  }
  if (typeof noeud !== 'object' || noeud === null || !isValidElement<Record<string, unknown>>(noeud)) return null;
  const rappel = noeud.props[nomProp];
  if (typeof rappel === 'function' && (enfant === undefined || noeud.props.children === enfant)) {
    return () => rappel();
  }
  return trouverRappel(noeud.props.children, nomProp, enfant);
}

function action(surcharge: Partial<ActionDeconnexionProps> = {}) {
  return ActionDeconnexion({
    demandee: false,
    onDemander: () => {},
    onAnnuler: () => {},
    onConfirmer: () => {},
    pending: false,
    libelles,
    ...surcharge,
  });
}

describe('« Déconnecter ce compte »', () => {
  it('un clic sur le bouton demande confirmation et ne déconnecte pas', () => {
    const onDemander = vi.fn();
    const onConfirmer = vi.fn();
    const clic = trouverRappel(action({ onDemander, onConfirmer }), 'onClick', 'Déconnecter ce compte');
    expect(clic).not.toBeNull();
    clic?.();
    expect(onDemander).toHaveBeenCalledTimes(1);
    expect(onConfirmer).not.toHaveBeenCalled();
  });

  it('avant la demande, aucune confirmation n’est affichée', () => {
    const html = renderToStaticMarkup(action());
    expect(html).toContain('Déconnecter ce compte');
    expect(html).not.toContain('Oui, déconnecter');
  });

  it('la confirmation dit ce qui s’arrête : la collecte et les envois LinkedIn', () => {
    const html = texte(renderToStaticMarkup(action({ demandee: true })));
    expect(html).toContain('arrête la collecte et les envois LinkedIn de votre organisation');
    expect(html).toContain('Oui, déconnecter');
    expect(html).toContain('Annuler');
  });

  it('« Oui, déconnecter » est la seule voie qui déconnecte, « Annuler » ne déconnecte pas', () => {
    const onConfirmer = vi.fn();
    const onAnnuler = vi.fn();
    const arbre = action({ demandee: true, onConfirmer, onAnnuler });
    trouverRappel(arbre, 'onAnnuler')?.();
    expect(onAnnuler).toHaveBeenCalledTimes(1);
    expect(onConfirmer).not.toHaveBeenCalled();
    trouverRappel(arbre, 'onConfirmer')?.();
    expect(onConfirmer).toHaveBeenCalledTimes(1);
  });

  it('l’écran de connexion y branche bien le bouton quand une session est ouverte', () => {
    const html = renderToStaticMarkup(
      <ConnexionLinkedin
        sessionActive
        demandeInitiale={null}
        peutModifier
        libelles={{
          connecter: c.connecter,
          reconnecter: c.reconnecter,
          deconnecter: c.deconnecter,
          deconnecterConfirmation: c.deconnecterConfirmation,
          deconnecterConfirmer: c.deconnecterConfirmer,
          annuler: c.annuler,
          valider: c.valider,
          identifiant: c.identifiant,
          motDePasse: c.motDePasse,
          code: c.code,
          codeAide: c.codeAide,
          approbation: c.approbation,
          approbationAide: c.approbationAide,
          tempsRestant: c.tempsRestant,
          modaleTitre: c.modaleTitre,
          avertissementSortie: c.avertissementSortie,
          avertissementRemplace: c.avertissementRemplace,
          avertissementMotDePasse: c.avertissementMotDePasse,
          enCours: c.enCours,
          etapes: c.etapes,
          motifs: c.motifs,
          erreurs: c.erreurs,
        }}
      />,
    );
    expect(html).toContain('Déconnecter ce compte');
    expect(html).not.toContain('Oui, déconnecter');
  });
});
