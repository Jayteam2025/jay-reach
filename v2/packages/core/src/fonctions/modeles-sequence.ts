/**
 * Modèles de séquence proposés par l'assistant de création de campagne
 * (tâche 14, étape « Séquence »). Données PURES — aucune requête, aucun
 * `Contexte` — l'assistant les recopie telles quelles dans son état local
 * (`useState`), l'opérateur les modifie avant de créer la campagne
 * (`creerCampagneComplete` écrit le résultat via `enregistrerEtape`, jamais
 * ce fichier directement).
 *
 * Les corps sont des textes FICTIFS et neutres : aucune personne, entreprise
 * ou domaine réels. Seule la STRUCTURE de « Question puis trois relances »
 * reprend celle de la campagne « Directeur commercial » (quatre étapes,
 * délais de 2, 3 et 5 jours depuis l'étape précédente) — jamais son contenu.
 * Variables utilisées : uniquement celles disponibles quelle que soit la
 * nature de la campagne (`STANDARD_VARIABLES` « always », `messages/variables.ts`)
 * — une campagne née de l'assistant peut ne tenir à aucun thème de veille
 * (nature `list`, faute de `campaigns.source_id`), donc jamais `signal_*`.
 */

export type CanalModeleSequence = 'email';

export interface EtapeModeleSequence {
  readonly canal: CanalModeleSequence;
  /** Toujours requis : les deux modèles sont entièrement email. */
  readonly sujet: string;
  readonly corps: string;
  /** Délai depuis l'étape PRÉCÉDENTE (0 pour la première, envoyée dès l'entrée). */
  readonly delaiHeures: number;
}

export interface ModeleSequence {
  readonly cle: 'question_relances' | 'email_unique';
  readonly nom: string;
  readonly description: string;
  readonly etapes: readonly EtapeModeleSequence[];
}

const QUESTION_RELANCES: ModeleSequence = {
  cle: 'question_relances',
  nom: 'Question puis trois relances',
  description: '4 emails sur 10 jours : une question ouverte, puis trois relances jusqu’au dernier mot.',
  etapes: [
    {
      canal: 'email',
      sujet: '{{prenom}}, une question sur votre équipe',
      corps:
        'Bonjour {{prenom}},\n\n' +
        'Une question directe : quand une personne de votre équipe {{poste}} passe à côté d’un dossier, vous le découvrez comment ?\n\n' +
        'Je vous pose la question parce que c’est précisément ce que je vois chez des entreprises de taille comparable à {{entreprise}}.\n\n' +
        'Curieux d’avoir votre avis.',
      delaiHeures: 0,
    },
    {
      canal: 'email',
      sujet: 'Re : {{prenom}}, une question sur votre équipe',
      corps:
        'Je me permets de remonter mon message, {{prenom}} — je sais que les journées sont pleines.\n\n' +
        'Si le sujet n’est pas prioritaire en ce moment, dites-le-moi simplement et je ne reviendrai pas dessus.',
      delaiHeures: 48,
    },
    {
      canal: 'email',
      sujet: 'Re : {{prenom}}, une question sur votre équipe',
      corps:
        'Un dernier élément qui pourrait éclairer ma question précédente : plusieurs équipes de taille comparable à la vôtre ont gagné plusieurs heures par semaine rien qu’en changeant leur façon de suivre ce point.\n\n' +
        'Si ça vous parle, un échange de quinze minutes suffit à voir si c’est pertinent pour {{entreprise}}.',
      delaiHeures: 72,
    },
    {
      canal: 'email',
      sujet: 'Re : {{prenom}}, une question sur votre équipe',
      corps:
        'Je clos le sujet de mon côté, {{prenom}} — je ne voudrais pas encombrer votre boîte pour rien.\n\n' +
        'Si la question revient un jour, vous savez où me trouver.',
      delaiHeures: 120,
    },
  ],
};

const EMAIL_UNIQUE: ModeleSequence = {
  cle: 'email_unique',
  nom: 'Un seul email',
  description: 'Un premier email, aucune relance automatique.',
  etapes: [
    {
      canal: 'email',
      sujet: '{{prenom}}, une question rapide',
      corps:
        'Bonjour {{prenom}},\n\n' +
        'Je me permets de vous écrire au sujet de {{entreprise}} : je travaille avec des équipes {{poste}} sur exactement ce type de sujet.\n\n' +
        'Un échange de quinze minutes vous dirait quelque chose ?',
      delaiHeures: 0,
    },
  ],
};

/**
 * Deux modèles proposés par l'étape Séquence de l'assistant, dans l'ordre
 * d'affichage. Un « Vide » (aucune étape prédéfinie) est un troisième choix
 * de l'écran, pas un modèle de ce tableau.
 */
export const MODELES_SEQUENCE: readonly ModeleSequence[] = [QUESTION_RELANCES, EMAIL_UNIQUE];

export function modeleSequenceParCle(cle: string): ModeleSequence | undefined {
  return MODELES_SEQUENCE.find((m) => m.cle === cle);
}
