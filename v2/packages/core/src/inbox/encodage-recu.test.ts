/**
 * Réception : un corps relevé « PrÃ©servez » / « EnvoyÃ© » (constat du 27/10 sur un message du 14/10,
 * stocké tel quel en base : les octets UTF-8 d'un texte relus comme du Windows-1252, puis ré-encodés).
 * Les formes viennent de la base réelle, vérifiées au code de caractère près : « Ã » (U+00C3) puis « © »
 * (U+00A9) pour « é ». Le même message mélangeait du texte juste (é, à écrits correctement) et du texte
 * abîmé : la réparation travaille donc séquence par séquence, jamais sur le message entier.
 */
import { describe, expect, it } from 'vitest';
import { reparerMojibake } from './encodage-recu.js';

/** Fabrique la forme abîmée d'un texte : ses octets UTF-8 relus en Windows-1252. */
function abimer(texte: string): string {
  return new TextDecoder('windows-1252').decode(new TextEncoder().encode(texte));
}

describe('réparation d’un texte UTF-8 relu en Windows-1252', () => {
  it('rend les deux formes réelles du constat', () => {
    expect(reparerMojibake('PrÃ©servez')).toBe('Préservez');
    expect(reparerMojibake('EnvoyÃ© par')).toBe('Envoyé par');
  });

  it('répare accents, à (octet 0xA0 devenu espace insécable), ponctuation et emoji', () => {
    for (const juste of ['À bientôt, ça va ?', 'voilà', 'l’équipe — “ok” … 5 €', 'Œuvre, cœur', 'merci 👍']) {
      expect(reparerMojibake(abimer(juste))).toBe(juste);
    }
  });

  it('laisse intact un texte déjà juste, ASCII ou accentué', () => {
    for (const juste of ['Stop message', 'Préservez l’environnement', 'ÉTÉ : voilà !', 'Ça', 'Å', 'naïve — café']) {
      expect(reparerMojibake(juste)).toBe(juste);
    }
  });

  it('répare seulement la partie abîmée d’un message mêlant texte juste et texte abîmé', () => {
    const melange = `Bonjour, merci de votre message. ${abimer('Envoyé : mardi à 10 h')} Cordialement, Hélène`;
    expect(reparerMojibake(melange)).toBe('Bonjour, merci de votre message. Envoyé : mardi à 10 h Cordialement, Hélène');
  });

  it('une séquence incomplète ou invalide reste telle quelle', () => {
    expect(reparerMojibake('Ã')).toBe('Ã');
    expect(reparerMojibake('Ã seul')).toBe('Ã seul');
    expect(reparerMojibake('â€')).toBe('â€');
  });

  it('est idempotente', () => {
    const une = reparerMojibake(abimer('Préservez l’environnement'));
    expect(reparerMojibake(une)).toBe(une);
  });
});
