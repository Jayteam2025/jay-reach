import { describe, it, expect } from 'vitest';
import { classifyByRules, classifyByHeaders, classifyReply } from './classify.js';

describe('classification des réponses', () => {
  it('détecte une absence (FR/EN/NL)', () => {
    expect(classifyByRules('Je suis absent jusqu’au 26 août.')?.classification).toBe('auto_absence');
    expect(classifyByRules('I am out of office until Monday.')?.classification).toBe('auto_absence');
    expect(classifyByRules('Ik ben afwezig deze week.')?.classification).toBe('auto_absence');
  });

  it('détecte un départ d’entreprise', () => {
    expect(classifyByRules('Je ne suis plus en poste dans cette entreprise.')?.classification).toBe('auto_left_company');
    expect(classifyByRules('I no longer work at Acme.')?.classification).toBe('auto_left_company');
    expect(classifyByRules('Ik ben niet meer bij dit bedrijf.')?.classification).toBe('auto_left_company');
  });

  it('le départ prime sur l’absence', () => {
    expect(classifyByRules('Je ne suis plus en poste, je serai absent.')?.classification).toBe('auto_left_company');
  });

  it('renvoie null sur une vraie réponse humaine (→ modèle)', () => {
    expect(classifyByRules('Intéressant, on peut en parler jeudi ?')).toBeNull();
  });

  it('en-têtes auto-reply → absence', () => {
    expect(classifyByHeaders({ 'auto-submitted': 'auto-replied' })?.classification).toBe('auto_absence');
    expect(classifyByHeaders({ 'x-autoreply': 'yes' })?.classification).toBe('auto_absence');
    expect(classifyByHeaders(null)).toBeNull();
  });

  it('combine en-têtes puis règles', () => {
    expect(classifyReply('Intéressant', { 'auto-submitted': 'auto-generated' })?.classification).toBe('auto_absence');
    expect(classifyReply('Je suis en congés', null)?.classification).toBe('auto_absence');
    expect(classifyReply('Bonjour, oui avec plaisir', null)).toBeNull();
  });
});
