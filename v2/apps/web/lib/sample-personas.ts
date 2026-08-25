/** Personas de démonstration (affichés quand Supabase n'est pas branché). Fictifs. */
export interface Persona {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly title_patterns: string[];
  readonly title_exclusions: string[];
  readonly seniority: string | null;
  readonly channels_priority: string[];
  readonly scoring_prompt: string | null;
  readonly is_active: boolean;
}

export const SAMPLE_PERSONAS: readonly Persona[] = [
  {
    id: 'sample-directeur-commercial',
    name: 'Directeur commercial',
    description: 'Décideur des équipes de vente, en phase de croissance ou de recrutement.',
    title_patterns: ['directeur commercial', 'head of sales', 'sales director', 'VP sales', 'directeur des ventes'],
    title_exclusions: ['stagiaire', 'assistant', 'alternant'],
    seniority: 'director',
    channels_priority: ['email', 'linkedin'],
    scoring_prompt:
      'Cible un décideur commercial dans une PME de 50 à 500 salariés qui recrute des commerciaux. Écarte les cabinets de recrutement.',
    is_active: true,
  },
  {
    id: 'sample-drh',
    name: 'DRH',
    description: 'Ressources humaines — souvent à l’origine du signal de recrutement.',
    title_patterns: ['DRH', 'responsable RH', 'head of people', 'talent acquisition', 'directeur des ressources humaines'],
    title_exclusions: ['stagiaire RH'],
    seniority: 'manager',
    channels_priority: ['email'],
    scoring_prompt: 'Cible un profil RH décisionnaire sur les embauches commerciales.',
    is_active: true,
  },
  {
    id: 'sample-dirigeant',
    name: 'Dirigeant PME',
    description: 'Fondateur ou dirigeant, décideur final sur les petites structures.',
    title_patterns: ['CEO', 'gérant', 'président', 'fondateur', 'directeur général'],
    title_exclusions: [],
    seniority: 'executive',
    channels_priority: ['email', 'linkedin', 'letter'],
    scoring_prompt: 'Cible le dirigeant quand l’entreprise fait moins de 50 salariés.',
    is_active: false,
  },
];
