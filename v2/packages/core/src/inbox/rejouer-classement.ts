/**
 * Rejeu du classement des réponses déjà en base, quand leur corps a fini par arriver.
 *
 * Une réponse livrée sans corps est classée sur ses seuls en-têtes, qui rendent TOUJOURS `auto_absence`
 * (`classify.ts`). `recordInboundReply` sait désormais reclasser quand le corps arrive ; ce rejeu
 * rattrape celles qui l'ont reçu avant ce correctif.
 *
 * Opération SUR COMMANDE, jamais un automatisme : elle peut exclure des contacts rétroactivement et
 * définitivement, et aucun écran ne défait une exclusion. Aucun tick, démarrage ni migration ne
 * l'appelle ; seul le CLI (`jay-reach linkedin reclasser`) le fait.
 *
 * Mode à blanc (`appliquer: false`, le défaut) : exactement le même parcours, le même compte-rendu, mais
 * rien n'est écrit. Les chiffres viennent des mêmes lectures que l'application (`apercuExclusion`
 * partage son filtre de file avec `annulerEnvoisEnFile`), pas d'une estimation à part.
 *
 * Rejouable : seuls les fils `CLASSES_RECLASSABLES` sont relus, et un fil reclassé n'en fait plus
 * partie. Un second passage ne trouve donc rien ; un contact déjà `do_not_contact` n'est pas réécrit
 * (`exclureApresReponse` est idempotente).
 */
import type { Executeur } from '../executeur.js';
import { dansUneTransaction } from '../transaction.js';
import { classifyReply } from './classify.js';
import { apercuExclusion } from './exclusion-sur-reponse.js';
import { CLASSES_RECLASSABLES, reclasserFil } from './record-reply.js';

export interface CompteRenduRejeu {
  /** Fils dont le dernier message entrant a un corps, relus. */
  readonly relus: number;
  /** Fils dont la classification change. */
  readonly reclasses: number;
  /** Contacts distincts qui passent `do_not_contact` (ceux qui l'étaient déjà ne comptent pas). */
  readonly exclus: number;
  /** Envois LinkedIn en file annulés par ces exclusions. */
  readonly envoisAnnules: number;
}

interface FilARelire {
  id: string;
  contact_id: string | null;
  classification: string;
  body: string;
  headers: Record<string, unknown> | null;
  sent_at: Date | null;
}

export async function rejouerClassement(
  ex: Executeur,
  org: string,
  options: { readonly appliquer?: boolean } = {},
): Promise<CompteRenduRejeu> {
  const appliquer = options.appliquer === true;
  // Le dernier message ENTRANT de chaque fil porte sa classification (`upsertThread`), et seuls ceux
  // qui ont un corps peuvent être relus : sans corps, le rejeu retomberait sur les en-têtes, donc sur
  // ce qui a déjà été décidé.
  const fils = await ex.query<FilARelire>(
    `select t.id, t.contact_id, t.classification::text as classification, m.body, m.headers, m.sent_at
       from threads t
       join lateral (
         select body, headers, sent_at from thread_messages
          where thread_id = t.id and direction = 'in'
          order by sent_at desc nulls last, id desc limit 1
       ) m on true
      where t.organization_id = $1 and t.classification::text = any($2::text[])
        and coalesce(btrim(m.body), '') <> ''
      order by t.created_at, t.id`,
    [org, [...CLASSES_RECLASSABLES]],
  );

  let reclasses = 0;
  let exclus = 0;
  let envoisAnnules = 0;
  const contactsVus = new Set<string>();

  for (const fil of fils.rows) {
    const cls = classifyReply(fil.body, fil.headers, fil.sent_at ?? new Date()) ?? { classification: 'human_reply' as const };
    if (cls.classification === fil.classification) continue;
    reclasses += 1;

    // Un contact qui a deux fils (deux canaux) ne s'exclut, et ses envois ne s'annulent, qu'une fois.
    if (cls.classification === 'human_reply' && fil.contact_id && !contactsVus.has(fil.contact_id)) {
      contactsVus.add(fil.contact_id);
      const apercu = await apercuExclusion(ex, org, fil.contact_id);
      if (apercu.exclu) exclus += 1;
      envoisAnnules += apercu.envoisAnnules;
    }

    if (appliquer) {
      // Un fil par transaction : un fil qui échoue ne défait pas les précédents, et l'exclusion reste
      // dans la même transaction que son reclassement.
      await dansUneTransaction(ex, (tx) =>
        reclasserFil(tx, org, { id: fil.id, contactId: fil.contact_id, classification: fil.classification }, cls),
      );
    }
  }

  return { relus: fils.rows.length, reclasses, exclus, envoisAnnules };
}
