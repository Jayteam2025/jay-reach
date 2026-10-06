/**
 * Mention d'origine des données (lot 4a, tâche 11) : une personne collectée sur
 * LinkedIn n'a jamais donné son adresse à l'opérateur, elle doit savoir d'où vient
 * la donnée et comment s'y opposer dès le premier message qu'elle reçoit.
 *
 * Elle ne s'ajoute qu'au PREMIER envoi (étape en position 0) d'un contact né d'un
 * `post_engagement` : un contact né d'un signal d'entreprise a été trouvé par
 * l'enrichissement d'une société, pas collecté comme personne.
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
  readonly stepId: string;
  readonly locale: string | null;
}

/** La mention à poser en pied de ce message, ou `null` s'il n'en faut pas. */
export async function mentionOrigineDuMessage(pool: Pool, d: DemandeMention): Promise<string | null> {
  const res = await pool.query<{ premiere_etape: boolean; kind: string | null }>(
    `select (st.position = 0) as premiere_etape, s.kind::text as kind
       from enrollments en
       join contacts c on c.id = en.contact_id and c.organization_id = en.organization_id
       join sequence_steps st on st.id = $3 and st.campaign_id = en.campaign_id
       left join signals s on s.id = c.source_signal_id and s.organization_id = c.organization_id
      where en.id = $2 and en.organization_id = $1`,
    [d.organizationId, d.enrollmentId, d.stepId],
  );
  const ligne = res.rows[0];
  if (!ligne || !ligne.premiere_etape || ligne.kind !== 'post_engagement') return null;
  return mentionOrigineEngageur(d.locale);
}
