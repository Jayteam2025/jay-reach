/** Détail de campagne (mockup jay-reach-mockups.html, vue Séquence). Fictif. */
import { SAMPLE_CAMPAIGNS } from './sample-campaigns';

export type Channel = 'email' | 'linkedin_invite' | 'linkedin_message' | 'letter' | 'call';
export type Sentiment = 'positive' | 'later' | 'negative';

export interface SeqStepDetail {
  readonly n: number;
  readonly channel: Channel;
  readonly title: string;
  readonly subject?: string;
  readonly preview: string;
  readonly body: string;
  /** Délai (en jours) depuis l'étape précédente. */
  readonly delayDays: number;
  /** Condition de déclenchement (branchement en lime), si l'étape en dépend. */
  readonly condition?: string;
  readonly variables: readonly string[];
  readonly maxLength?: number;
  /** Courrier = approbation humaine obligatoire. */
  readonly validation?: boolean;
  /** Détail d'approbation (affiché dans la modale), ex. courrier. */
  readonly approvalNote?: string;
  /** Étape d'appel : numéro révélable via FullEnrich (démo). */
  readonly phone?: string;
  /** Entonnoir : éligibles à cette étape sur le vivier contacté. */
  readonly eligible: number;
  readonly sent: number;
  readonly opened?: number;
  readonly replied: number;
}

export interface ReplyItem {
  readonly name: string;
  readonly company: string;
  readonly step: number;
  readonly when: string;
  readonly excerpt: string;
  readonly sentiment: Sentiment;
}

export interface CampaignDetail {
  readonly id: string;
  readonly name: string;
  readonly status: 'active' | 'paused' | 'draft';
  readonly total: number;
  readonly contacted: number;
  readonly sent: number;
  readonly replies: number;
  readonly positives: number;
  readonly acceptanceRate: number;
  readonly replyRate: number;
  readonly createdDaysAgo: number;
  readonly nextSendIn: string;
  readonly cadencePerDay: number;
  /** Règle de qualification (tags affichés en tête de séquence). */
  readonly qualif: readonly string[];
  readonly steps: readonly SeqStepDetail[];
  readonly repliedContacts: readonly ReplyItem[];
  readonly avatarOverflow: number;
}

export function campaignId(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Séquence type du mockup : email → invitation → message LinkedIn → courrier
// manuscrit (validation) → email de clôture → appel. Le message LinkedIn dépend
// de l'acceptation de l'invitation → gros décrochage (docs/09).
function buildSteps(contacted: number, replies: number): SeqStepDetail[] {
  const s1 = contacted;
  const s2 = Math.round(contacted * 0.96);
  const accepted = Math.round(s2 * 0.28); // acceptation LinkedIn
  const letters = Math.max(2, Math.round(accepted * 0.12));
  const close = Math.round(s1 * 0.7);
  const calls = Math.round(accepted * 0.7);
  return [
    {
      n: 1,
      channel: 'email',
      title: 'Email d’ouverture',
      subject: 'Votre recrutement d’un commercial itinérant',
      preview: '« Bonjour {{prenom}}, vous avez publié le {{signal_date}} une offre pour un commercial… »',
      body:
        'Bonjour {{prenom}},\n\nVous avez publié le {{signal_date}} une offre pour un commercial itinérant — souvent le signe d’une phase de croissance.\n\nUne seule question : cherchez-vous surtout à accélérer la prise de rendez-vous, ou à structurer le suivi ?\n\nBien à vous,\nÉlise',
      delayDays: 0,
      condition: 'Immédiat à l’entrée dans la campagne · envoi automatique',
      variables: ['prenom', 'signal_date'],
      maxLength: 90,
      eligible: s1,
      sent: s1,
      opened: Math.round(s1 * 0.52),
      replied: Math.round(replies * 0.45),
    },
    {
      n: 2,
      channel: 'linkedin_invite',
      title: 'Invitation LinkedIn',
      preview: 'Invitation sans note',
      body: 'Invitation envoyée sans note (meilleur taux d’acceptation).',
      delayDays: 1,
      variables: [],
      maxLength: 45,
      eligible: s2,
      sent: s2,
      replied: Math.round(replies * 0.1),
    },
    {
      n: 3,
      channel: 'linkedin_message',
      title: 'Message LinkedIn',
      preview: '« Salut {{prenom}}, je t’ai vu recruter un commercial terrain sur {{signal_zone}}… »',
      body:
        'Salut {{prenom}},\n\nJe t’ai vu recruter un commercial terrain sur {{signal_zone}}. Beaucoup d’équipes dans ce cas galèrent à transformer la phase de recrutement en pipeline. Ça te parle ?',
      delayDays: 2,
      condition: 'Si l’invitation a été acceptée',
      variables: ['prenom', 'signal_zone'],
      maxLength: 500,
      eligible: accepted,
      sent: accepted,
      replied: Math.round(replies * 0.3),
    },
    {
      n: 4,
      channel: 'letter',
      title: 'Courrier manuscrit',
      preview: '« {{prenom}}, vous recrutiez un commercial itinérant en {{signal_mois}}… » · 4,80 € pièce',
      body:
        '{{prenom}},\n\nVous recrutiez un commercial itinérant en {{signal_mois}}. Un mot manuscrit pour vous proposer un échange court — sans engagement.\n\nÉlise',
      delayDays: 4,
      condition: 'Si aucune réponse aux étapes 1 à 3',
      approvalNote: 'Validation humaine obligatoire · expédition 3 jours avant la date visée · 4,80 € pièce',
      variables: ['prenom', 'signal_mois'],
      validation: true,
      eligible: letters,
      sent: letters,
      replied: Math.round(replies * 0.1),
    },
    {
      n: 5,
      channel: 'email',
      title: 'Email de clôture',
      subject: 'Je clos le sujet de mon côté',
      preview: '« {{prenom}}, je clos le sujet de mon côté — dites-moi si le timing revient. »',
      body:
        '{{prenom}},\n\nJe clos le sujet de mon côté — dites-moi si le timing revient, je serai ravie de reprendre.\n\nÉlise',
      delayDays: 5,
      condition: 'Si aucune réponse aux étapes précédentes',
      variables: ['prenom'],
      maxLength: 60,
      eligible: close,
      sent: 0,
      replied: Math.round(replies * 0.05),
    },
    {
      n: 6,
      channel: 'call',
      title: 'Appel de relance',
      preview: 'Script : rappeler le signal + proposer deux créneaux.',
      body:
        'Objectif : rappeler le signal (recrutement commercial), vérifier l’intérêt, proposer 2 créneaux.\n\nSi répondeur : SMS de suivi avec le lien de prise de RDV.',
      delayDays: 3,
      condition: 'Si aucune réponse',
      variables: [],
      phone: '+33 6 12 34 56 78',
      eligible: calls,
      sent: Math.round(calls * 0.6),
      replied: 0,
    },
  ];
}

const REPLIES: readonly ReplyItem[] = [
  { name: 'Sylvain Mercier', company: 'Groupe Vantel', step: 3, when: 'il y a 2 h', excerpt: 'Intéressant, on peut caler un créneau ?', sentiment: 'positive' },
  { name: 'Nadia Berthier', company: 'Ordelis', step: 1, when: 'hier', excerpt: 'Pas maintenant, relancez-moi en septembre.', sentiment: 'later' },
  { name: 'Karim Delaunay', company: 'Cerbat Industries', step: 3, when: 'hier', excerpt: 'Oui, envoyez-moi vos disponibilités.', sentiment: 'positive' },
];

export function getCampaignDetail(id: string): CampaignDetail | null {
  const base = SAMPLE_CAMPAIGNS.find((c) => campaignId(c.name) === id);
  if (!base) {
    return null;
  }
  return {
    id,
    name: base.name,
    status: base.status,
    total: base.total,
    contacted: base.contacted,
    sent: base.sent,
    replies: base.replies,
    positives: base.positives,
    acceptanceRate: base.acceptanceRate,
    replyRate: base.replyRate,
    createdDaysAgo: 22,
    nextSendIn: '3 h',
    cadencePerDay: 18,
    qualif: ['SIGNAL = OFFRE D’EMPLOI', 'SCORE ≥ 60', 'PERSONA = DRH', '50–500 SALARIÉS'],
    steps: buildSteps(base.contacted, base.replies),
    repliedContacts: REPLIES,
    avatarOverflow: 18,
  };
}
