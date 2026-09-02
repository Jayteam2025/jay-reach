import { describe, expect, it } from 'vitest';
import {
  countWords,
  exceedsWordLimit,
  extractVariableNames,
  parseTemplateTokens,
  renderTemplate,
  validateTemplateVariables,
  normalizeVariableSyntax,
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

describe('on écrit le nom, le reste se répare', () => {
  it('accepte une accolade simple, la casse et les espaces', () => {
    // La double accolade est une convention de développeur. Un opérateur qui
    // écrit ce qu'il a sous les yeux ne doit pas voir son message partir avec
    // les accolades visibles chez le prospect.
    expect(normalizeVariableSyntax('Bonjour {prenom},')).toBe('Bonjour {{prenom}},');
    expect(normalizeVariableSyntax('Bonjour {Prenom},')).toBe('Bonjour {{prenom}},');
    expect(normalizeVariableSyntax('Bonjour { prenom },')).toBe('Bonjour {{prenom}},');
    expect(normalizeVariableSyntax('Bonjour {{ PRENOM }},')).toBe('Bonjour {{prenom}},');
  });

  it('garde les valeurs de repli', () => {
    expect(normalizeVariableSyntax('à {ville|votre région}')).toBe('à {{ville|votre région}}');
  });

  it('ne touche pas à ce qui n’est pas une variable connue', () => {
    // Sans cette réserve, « {50} euros » deviendrait une variable fantôme, et
    // le message serait bloqué à l'envoi pour une accolade décorative.
    expect(normalizeVariableSyntax('le tarif est de {50} euros')).toBe('le tarif est de {50} euros');
    expect(normalizeVariableSyntax('accolade {décorative ici}')).toBe('accolade {décorative ici}');
  });

  it('signale un nom qui ressemble à une variable ratée', () => {
    // `{name}` traversait tous les contrôles et partait littéralement.
    const soucis = validateTemplateVariables('Bonjour {name},', 'signal');
    expect(soucis).toHaveLength(1);
    expect(soucis[0]?.variable).toBe('name');
    expect(soucis[0]?.kind).toBe('unknown');
  });

  it('laisse passer une accolade qui ne prétend pas être une variable', () => {
    expect(validateTemplateVariables('le tarif est de {50} euros', 'signal')).toEqual([]);
    expect(validateTemplateVariables('accolade {avec des mots} ici', 'signal')).toEqual([]);
  });

  it('propose la variable la plus proche quand le nom est presque bon', () => {
    const soucis = validateTemplateVariables('Bonjour {{prenoms}},', 'signal');
    expect(soucis[0]?.suggestion).toBe('prenom');
  });
});

describe('le vocabulaire du socle v1 est traduit', () => {
  it('convertit les noms hérités vers leurs équivalents', () => {
    // Les modèles importés parlent encore anglais : la migration des données
    // legacy a recopié les corps tels quels. Ce n'est pas une invention de
    // l'opérateur, ces noms étaient ceux de Jay Reach avant la refonte.
    expect(normalizeVariableSyntax('Bonjour {first_name} chez {company}')).toBe(
      'Bonjour {{prenom}} chez {{entreprise}}',
    );
    expect(normalizeVariableSyntax('{{company_name}} recrute un {{job_title}}')).toBe(
      '{{entreprise}} recrute un {{poste}}',
    );
  });

  it('accepte salutation, qui existait en v1 et manquait ici', () => {
    // `prenom` interdit toute valeur de repli, pour ne jamais expédier
    // « Bonjour , ». `salutation` porte le cas du prénom inconnu.
    expect(validateTemplateVariables('{salutation}\n\nVotre annonce…', 'signal')).toEqual([]);
    expect(normalizeVariableSyntax('{salutation}')).toBe('{{salutation}}');
  });

  it('laisse signature en erreur tant qu’aucun extrait ne porte ce nom', () => {
    // Sa valeur ne dépend pas du prospect : c'est un extrait de l'organisation,
    // pas une variable. Sans extrait défini, le nom reste inconnu.
    const soucis = validateTemplateVariables('Cordialement,\n{{signature}}', 'signal');
    expect(soucis).toHaveLength(1);
    expect(soucis[0]?.variable).toBe('signature');
  });

  it('accepte un extrait déclaré par l’organisation', () => {
    expect(validateTemplateVariables('Cordialement,\n{{signature}}', 'signal', ['signature'])).toEqual([]);
  });
});
