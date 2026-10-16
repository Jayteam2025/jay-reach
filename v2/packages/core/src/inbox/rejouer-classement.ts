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
 * rien n'est écrit, ni exclusion, ni arrêt de séquence, ni notification (le premier rejeu historique peut
 * en envoyer une rafale : le compte-rendu l'annonce). Les chiffres viennent des mêmes lectures que l'application (`apercuExclusion`
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
import { CLASSES_RECLASSABLES, LIVE_STATUSES, REPLY_STATUSES, notifyReply, reclasserFil } from './record-reply.js';

export interface CompteRenduRejeu {
  /** Fils dont le dernier message entrant a un corps, relus. */
  readonly relus: number;
  /** Fils dont la classification change. */
  readonly reclasses: number;
  /** Contacts distincts qui passent `do_not_contact` (ceux qui l'étaient déjà ne comptent pas). */
  readonly exclus: number;
  /** Envois LinkedIn en file annulés par ces exclusions. */
  readonly envoisAnnules: number;
  /** Séquences en cours qui s'arrêtent (départ : `stopped`, réponse humaine : `replied`), une par contact. */
  readonly sequencesArretees: number;
  /** Notifications envoyées à l'opérateur : une par fil qui devient réponse humaine ou départ. Zéro à blanc, mais l'annonce est la même. */
  readonly notifications: number;
  /** Fils dont le traitement a échoué (appliqué seulement) : ils ne sont dans aucun autre compteur. */
  readonly echecs: number;
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
  let sequencesArretees = 0;
  let notifications = 0;
  let echecs = 0;
  const contactsVus = new Set<string>();
  const sequencesVues = new Set<string>();

  for (const fil of fils.rows) {
    const cls = classifyReply(fil.body, fil.headers, fil.sent_at ?? new Date()) ?? { classification: 'human_reply' as const };
    if (cls.classification === fil.classification) continue;

    // Ce que ce fil ajoute au compte-rendu, calculé AVANT toute écriture et ajouté seulement quand le
    // fil a abouti : un fil qui échoue ne gonfle aucun autre compteur. Un contact qui a deux fils
    // (deux canaux) ne s'exclut, n'annule ses envois et n'arrête sa séquence qu'une fois.
    let dExclus = 0;
    let dEnvois = 0;
    let dSequences = 0;
    const dContact = fil.contact_id;
    const humaine = cls.classification === 'human_reply';
    if (dContact && humaine && !contactsVus.has(dContact)) {
      const apercu = await apercuExclusion(ex, org, dContact);
      if (apercu.exclu) dExclus = 1;
      dEnvois = apercu.envoisAnnules;
    }
    if (dContact && (humaine || cls.classification === 'auto_left_company') && !sequencesVues.has(dContact)) {
      const statuts = humaine ? REPLY_STATUSES : LIVE_STATUSES;
      const vivantes = await ex.query<{ n: number }>(
        `select count(*)::int as n from enrollments /* jr:apercu_sequences_arretees */ where organization_id = $1 and contact_id = $2 and status in ${statuts}`,
        [org, dContact],
      );
      dSequences = vivantes.rows[0]?.n ?? 0;
    }
    const dNotification = humaine || cls.classification === 'auto_left_company' ? 1 : 0;

    if (appliquer) {
      try {
        // Un fil par transaction : un fil qui échoue ne défait pas les précédents, et l'exclusion reste
        // dans la même transaction que son reclassement ET sa notification.
        await dansUneTransaction(ex, async (tx) => {
          await reclasserFil(tx, org, { id: fil.id, contactId: fil.contact_id, classification: fil.classification }, cls);
          if (dNotification) await notifyReply(tx, org, 'Réponse reclassée', fil.body.slice(0, 140));
        });
      } catch (err) {
        // Un fil empoisonné n'emporte ni les compteurs ni les fils suivants ; seul le type sort.
        echecs += 1;
        console.error(`[rejouer-classement] un fil n'a pas pu être reclassé (${err instanceof Error ? err.name : 'erreur'})`);
        continue;
      }
    }
    reclasses += 1;
    exclus += dExclus;
    envoisAnnules += dEnvois;
    sequencesArretees += dSequences;
    notifications += dNotification;
    if (dContact && humaine) contactsVus.add(dContact);
    if (dContact && dNotification) sequencesVues.add(dContact);
  }

  return { relus: fils.rows.length, reclasses, exclus, envoisAnnules, sequencesArretees, notifications, echecs };
}
