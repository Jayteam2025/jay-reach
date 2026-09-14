import { describe, expect, it } from 'vitest';
import { corpsPourSalesBlink, objetPourSalesBlink, texteDepuisHtml } from './corps.js';

describe('corpsPourSalesBlink', () => {
  it('deux paragraphes séparés par une ligne vide donnent deux <p>', () => {
    expect(corpsPourSalesBlink('Bonjour Marie,\n\nCordialement, Paul')).toBe(
      '<p>Bonjour Marie,</p><p>Cordialement, Paul</p>',
    );
  });

  it('un saut simple donne <br>', () => {
    expect(corpsPourSalesBlink('Ligne un\nLigne deux')).toBe('<p>Ligne un<br>Ligne deux</p>');
  });

  it('< et & sont échappés', () => {
    expect(corpsPourSalesBlink('Chiffre < 5 & plus encore')).toBe('<p>Chiffre &lt; 5 &amp; plus encore</p>');
  });

  it('une URL nue reste telle quelle', () => {
    expect(corpsPourSalesBlink('Voir https://exemple.fr/page')).toBe('<p>Voir https://exemple.fr/page</p>');
  });
});

describe('objetPourSalesBlink', () => {
  it('retire les sauts de ligne', () => {
    expect(objetPourSalesBlink('Bonjour\nMarie')).toBe('Bonjour Marie');
  });

  it('tronque à 200 caractères', () => {
    const long = 'a'.repeat(250);
    expect(objetPourSalesBlink(long)).toHaveLength(200);
  });
});

describe('texteDepuisHtml', () => {
  it('retire les balises et rend le texte nu', () => {
    expect(texteDepuisHtml('<html><body><div>Bonjour</div></body></html>')).toBe('Bonjour');
  });

  it('retire <style> et <script> avec leur contenu', () => {
    expect(
      texteDepuisHtml('<style>.x{color:red}</style><script>alert(1)</script><p>Bonjour</p>'),
    ).toBe('Bonjour');
  });

  it('un <br> devient un saut de ligne', () => {
    expect(texteDepuisHtml('<p>Ligne un<br>Ligne deux</p>')).toBe('Ligne un\nLigne deux');
  });

  it('deux <div> consécutifs donnent deux lignes', () => {
    expect(texteDepuisHtml('<div>Un</div><div>Deux</div>')).toBe('Un\nDeux');
  });

  it('</li> et </tr> donnent aussi un saut de ligne', () => {
    expect(texteDepuisHtml('<ul><li>Un</li><li>Deux</li></ul>')).toBe('Un\nDeux');
    expect(texteDepuisHtml('<table><tr>Un</tr><tr>Deux</tr></table>')).toBe('Un\nDeux');
  });

  it('décode les entités HTML courantes', () => {
    expect(texteDepuisHtml('Chiffre &lt; 5 &amp; plus &gt; 0&nbsp;: &quot;test&quot; ou l&#39;autre')).toBe(
      'Chiffre < 5 & plus > 0 : "test" ou l\'autre',
    );
  });

  it('décode une entité numérique hexadécimale', () => {
    expect(texteDepuisHtml('Caf&#xE9;')).toBe('Café');
  });

  it('retire un commentaire HTML simple', () => {
    expect(texteDepuisHtml('<!-- commentaire --><p>Bonjour</p>')).toBe('Bonjour');
  });

  it(
    'retire un bloc conditionnel Outlook et garde le texte cité qui suit ' +
      '(fixture Outlook réaliste)',
    () => {
      const html = `
        <!--[if mso]>
        <style type="text/css">
          body,table,td,a { mso-line-height-rule: exactly; }
          .mso-hide { mso-hide: all; }
        </style>
        <![endif]-->
        <div>
          <p>Bonjour,</p>
          <p>Merci pour votre message, je reviens vers vous rapidement.</p>
          <p>De : Prospect Test<br>Envoyé : lundi 14 septembre 2026 10:00<br>À : Expéditeur Test<br>Objet : Re: Prise de contact</p>
        </div>
      `;

      const resultat = texteDepuisHtml(html);

      // Le bloc conditionnel Outlook (style mso-*) n'apparaît nulle part.
      expect(resultat).not.toContain('mso-hide');
      expect(resultat).not.toContain('mso-line-height-rule');
      expect(resultat).not.toContain('<style');
      // Le texte cité (« De : … Envoyé : … »), lui, est du texte légitime.
      expect(resultat).toContain('Bonjour,');
      expect(resultat).toContain('Merci pour votre message, je reviens vers vous rapidement.');
      expect(resultat).toContain('De : Prospect Test');
      expect(resultat).toContain('Envoyé : lundi 14 septembre 2026 10:00');
      expect(resultat).toContain('À : Expéditeur Test');
      expect(resultat).toContain('Objet : Re: Prise de contact');
    },
  );

  it('compacte les espaces et les lignes vides en trop', () => {
    expect(texteDepuisHtml('<p>Un</p>\n\n\n<p>Deux</p>   avec    des espaces')).toBe('Un\n\nDeux\navec des espaces');
  });

  it('coupe le résultat (espaces de début et de fin)', () => {
    expect(texteDepuisHtml('   <p>  Bonjour  </p>   ')).toBe('Bonjour');
  });

  it('une chaîne vide donne une chaîne vide', () => {
    expect(texteDepuisHtml('')).toBe('');
  });
});
