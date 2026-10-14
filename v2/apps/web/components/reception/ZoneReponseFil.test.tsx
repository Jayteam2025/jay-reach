import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ZoneReponseFil, type ZoneReponseFilProps } from './ZoneReponseFil';

const RAISON = "Message d'origine inconnu : impossible de répondre depuis l'application.";

const base: ZoneReponseFilProps = {
  filId: 'fil-1',
  depuis: 'Répondre depuis a.declercq@get-jay.fr',
  placeholder: 'Votre réponse…',
  note: 'Via SalesBlink, dans le même fil',
  interet: null,
  libelleMarquerInteresse: 'Marquer intéressé',
  libelleRetirerInteret: 'Retirer',
  libelleEnvoyer: 'Envoyer',
  libelleEnvoiEnCours: 'Envoi…',
  libelleEnvoyee: 'Envoyée',
  reponsePossible: true,
  raisonIndisponible: null,
};

describe('ZoneReponseFil : réponse impossible', () => {
  it('le champ de saisie est désactivé et la raison se lit AVANT lui', () => {
    const html = renderToStaticMarkup(
      <ZoneReponseFil {...base} reponsePossible={false} raisonIndisponible={RAISON} />,
    );
    const textarea = /<textarea[^>]*>/.exec(html)?.[0] ?? '';
    expect(textarea).toMatch(/\sdisabled(=|\s|>)/);
    const posRaison = html.indexOf(RAISON.replaceAll("'", '&#x27;'));
    expect(posRaison).toBeGreaterThan(-1);
    expect(posRaison).toBeLessThan(html.indexOf('<textarea'));
    // Le champ renvoie à la raison pour les lecteurs d'écran.
    const idRaison = /id="([^"]+)"[^>]*>[^<]*Message d/.exec(html)?.[1];
    expect(idRaison).toBeTruthy();
    expect(textarea).toContain(`aria-describedby="${idRaison}"`);
  });

  it('quand la réponse est possible, le champ reste actif et aucune raison ne précède le champ', () => {
    const html = renderToStaticMarkup(<ZoneReponseFil {...base} />);
    expect(/<textarea[^>]*>/.exec(html)?.[0]).not.toMatch(/\sdisabled/);
    expect(html).not.toContain('jr-reponse-raison');
  });
});
