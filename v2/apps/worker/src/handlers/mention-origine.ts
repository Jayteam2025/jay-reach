/**
 * Mention d'origine des données (lot 4a, tâche 11) : une personne collectée sur
 * LinkedIn n'a jamais donné son adresse à l'opérateur, elle doit savoir d'où vient
 * la donnée et comment s'y opposer dès le premier EMAIL qu'elle reçoit.
 *
 * Deux conditions, toutes deux portées par la base :
 *  - c'est le premier email réellement parti pour ce contact (aucune action email
 *    `dispatched`/`delivered` avant) : une séquence qui commence par LinkedIn, ou
 *    dont la première étape a été sautée, porte quand même la mention au premier
 *    email, et jamais plus d'une fois ;
 *  - le contact est NÉ de l'engageur (signal `post_engagement` ET fiche créée après
 *    lui). Même définition que la garde de `ecarterEngageur` : une fiche importée par
 *    l'opérateur, rattachée à un engageur, n'a pas été trouvée sur LinkedIn, lui
 *    écrire que oui serait une fausse information légale.
 */
import type { Pool } from 'pg';
import fr from '../../../../packages/i18n/src/messages/fr.json';
import en from '../../../../packages/i18n/src/messages/en.json';
import nl from '../../../../packages/i18n/src/messages/nl.json';

const CATALOGUES: Readonly<Record<string, unknown>> = { fr, en, nl };

/** Une chaîne du catalogue par son chemin complet ; une clé absente lève, jamais un texte vide envoyé. */
function lire(catalogue: unknown, chemin: string): string {
  let noeud: unknown = catalogue;
  for (const part of chemin.split('.')) {
    if (typeof noeud !== 'object' || noeud === null || !(part in noeud)) throw new Error(`clé de message absente : ${chemin}`);
    noeud = (noeud as Record<string, unknown>)[part];
  }
  if (typeof noeud !== 'string' || noeud.trim() === '') throw new Error(`clé de message vide : ${chemin}`);
  return noeud;
}

/** Le texte dans la langue du contact ; le français quand elle est inconnue ou non prise en charge. */
export function mentionOrigineEngageur(locale: string | null): string {
  const langue = (locale ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return lire(CATALOGUES[langue] ?? fr, 'mentionOrigine.engageurLinkedin');
}

export interface DemandeMention {
  readonly organizationId: string;
  readonly enrollmentId: string;
  /** Langue du message déjà retenue pour le corps ; à défaut, celle du contact. */
  readonly locale: string | null;
}

/** La mention à poser en pied de ce message, ou `null` s'il n'en faut pas. */
export async function mentionOrigineDuMessage(pool: Pool, d: DemandeMention): Promise<string | null> {
  const res = await pool.query<{ premier_email: boolean; ne_de_l_engageur: boolean; locale: string | null }>(
    `select c.locale,
            (s.kind = 'post_engagement' and c.created_at >= s.occurred_at) as ne_de_l_engageur,
            not exists (
              select 1 from actions a join enrollments e2 on e2.id = a.enrollment_id
               where e2.organization_id = c.organization_id and e2.contact_id = c.id
                 and a.channel = 'email' and a.status in ('dispatched', 'delivered')
            ) as premier_email
       from enrollments en
       join contacts c on c.id = en.contact_id and c.organization_id = en.organization_id
       left join signals s on s.id = c.source_signal_id and s.organization_id = c.organization_id
      where en.id = $2 and en.organization_id = $1`,
    [d.organizationId, d.enrollmentId],
  );
  const ligne = res.rows[0];
  if (!ligne || !ligne.premier_email || ligne.ne_de_l_engageur !== true) return null;
  return mentionOrigineEngageur(d.locale ?? ligne.locale);
}
