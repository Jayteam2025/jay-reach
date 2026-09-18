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
  locale = 'fr-FR',
): LibelleMotifPause {
  if (motif.startsWith('email_gate:')) return { texte: t('emailGate'), title: null };
  if (motif === 'salesblink_client_error') return { texte: t('salesblinkError'), title: null };
  if (motif.startsWith('sender_unavailable:')) return { texte: t('senderUnavailable'), title: null };
  if (motif === 'absence') {
    if (!repriseLe) return { texte: t('absenceNoDate'), title: null };
    const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(new Date(repriseLe));
    return { texte: t('absence', { date }), title: null };
  }
  return { texte: t('generic'), title: motif };
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
