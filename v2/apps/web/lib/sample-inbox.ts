/** Boîte de réception — données représentatives (docs/06). Fictif. */

export type Classification = 'human_reply' | 'auto_absence' | 'auto_left_company' | 'auto_other' | 'unclassified';
export type Treatment = 'todo' | 'in_progress' | 'done' | 'later';
export type InboxChannel = 'email' | 'linkedin';

export interface InboxMessage {
  readonly direction: 'in' | 'out';
  readonly when: string;
  readonly body: string;
}

export interface InboxThread {
  readonly id: string;
  readonly contactName: string;
  readonly company: string;
  readonly jobTitle: string;
  readonly channel: InboxChannel;
  readonly classification: Classification;
  readonly treatment: Treatment;
  readonly when: string;
  readonly excerpt: string;
  /** Sender lié au contact — toute réponse part par lui, jamais un autre. */
  readonly sender: string;
  /** Départ d'entreprise = signal d'achat déguisé (recrutement du successeur). */
  readonly buySignal?: boolean;
  readonly messages: readonly InboxMessage[];
}

export const SAMPLE_THREADS: readonly InboxThread[] = [
  {
    id: 'camille-rousseau',
    contactName: 'Camille Rousseau',
    company: 'Société Témoin',
    jobTitle: 'Directrice commerciale',
    channel: 'email',
    classification: 'human_reply',
    treatment: 'todo',
    when: 'il y a 2 h',
    excerpt: 'Intéressant, on peut en parler jeudi ?',
    sender: 'elise@jay-reach.io',
    messages: [
      { direction: 'out', when: 'lun. 09:12', body: 'Bonjour Camille, j’ai vu que Société Témoin recrute des commerciaux…' },
      { direction: 'in', when: 'mar. 11:48', body: 'Intéressant, on peut en parler jeudi ? Plutôt en fin de journée si possible.' },
    ],
  },
  {
    id: 'marc-delaunay',
    contactName: 'Marc Delaunay',
    company: 'Novaterre',
    jobTitle: 'Head of Sales',
    channel: 'email',
    classification: 'auto_absence',
    treatment: 'later',
    when: 'hier',
    excerpt: 'Je suis absent jusqu’au 26 août, je reviendrai vers vous.',
    sender: 'elise@jay-reach.io',
    messages: [
      { direction: 'out', when: 'jeu. 08:30', body: 'Bonjour Marc, un exemple concret pour Novaterre…' },
      { direction: 'in', when: 'jeu. 08:31', body: 'Je suis absent jusqu’au 26 août avec un accès limité à mes emails. Je reviendrai vers vous à mon retour.' },
    ],
  },
  {
    id: 'sofia-meunier',
    contactName: 'Sofia Meunier',
    company: 'Groupe Halden',
    jobTitle: 'VP Sales',
    channel: 'linkedin',
    classification: 'auto_left_company',
    treatment: 'todo',
    when: 'hier',
    excerpt: 'Je ne fais plus partie de Groupe Halden depuis juin.',
    sender: 'Élise (LinkedIn)',
    buySignal: true,
    messages: [
      { direction: 'out', when: 'mer. 14:02', body: 'Merci d’avoir accepté Sofia ! Je reviens vers vous…' },
      { direction: 'in', when: 'mer. 15:20', body: 'Bonjour, je ne fais plus partie de Groupe Halden depuis juin. Bonne continuation.' },
    ],
  },
  {
    id: 'julien-ferrand',
    contactName: 'Julien Ferrand',
    company: 'Atelier Vernier',
    jobTitle: 'Responsable ADV',
    channel: 'email',
    classification: 'human_reply',
    treatment: 'in_progress',
    when: 'il y a 3 j',
    excerpt: 'Pas le bon moment, relancez-moi en septembre.',
    sender: 'elise@jay-reach.io',
    messages: [
      { direction: 'out', when: 'ven. 10:00', body: 'Bonjour Julien, est-ce un sujet chez vous en ce moment ?' },
      { direction: 'in', when: 'ven. 16:40', body: 'Pas le bon moment, relancez-moi en septembre. Merci.' },
      { direction: 'out', when: 'ven. 17:05', body: 'Noté, je reviens vers vous début septembre. Bonne fin de semaine !' },
    ],
  },
];

export const TREATMENTS: readonly Treatment[] = ['todo', 'in_progress', 'done', 'later'];
