import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { CarteSessionLinkedIn } from './CarteSessionLinkedIn';

/** Les libellés réels : si une clé disparaît de `fr.json`, le typage le dit ici. */
const s = fr.reglages.expediteurs.linkedin.serveur;
const libelles = {
  titre: s.titre,
  sousTitre: s.sousTitre,
  compte: s.compte,
  comptePasEncore: s.comptePasEncore,
  sortie: s.sortie,
  envoisSemaine: s.envoisSemaine,
  derniereCollecte: s.derniereCollecte,
  jamais: s.jamais,
  inconnu: s.comptePasEncore,
  regler: s.regler,
  connecter: s.connecter,
};

const etatPret = { ton: 'bon', phrase: 'Prête à collecter.' };
const formater = () => 'il y a 4 h';

/** React échappe les apostrophes : on relit le texte tel que l'humain le voit. */
function texte(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

describe('la carte du compte LinkedIn sur l’écran Expéditeurs', () => {
  it('branchée, elle montre le compte, la sortie réseau et les envois mesurés', () => {
    const html = renderToStaticMarkup(
      <CarteSessionLinkedIn
        session={{ compteIdentifiant: 'alexandredeclercq', ipVue: '185.134.193.162', derniereCollecte: new Date() }}
        etat={etatPret}
        envoisTexte="12 / 200"
        libelles={libelles}
        formaterCollecte={formater}
      />,
    );
    expect(html).toContain('alexandredeclercq');
    expect(html).toContain('185.134.193.162');
    expect(html).toContain('12 / 200');
    expect(html).toContain('il y a 4 h');
    expect(texte(html)).toContain(libelles.regler);
  });

  // Le défaut réel du 12/10 : l'écran listait les jetons de l'extension gelée et annonçait
  // « aucun envoi ne partira : expéditeur non activé » alors que l'expéditeur du serveur
  // était actif en base. Il montrait un monde mort et déclarait éteint ce qui était allumé.
  it('elle ne parle plus de l’extension ni d’un expéditeur non activé', () => {
    const html = renderToStaticMarkup(
      <CarteSessionLinkedIn
        session={{ compteIdentifiant: 'alexandredeclercq', ipVue: '185.134.193.162', derniereCollecte: null }}
        etat={etatPret}
        envoisTexte="0 / 200"
        libelles={libelles}
        formaterCollecte={formater}
      />,
    );
    expect(html).not.toContain('extension');
    expect(html).not.toContain('non activé');
  });

  it('sans compte branché, elle invite à en brancher un au lieu d’annoncer un envoi', () => {
    const html = renderToStaticMarkup(
      <CarteSessionLinkedIn
        session={null}
        etat={{ ton: 'gris', phrase: 'Aucune session.' }}
        envoisTexte={null}
        libelles={libelles}
        formaterCollecte={formater}
      />,
    );
    expect(texte(html)).toContain(libelles.connecter);
    expect(texte(html)).toContain(libelles.comptePasEncore);
    expect(texte(html)).not.toContain(libelles.regler);
    // Aucun chiffre d'envoi quand rien n'est mesuré : un « 0 sur 0 » vaudrait moins que rien.
    expect(texte(html)).not.toContain(libelles.envoisSemaine);
  });

  it('collecte jamais faite, elle le dit au lieu d’un tiret', () => {
    const html = renderToStaticMarkup(
      <CarteSessionLinkedIn
        session={{ compteIdentifiant: 'alexandredeclercq', ipVue: null, derniereCollecte: null }}
        etat={etatPret}
        envoisTexte="0 / 200"
        libelles={libelles}
        formaterCollecte={formater}
      />,
    );
    expect(texte(html)).toContain(libelles.jamais);
  });
});
