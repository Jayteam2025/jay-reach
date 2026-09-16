import { describe, it, expect } from 'vitest';
import { normaliserAdresse } from './adresses.js';

describe('normaliserAdresse', () => {
  it('met en minuscules', () => {
    expect(normaliserAdresse('Julien@Exemple.fr')).toBe('julien@exemple.fr');
  });

  it('retire l’étiquette +… de la partie locale, tous domaines', () => {
    expect(normaliserAdresse('julien+news@exemple.fr')).toBe('julien@exemple.fr');
  });

  it('retire les points de la partie locale pour gmail.com', () => {
    expect(normaliserAdresse('julien.dupont@gmail.com')).toBe('juliendupont@gmail.com');
  });

  it('retire les points de la partie locale pour googlemail.com', () => {
    expect(normaliserAdresse('julien.dupont@googlemail.com')).toBe('juliendupont@googlemail.com');
  });

  it('cumule étiquette et points sur gmail.com', () => {
    expect(normaliserAdresse('julien.dupont+news@gmail.com')).toBe('juliendupont@gmail.com');
  });

  it('conserve les points hors Gmail', () => {
    expect(normaliserAdresse('julien.dupont@exemple.fr')).toBe('julien.dupont@exemple.fr');
  });

  it('adresse sans @ renvoyée minuscule telle quelle', () => {
    expect(normaliserAdresse('PasUneAdresse')).toBe('pasuneadresse');
  });

  it('espaces superflus retirés', () => {
    expect(normaliserAdresse('  Julien@Exemple.fr  ')).toBe('julien@exemple.fr');
  });
});
