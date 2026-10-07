/**
 * Libellé du motif de pause d'une inscription (tâche 29, lot 2, R93) —
 * fonction pure (même esprit que `etape-contact.tsx`) : les écrans (`TableContacts`,
 * `SectionOuEnEstOn`) passent leur propre `t`, déjà scopé sur
 * `campagne.contacts.pause`, et le nom des clés reste relatif à ce sous-espace.
 *
 * Quatre motifs reconnus (posés par le worker, `apps/worker/src/handlers/sequence.ts`
 * et `email-salesblink.ts`, ou par la Réception sur une réponse d'absence) —
 * un cinquième, générique, couvre tout code non reconnu : jamais un chemin brut
 * (`campagne.contacts.pause.xxx`) affiché à l'opérateur, jamais un motif technique
 * caché non plus (le code brut reste visible en `title`, pour qui veut creuser).
 *
 * La date de reprise (« Absent, reprise le {date} ») prend `fuseau` (celui de
 * l'organisation) depuis le correctif du 18/09 — avant, sans `timeZone`, elle
 * suivait le fuseau du PROCESS qui exécute le rendu (`Europe/Paris` sur le Mac
 * d'un développeur, `UTC` sur Vercel), juste au-dessus de la ligne « Prochain
 * message » que `libelleProchainMessage` formate déjà correctement : deux
 * dates voisines, l'une juste et l'autre fausse selon le fuseau réglé.
 */

export interface LibelleMotifPause {
  readonly texte: string;
  /** Code brut du motif, à afficher en `title` HTML — seulement pour le repli générique. */
  readonly title: string | null;
}

/** `t` déjà scopé sur `campagne.contacts.pause` : `t('emailGate')`, `t('absence', { date })`, etc. */
type Traducteur = (cle: string, valeurs?: Record<string, string | number>) => string;

export function libelleMotifPause(
  motif: string,
  repriseLe: string | null,
  t: Traducteur,
  fuseau: string,
  locale = 'fr-FR',
): LibelleMotifPause {
  if (motif.startsWith('email_gate:')) return { texte: t('emailGate'), title: null };
  if (motif === 'salesblink_client_error') return { texte: t('salesblinkError'), title: null };
  if (motif.startsWith('sender_unavailable:')) return { texte: t('senderUnavailable'), title: null };
  if (motif === 'absence') {
    if (!repriseLe) return { texte: t('absenceNoDate'), title: null };
    const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: fuseau }).format(new Date(repriseLe));
    return { texte: t('absence', { date }), title: null };
  }
  if (motif.startsWith('linkedin_refus:')) {
    return { texte: t(cleRefusLinkedIn(motif.slice('linkedin_refus:'.length))), title: motif };
  }
  return { texte: t('generic'), title: motif };
}

/**
 * Les huit codes de refus LinkedIn regroupés par CE QUE L'OPÉRATEUR DOIT FAIRE, pas par ce que
 * l'API a répondu : retirer une note, corriger une adresse de profil, vérifier sur LinkedIn, ou
 * ne rien faire parce que la personne n'a pas accepté l'invitation. Un libellé par code dirait
 * huit fois la même chose à qui n'a rien à faire, et noierait le seul qui appelle un geste.
 *
 * Le code brut reste en `title` : qui veut creuser le trouve, personne ne le lit par accident.
 */
function cleRefusLinkedIn(code: string): string {
  switch (code) {
    // Le seul qui se corrige en deux clics, et le plus fréquent : toute invitation qui porte une note.
    case 'note_non_supportee':
      return 'linkedinNote';
    // Pas une panne : la personne n'a pas (encore) accepté, un message ne peut pas l'atteindre.
    case 'cannot_message':
      return 'linkedinPasRelation';
    case 'profile_not_found':
    case 'invalid_url':
      return 'linkedinProfil';
    case 'already_invited':
      return 'linkedinDejaInvite';
    // L'action est peut-être partie : c'est le seul cas où il faut aller voir sur LinkedIn.
    case 'resultat_indetermine':
      return 'linkedinIndetermine';
    default:
      return 'linkedinRefus';
  }
}

/**
 * Libellé de la date du prochain message d'une inscription active (F11, suite de la reprise
 * d'absence) — même format que la date de reprise ci-dessus (jour numérique + mois en toutes
 * lettres), dans `fuseau` (celui de l'organisation, jamais celui du process qui exécute le
 * rendu — mêmes raisons que `apps/web/lib/dates.ts`). `null` sans échéance connue : l'appelant
 * (`FicheSequence.prochainMessageLe`/`ContactCampagne.prochainMessageLe`, tous deux déjà `null`
 * hors inscription `active`) n'affiche alors rien, jamais un texte vide.
 */
export function libelleProchainMessage(
  prochainMessageLe: string | null,
  t: Traducteur,
  fuseau: string,
  locale = 'fr-FR',
): string | null {
  if (!prochainMessageLe) return null;
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: fuseau }).format(
    new Date(prochainMessageLe),
  );
  return t('nextMessage', { date });
}
