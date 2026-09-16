'use server';

import { revalidatePath } from 'next/cache';

import {
  ErreurReponseImpossible,
  repondre as repondreCoeur,
  marquerTraite as marquerTraiteCoeur,
  marquerInteret as marquerInteretCoeur,
  type InteretFil,
} from '@jay-reach/core';
import { messageErreurReponse } from '../../lib/erreur-reponse';
import { resolveGraphConfig } from '../../lib/graph';
import { repondreDansLaBoite } from '@jay-reach/providers/mail';
import { resolveSalesblinkKey } from '../../lib/salesblink';
import { repondreDansLeFil } from '@jay-reach/providers/outreach';
import { contexteCourant } from '../../lib/contexte';

export type RepondreResult = { ok: true } | { ok: false; error: string };

/**
 * Envoie une réponse dans un fil de la Réception (tâche 16 ; transport choisi
 * par le lot 3 bis). Façade mince : construit le `Contexte` et les vrais
 * transports (Microsoft Graph, SalesBlink), puis délègue tout le reste —
 * validation, autorisation, choix du transport, envoi, journal — à `repondre`
 * (`@jay-reach/core`, `fonctions/reception.ts`). L'organisation vient de la
 * session, jamais d'un identifiant fourni par l'appelant.
 */
export async function repondre(threadId: string, corps: string): Promise<RepondreResult> {
  const ctx = await contexteCourant();

  try {
    await repondreCoeur(
      ctx,
      { filId: threadId, corps },
      {
        graph: async (mailbox, messageId, corpsHtml) => {
          const config = await resolveGraphConfig(ctx.organisationId);
          if (!config) {
            throw new ErreurReponseImpossible("Microsoft Graph n'est pas configuré pour cette organisation.");
          }
          await repondreDansLaBoite(config, mailbox, messageId, corpsHtml);
        },
        salesblink: async (messageId, corpsHtml) => {
          const cle = await resolveSalesblinkKey(ctx.organisationId);
          if (!cle) {
            throw new ErreurReponseImpossible("SalesBlink n'est pas configuré pour cette organisation.");
          }
          return repondreDansLeFil(messageId, corpsHtml, cle);
        },
      },
    );
  } catch (err) {
    // Une seule règle, dans `lib/erreur-reponse` : message de l'opérateur pour
    // une `ErreurReponseImpossible`/`ErreurEntree`, texte propre à Microsoft pour un refus de la boîte,
    // générique sinon. Jamais le corps de réponse d'un fournisseur.
    return { ok: false, error: messageErreurReponse(err) };
  }

  revalidatePath('/inbox');
  return { ok: true };
}

export type MarqueurResult = { ok: true } | { ok: false; error: string };

/** Marque (ou démarque, `traite: false`) un fil comme traité — le sort de la liste « À traiter ». */
export async function marquerTraite(threadId: string, traite: boolean): Promise<MarqueurResult> {
  const ctx = await contexteCourant();
  try {
    await marquerTraiteCoeur(ctx, { filId: threadId, traite });
  } catch (err) {
    return { ok: false, error: messageErreurReponse(err) };
  }
  revalidatePath('/inbox');
  return { ok: true };
}

/** Pose (ou retire, `interet: null`) le marquage d'intérêt d'un fil. */
export async function marquerInteret(threadId: string, interet: InteretFil): Promise<MarqueurResult> {
  const ctx = await contexteCourant();
  try {
    await marquerInteretCoeur(ctx, { filId: threadId, interet });
  } catch (err) {
    return { ok: false, error: messageErreurReponse(err) };
  }
  revalidatePath('/inbox');
  return { ok: true };
}
