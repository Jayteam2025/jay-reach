import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Demande } from '@jay-reach/core';
import fr from '@jay-reach/i18n/messages/fr.json';
import { ConnexionLinkedin } from './ConnexionLinkedin';

/** Les libellés réels, lus sans cast : si une clé disparaît de `fr.json`, le typage le dit ici. */
const c = fr.reglages.linkedin.connexion;
const libelles = {
  connecter: c.connecter,
  reconnecter: c.reconnecter,
  deconnecter: c.deconnecter,
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
  motifs: c.motifs as Record<string, string>,
  erreurs: c.erreurs as Record<string, string>,
};

/**
 * React échappe les apostrophes et les guillemets (`&#x27;`). On relit le texte tel que l'humain le
 * voit, plutôt que d'écrire des attentes échappées que personne ne saurait relire.
 */
function texte(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&');
}

function demande(p: Partial<Demande>): Demande {
  return {
    id: 'd1',
    statut: 'demandee',
    motif: null,
    etape: null,
    creeeLe: new Date('2026-10-12T10:00:00Z'),
    expireLe: new Date('2026-10-12T10:15:00Z'),
    ...p,
  };
}

describe('la connexion LinkedIn depuis l’écran', () => {
  /**
   * Le défaut du 14/10 : pendant que LinkedIn attendait un « Oui, c'est moi » sur le téléphone,
   * l'écran ne disait rien. Il ne parlait de l'application mobile qu'une fois l'échec consommé,
   * et conseillait alors un ordre impossible — approuver, puis se reconnecter — alors que
   * LinkedIn redemande une approbation à chaque tentative.
   */
  it('pendant l’attente d’approbation, elle dit d’ouvrir l’application mobile', () => {
    const html = texte(
      renderToStaticMarkup(
        <ConnexionLinkedin
          sessionActive={false}
          demandeInitiale={demande({ statut: 'approbation_demandee', etape: 'approbation_demandee' })}
          peutModifier
          libelles={libelles}
        />,
      ),
    );
    expect(html).toContain(libelles.approbation);
    expect(html).toContain(libelles.approbationAide);
    // Rien à saisir : un champ de code ici laisserait croire qu'on attend quelque chose de l'écran.
    expect(html).not.toContain('jr-connexion-code');
    expect(html).not.toContain('one-time-code');
    // Un seul moyen de sortir, pas deux : le bouton générique ne doit pas doubler celui du bloc.
    expect(html.split(libelles.annuler).length - 1).toBe(1);
  });

  it('le motif d’échec ne conseille plus d’approuver puis de se reconnecter', () => {
    // L'approbation ne vaut que pour la tentative en cours : l'ordre inverse ne marche pas.
    expect(libelles.motifs.defi).not.toContain('puis reconnectez-vous');
    expect(libelles.motifs.defi).toContain('téléphone');
  });

  it('sans session ni demande, elle propose de brancher le compte', () => {
    const html = renderToStaticMarkup(
      <ConnexionLinkedin sessionActive={false} demandeInitiale={null} peutModifier libelles={libelles} />,
    );
    expect(texte(html)).toContain(libelles.connecter);
    expect(texte(html)).not.toContain(libelles.deconnecter);
    expect(texte(html)).not.toContain(libelles.etapes.session_active);
  });

  // L'écran affichait une commande shell à taper dans un terminal du serveur : c'est ce que ce
  // lot supprime. Si elle revenait, l'opérateur ne serait plus autonome.
  it('elle ne montre aucune commande de terminal', () => {
    const html = renderToStaticMarkup(
      <ConnexionLinkedin sessionActive={false} demandeInitiale={null} peutModifier libelles={libelles} />,
    );
    expect(html).not.toContain('jay-reach linkedin');
  });

  it('session ouverte, elle propose de débrancher, pas de rebrancher', () => {
    const html = renderToStaticMarkup(
      <ConnexionLinkedin sessionActive demandeInitiale={null} peutModifier libelles={libelles} />,
    );
    expect(texte(html)).toContain(libelles.deconnecter);
    expect(texte(html)).not.toContain(libelles.connecter);
  });

  // Le relevé est la raison d'être de l'écran pendant l'attente : l'utilisateur vient de confier
  // son mot de passe et doit voir ce que le serveur en fait.
  it('pendant la connexion, elle montre le relevé et marque l’étape en cours', () => {
    const html = renderToStaticMarkup(
      <ConnexionLinkedin
        sessionActive={false}
        demandeInitiale={demande({ statut: 'navigateur_ouvert', etape: 'identifiants_transmis' })}
        peutModifier
        libelles={libelles}
      />,
    );
    for (const etape of Object.values(libelles.etapes)) expect(texte(html)).toContain(etape);
    expect(html).toContain('jr-releve-ligne--encours');
    expect(html).toContain('jr-releve-ligne--faite');
    expect(html).toContain('jr-releve-ligne--avenir');
    expect(texte(html)).toContain(libelles.annuler);
    // Tant que la connexion vit, on ne propose ni d'en relancer une, ni de débrancher.
    expect(texte(html)).not.toContain(libelles.connecter);
    expect(texte(html)).not.toContain(libelles.deconnecter);
  });

  it('quand LinkedIn réclame un code, le champ est là et le reste attend', () => {
    const html = renderToStaticMarkup(
      <ConnexionLinkedin
        sessionActive={false}
        demandeInitiale={demande({ statut: 'code_demande', etape: 'code_demande' })}
        peutModifier
        libelles={libelles}
      />,
    );
    expect(texte(html)).toContain(libelles.code);
    expect(texte(html)).toContain(libelles.codeAide);
    expect(texte(html)).toContain(libelles.valider);
    expect(html).toContain('one-time-code');
  });

  // Règle d'écriture du système de design : une erreur dit ce qui s'est passé ET quoi faire.
  it('après un échec, elle donne le motif et propose de recommencer', () => {
    const html = renderToStaticMarkup(
      <ConnexionLinkedin
        sessionActive={false}
        demandeInitiale={demande({ statut: 'echec', motif: 'defi', etape: 'identifiants_transmis' })}
        peutModifier
        libelles={libelles}
      />,
    );
    expect(texte(html)).toContain(libelles.motifs.defi);
    expect(texte(html)).toContain(libelles.reconnecter);
    expect(texte(html)).not.toContain(libelles.annuler);
  });

  it('un échec « serveur absent » dit quoi vérifier', () => {
    const html = renderToStaticMarkup(
      <ConnexionLinkedin
        sessionActive={false}
        demandeInitiale={demande({ statut: 'echec', motif: 'worker_absent' })}
        peutModifier
        libelles={libelles}
      />,
    );
    expect(texte(html)).toContain(libelles.motifs.worker_absent);
  });

  // L'écriture exige le droit d'administrer : un bouton que le serveur refuserait ne s'affiche pas.
  it('sans droit de modifier, aucun bouton n’apparaît', () => {
    const html = renderToStaticMarkup(
      <ConnexionLinkedin sessionActive demandeInitiale={null} peutModifier={false} libelles={libelles} />,
    );
    expect(html).toBe('');
  });

  // La promesse faite à l'utilisateur : le mot de passe ne traîne nulle part. Le formulaire
  // n'existe même pas dans le document tant qu'il n'a pas demandé à le remplir.
  it('aucun champ de mot de passe n’est rendu avant d’ouvrir la fenêtre', () => {
    const html = renderToStaticMarkup(
      <ConnexionLinkedin sessionActive={false} demandeInitiale={null} peutModifier libelles={libelles} />,
    );
    expect(html).not.toContain('type="password"');
    expect(texte(html)).not.toContain(libelles.motDePasse);
    expect(texte(html)).not.toContain(libelles.avertissementSortie);
  });
});
