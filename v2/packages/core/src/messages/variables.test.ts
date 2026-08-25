import { describe, expect, it } from 'vitest';
import {
  countWords,
  exceedsWordLimit,
  extractVariableNames,
  parseTemplateTokens,
  renderTemplate,
  validateTemplateVariables,
} from './variables.js';

describe('extraction des variables', () => {
  it('extrait les noms distincts dans l’ordre', () => {
    expect(extractVariableNames('Bonjour {{prenom}} de {{entreprise}}, re-{{prenom}}')).toEqual([
      'prenom',
      'entreprise',
    ]);
  });

  it('parse la syntaxe de repli {{x|défaut}}', () => {
    const [t] = parseTemplateTokens('{{signal_zone|votre secteur}}');
    expect(t).toMatchObject({ name: 'signal_zone', fallback: 'votre secteur' });
  });

  it('distingue absence de repli et repli vide', () => {
    expect(parseTemplateTokens('{{ville}}')[0]?.fallback).toBeNull();
    expect(parseTemplateTokens('{{ville|}}')[0]?.fallback).toBe('');
  });

  it('tolère les espaces internes et la casse', () => {
    expect(parseTemplateTokens('{{  Prenom  }}')[0]).toMatchObject({ name: 'prenom' });
  });
});

describe('validation statique à l’enregistrement', () => {
  it('accepte les variables disponibles pour la nature', () => {
    expect(validateTemplateVariables('{{prenom}} chez {{entreprise}} — {{signal_titre}}', 'signal')).toEqual([]);
    expect(validateTemplateVariables('{{prenom}} — {{contexte}}', 'list')).toEqual([]);
  });

  it('refuse une variable signal dans une campagne liste (message explicite)', () => {
    const issues = validateTemplateVariables('{{signal_date}}', 'list');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ variable: 'signal_date', kind: 'unavailable' });
    expect(issues[0]?.message).toContain("n'existe pas pour une campagne alimentée par une liste");
  });

  it('refuse {{contexte}} dans une campagne signal', () => {
    expect(validateTemplateVariables('{{contexte}}', 'signal')[0]).toMatchObject({ kind: 'unavailable' });
  });

  it('refuse une variable inconnue', () => {
    expect(validateTemplateVariables('{{couleur_pref}}', 'signal')[0]).toMatchObject({
      variable: 'couleur_pref',
      kind: 'unknown',
    });
  });

  it('interdit une valeur de repli sur {{prenom}}', () => {
    expect(validateTemplateVariables('{{prenom|cher client}}', 'signal')[0]).toMatchObject({
      kind: 'fallback_forbidden',
    });
  });

  it('ne signale chaque problème qu’une fois', () => {
    expect(validateTemplateVariables('{{x}} {{x}}', 'signal')).toHaveLength(1);
  });
});

describe('rendu et variables manquantes (blocage)', () => {
  it('substitue les valeurs présentes', () => {
    const r = renderTemplate('Bonjour {{prenom}} de {{entreprise}}', { prenom: 'Alice', entreprise: 'Acme' });
    expect(r.text).toBe('Bonjour Alice de Acme');
    expect(r.missing).toEqual([]);
  });

  it('utilise la valeur de repli quand la variable est vide', () => {
    const r = renderTemplate('dans {{signal_zone|votre secteur}}', { signal_zone: '' });
    expect(r.text).toBe('dans votre secteur');
    expect(r.missing).toEqual([]);
  });

  it('remonte une variable vide sans repli (jamais de {{champ}} littéral)', () => {
    const r = renderTemplate('Bonjour {{prenom}}', { prenom: '   ' });
    expect(r.missing).toEqual(['prenom']);
    expect(r.text).not.toContain('{{');
    expect(r.text).toBe('Bonjour ');
  });

  it('remonte plusieurs manquantes, distinctes', () => {
    const r = renderTemplate('{{prenom}} {{entreprise}} {{prenom}}', {});
    expect(r.missing).toEqual(['prenom', 'entreprise']);
  });
});

describe('contraintes de longueur par canal', () => {
  it('compte les mots', () => {
    expect(countWords('  un  deux trois ')).toBe(3);
    expect(countWords('')).toBe(0);
  });

  it('applique le plafond de la note LinkedIn (45 mots)', () => {
    const court = Array(45).fill('mot').join(' ');
    const long = Array(46).fill('mot').join(' ');
    expect(exceedsWordLimit(court, 'linkedin_invite')).toBe(false);
    expect(exceedsWordLimit(long, 'linkedin_invite')).toBe(true);
  });

  it('distingue email d’ouverture (90) et relance (70)', () => {
    const texte = Array(80).fill('mot').join(' ');
    expect(exceedsWordLimit(texte, 'email_opening')).toBe(false);
    expect(exceedsWordLimit(texte, 'email_followup')).toBe(true);
  });
});
