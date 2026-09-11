import { describe, expect, it } from 'vitest';
import { corpsPourSalesBlink, objetPourSalesBlink } from './corps.js';

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
