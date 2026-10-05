import { describe, it, expect } from 'vitest';
import { classifyByRules, classifyByHeaders, classifyReply } from './classify.js';

/** Message reçu le 17/09/2026 — date des deux cas réels du 18/09. */
const RECU_17_09 = new Date('2026-09-17T09:00:00Z');

describe('classification des réponses', () => {
  it('détecte une absence (FR/EN/NL)', () => {
    expect(classifyByRules('Je suis absent jusqu’au 26 août.', RECU_17_09)?.classification).toBe('auto_absence');
    expect(classifyByRules('I am out of office until Monday.', RECU_17_09)?.classification).toBe('auto_absence');
    expect(classifyByRules('Ik ben afwezig deze week.', RECU_17_09)?.classification).toBe('auto_absence');
  });

  it('détecte un départ d’entreprise', () => {
    expect(classifyByRules('Je ne suis plus en poste dans cette entreprise.', RECU_17_09)?.classification).toBe('auto_left_company');
    expect(classifyByRules('I no longer work at Acme.', RECU_17_09)?.classification).toBe('auto_left_company');
    expect(classifyByRules('Ik ben niet meer bij dit bedrijf.', RECU_17_09)?.classification).toBe('auto_left_company');
  });

  it('le départ prime sur l’absence', () => {
    expect(classifyByRules('Je ne suis plus en poste, je serai absent.', RECU_17_09)?.classification).toBe('auto_left_company');
  });

  it('renvoie null sur une vraie réponse humaine (→ modèle)', () => {
    expect(classifyByRules('Intéressant, on peut en parler jeudi ?', RECU_17_09)).toBeNull();
  });

  it('en-têtes auto-reply → absence', () => {
    expect(classifyByHeaders({ 'auto-submitted': 'auto-replied' })?.classification).toBe('auto_absence');
    expect(classifyByHeaders({ 'x-autoreply': 'yes' })?.classification).toBe('auto_absence');
    expect(classifyByHeaders(null)).toBeNull();
  });

  it('un message d’absence sans date se replie sur 7 jours', () => {
    expect(classifyByRules('Je suis en congés.', RECU_17_09)).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
  });

  describe('cas réels du 18/09 — campagne « Jay coach - RH »', () => {
    it('Mathilde Dubreu : a quitté Pluxee, l’en-tête auto-replied ne doit pas masquer le corps', () => {
      const corps =
        'Dear sender, Thank you for your email. I am no longer with Pluxee and will therefore not be able to ' +
        'respond to your message. For any questions or requests, please contact Ludmila Aoudia at ' +
        'ludmila.aoudia@pluxeegroup.com…';
      const resultat = classifyReply(corps, { 'auto-submitted': 'auto-replied' }, RECU_17_09);

      expect(resultat).toEqual({ classification: 'auto_left_company' });
    });

    it('Maxime Colas-Boudot : absence jusqu’au 23/09, reprise posée au 24/09 pour un message reçu le 17/09', () => {
      const corps =
        'I am out of office from today until Wednesday, September 23, with no access to my emails. ' +
        'I will reply upon my return.';
      const resultat = classifyReply(corps, { 'auto-submitted': 'auto-replied' }, RECU_17_09);

      // Reçu le 17/09, absent jusqu'au 23/09 → reprise le lendemain, le 24/09 (7 jours).
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });
  });

  describe('date de reprise lue dans le corps', () => {
    it('FR — « de retour le 23 septembre »', () => {
      const resultat = classifyByRules('Je suis absent, de retour le 23 septembre.', RECU_17_09);
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });

    it('FR — « jusqu’au 23/09 » (numérique)', () => {
      const resultat = classifyByRules('Je suis en congés jusqu’au 23/09.', RECU_17_09);
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });

    it('EN — « until Wednesday, September 23 »', () => {
      const resultat = classifyByRules('I am out of office until Wednesday, September 23.', RECU_17_09);
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });

    it('EN — « until 23 September » (jour puis mois)', () => {
      const resultat = classifyByRules('I am on vacation until 23 September.', RECU_17_09);
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });

    it('NL — « terug op 23 september »', () => {
      const resultat = classifyByRules('Ik ben afwezig, terug op 23 september.', RECU_17_09);
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });

    it('NL — « tot en met 23 september »', () => {
      const resultat = classifyByRules('Ik ben met verlof tot en met 23 september.', RECU_17_09);
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });

    it('date sans année en fin d’année : reçu le 28/12, retour le 5 janvier → année suivante', () => {
      const recu28Decembre = new Date('2026-12-28T10:00:00Z');
      const resultat = classifyByRules('Je suis absent, de retour le 5 janvier.', recu28Decembre);
      // 28/12 → 05/01 (année suivante) = 8 jours, reprise au lendemain = 9 jours.
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 9 });
    });

    it('date passée (année explicite antérieure à la référence) → repli à 7 jours', () => {
      const resultat = classifyByRules('Je suis en congés jusqu’au 10/09/2020.', RECU_17_09);
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });

    it('date à plus de 90 jours (année explicite lointaine) → repli à 7 jours', () => {
      const resultat = classifyByRules('Je suis en congés, de retour le 15 janvier 2027.', RECU_17_09);
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });

    it('discrimine vraiment la date lue : reçu le 17/09, retour le 6 octobre → 20 jours (pas le défaut)', () => {
      const resultat = classifyByRules('Je suis absent, de retour le 6 octobre.', RECU_17_09);
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 20 });
    });
  });

  describe('faux positifs évités (relecture du 18/09) — une date ne se lit qu’au voisinage d’un marqueur de retour', () => {
    it('horaires de bureau NL (« 10.12 - 18.00 ») ne sont pas lus comme une date', () => {
      const corps = 'Ik ben afwezig.\r\nKantooruren 10.12 - 18.00\r\nGroeten';
      const resultat = classifyReply(corps, { 'auto-submitted': 'auto-replied' }, RECU_17_09);

      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });

    it('numéro de téléphone en signature (« 01.12.34.56.78 ») n’est pas lu comme une date', () => {
      const corps = "Je suis absent jusqu'a nouvel ordre. Tel : 01.12.34.56.78";
      const resultat = classifyReply(corps, { 'auto-submitted': 'auto-replied' }, RECU_17_09);

      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });
  });

  describe('repli en-têtes : la date de reprise du corps garde la priorité sur le défaut de 7 jours', () => {
    it('« away until October 6 » n’est pas couvert par ABSENCE, mais l’en-tête auto-reply + la date du corps donnent 20 jours', () => {
      const resultat = classifyReply('I am away until October 6.', { 'auto-submitted': 'auto-replied' }, RECU_17_09);

      // ABSENCE ne reconnaît pas « away until » (seulement « away from the/my office/desk ») :
      // classifyByRules rend null, mais le repli en-têtes doit tout de même lire la date.
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 20 });
    });

    it('corps muet (ni motif d’absence, ni date) + en-tête auto-reply → repli à 7 jours (non-régression)', () => {
      const resultat = classifyReply('Merci, transmis à mon assistante.', { 'auto-submitted': 'auto-replied' }, RECU_17_09);
      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });

    it('corps sans motif d’absence dont la seule date ressemble à un horaire (« 10.12 - 18.00 ») + en-tête auto-reply → 7 jours', () => {
      const corps = 'Kantooruren 10.12 - 18.00.\r\nGroeten';
      const resultat = classifyReply(corps, { 'auto-submitted': 'auto-replied' }, RECU_17_09);

      expect(resultat).toEqual({ classification: 'auto_absence', resumeInDays: 7 });
    });
  });

  describe('combine le corps puis les en-têtes (repli seulement si le corps est muet)', () => {
    it('corps muet, en-tête auto-reply → absence 7 jours (non-régression)', () => {
      expect(classifyReply('Merci, transmis à mon assistante.', { 'auto-submitted': 'auto-generated' }, RECU_17_09)?.classification).toBe(
        'auto_absence',
      );
    });

    it('corps qui parle d’absence, sans en-tête → absence', () => {
      expect(classifyReply('Je suis en congés', null, RECU_17_09)?.classification).toBe('auto_absence');
    });

    it('ni le corps ni l’en-tête ne disent rien → null (→ modèle, human_reply par défaut)', () => {
      expect(classifyReply('Bonjour, oui avec plaisir', null, RECU_17_09)).toBeNull();
    });

    it('le corps décide même quand l’en-tête dit « automatique » (défaut 1, régression du 18/09)', () => {
      const resultat = classifyReply('Je ne suis plus en poste dans cette entreprise.', { 'auto-submitted': 'auto-replied' }, RECU_17_09);
      expect(resultat).toEqual({ classification: 'auto_left_company' });
    });
  });
});
