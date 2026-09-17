import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildMessageValues, type DueRow } from './message-values.js';

const ORG_ID = 'org-1';
const CAMPAIGN_ID = 'campagne-1';

/** Ligne de `REQUETE_LIGNE_INSCRIPTION`, avec des défauts neutres. */
function ligne(overrides: Partial<DueRow> = {}): DueRow {
  return {
    id: 'enrollment-1',
    organization_id: ORG_ID,
    campaign_id: CAMPAIGN_ID,
    contact_id: 'contact-1',
    signal_id: null,
    current_step: 1,
    linkedin_url: null,
    email: 'contact@exemple.fr',
    email_status: 'valid',
    account_id: null,
    persona_id: null,
    approval_policy: {},
    sending_paused_at: null,
    lk_mode: null,
    first_name: 'Marie',
    last_name: 'Durand',
    company_name: 'Acme',
    domain: 'acme.fr',
    locale: null,
    job_title: 'Directrice',
    city: 'Lyon',
    headcount: 20,
    persona_angle: null,
    signal_title: null,
    signal_occurred_at: null,
    signal_location: null,
    signal_url: null,
    postal_code: '69000',
    country: 'FR',
    context_note: null,
    raw_row: null,
    ...overrides,
  };
}

describe('buildMessageValues — colonnes du CSV importé (liste_*)', () => {
  it('ajoute liste_<colonne normalisée> pour chaque clé non vide de raw_row', () => {
    const values = buildMessageValues(
      ligne({ raw_row: { 'Intitulé Poste': 'Commercial terrain', vide: '', nb: 3 } }),
    );
    expect(values.liste_intitule_poste).toBe('Commercial terrain');
    expect(values.liste_nb).toBe('3');
    expect(values.liste_vide).toBeUndefined();
  });

  it('ignore une valeur nulle ou faite uniquement d’espaces', () => {
    const values = buildMessageValues(ligne({ raw_row: { blanc: '   ', nulle: null } }));
    expect(values.liste_blanc).toBeUndefined();
    expect(values.liste_nulle).toBeUndefined();
  });

  it('ne pose aucune clé liste_ quand raw_row est nul (pas de repli sur une autre liste)', () => {
    const values = buildMessageValues(ligne({ raw_row: null }));
    expect(Object.keys(values).some((k) => k.startsWith('liste_'))).toBe(false);
  });

  it('ignore une colonne qui normalise vers une clé vide', () => {
    const values = buildMessageValues(ligne({ raw_row: { '???': 'valeur', poste: 'CTO' } }));
    expect(values.liste_poste).toBe('CTO');
    expect(Object.keys(values)).not.toContain('liste_');
  });

  it('coupe les espaces de tête et de queue de la valeur', () => {
    const values = buildMessageValues(ligne({ raw_row: { ville: '  Nantes  ' } }));
    expect(values.liste_ville).toBe('Nantes');
  });
});

describe('buildMessageValues — colonnes homonymes après normalisation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('valeurs différentes : la variable reste absente (manquante → bloque l’envoi) et un avertissement est journalisé', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const values = buildMessageValues(ligne({ raw_row: { Poste: 'Commercial', POSTE: 'Directeur' } }));
    expect(values.liste_poste).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('liste_poste'));
    expect(warn.mock.calls[0]?.[0]).not.toContain('Commercial');
    expect(warn.mock.calls[0]?.[0]).not.toContain('Directeur');
  });

  it('valeurs identiques : une seule variable posée, aucun avertissement', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const values = buildMessageValues(ligne({ raw_row: { Ville: 'Nantes', VILLE: 'Nantes' } }));
    expect(values.liste_ville).toBe('Nantes');
    expect(warn).not.toHaveBeenCalled();
  });

  it('une seule des deux clés homonymes porte une valeur : pas une collision, la valeur est posée', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const values = buildMessageValues(ligne({ raw_row: { Poste: 'Commercial', POSTE: '' } }));
    expect(values.liste_poste).toBe('Commercial');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('buildMessageValues — types de valeur non exploitables (Mineur 5)', () => {
  it('ignore un objet ou un tableau plutôt que de poser "[object Object]"', () => {
    const values = buildMessageValues(
      ligne({ raw_row: { meta: { a: 1 }, tags: ['a', 'b'], poste: 'CTO' } }),
    );
    expect(values.liste_meta).toBeUndefined();
    expect(values.liste_tags).toBeUndefined();
    expect(values.liste_poste).toBe('CTO');
  });

  it('accepte number et boolean, convertis en texte', () => {
    const values = buildMessageValues(ligne({ raw_row: { nb: 3, actif: true } }));
    expect(values.liste_nb).toBe('3');
    expect(values.liste_actif).toBe('true');
  });
});
