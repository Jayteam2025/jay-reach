/**
 * Assistant de création de campagne (tâche 14, écran « Nouvelle campagne » en
 * quatre étapes : Qui, Sources, Séquence, Envoi). Spec « une fonction, deux
 * façades » : l'écran (`apps/web/app/actions/nouvelle-campagne.ts`) et le
 * futur serveur MCP appelleront `creerCampagneComplete` avec le même
 * `Contexte` — l'assistant lui-même ne fait QUE composer les fonctions déjà
 * posées (`creerCampagne`, `creerSource`, `enregistrerEtape`,
 * `modifierReglagesCampagne`, `lancer`), jamais de SQL direct.
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider } from './contexte.js';
import { dansUneTransaction } from '../transaction.js';
import { creerCampagne, modifierReglagesCampagne, lancer } from './campagnes.js';
import { creerSource, TYPES_VEILLE } from './sources.js';
import { enregistrerEtape } from './sequence.js';

const schemaSourceAssistant = z.object({
  providerId: z.enum(TYPES_VEILLE),
  nom: z.string().trim().min(1).max(120),
  config: z.record(z.unknown()),
  /** Absent → défaut de `creerSource` (« every 6h »). */
  schedule: z.string().min(1).optional(),
});

const schemaEtapeAssistant = z
  .object({
    /** `linkedin` est la forme héritée des écrans d'avant l'ouverture de l'invitation : elle vaut « message ». */
    canal: z.enum(['email', 'linkedin', 'linkedin_invite', 'linkedin_message']).default('email'),
    sujet: z.string().max(200).optional(),
    /** Vide pour une invitation, qui part sans note — exigé partout ailleurs, voir `superRefine`. */
    corps: z.string().default(''),
    delaiHeures: z.number().int().min(0),
  })
  .superRefine((v, ctx) => {
    if (v.canal === 'email' && !v.sujet?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sujet'], message: 'Un email a besoin d’un objet.' });
    }
    // Même règle que `schemaEnregistrerEtape` : une note d'invitation ne serait pas transmise,
    // donc on la refuse à la saisie plutôt que de l'écrire pour la jeter au départ.
    if (v.canal === 'linkedin_invite' && v.corps.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['corps'],
        message: 'Une invitation part sans note : l’envoi serveur ne sait pas encore en transmettre une.',
      });
    }
    if (v.canal !== 'linkedin_invite' && !v.corps.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['corps'], message: 'Le message ne peut pas être vide.' });
    }
  });

export const schemaCreerCampagneComplete = z.object({
  nom: z.string().trim().min(1, 'Nom requis.').max(120),
  /** Persona(s) ciblé(s) — `entry_rules.personas`, fixé à la création (pas dans les réglages, tour de correction possible plus tard si l'écran l'exige). */
  personaIds: z.array(z.string().uuid()).max(50).default([]),
  minScore: z.number().int().min(0).max(100),
  dailyCap: z.number().int().min(1).max(10_000),
  /** Créées via `creerSource` APRÈS la campagne (elle doit déjà exister) — R43 : seuls les types de veille, jamais csv/list/directory ici. */
  sources: z.array(schemaSourceAssistant).max(20).default([]),
  etapes: z.array(schemaEtapeAssistant).min(1, 'La séquence a besoin d’au moins une étape.').max(20),
  relecturePremiersEnvois: z.number().int().min(0).optional(),
  /** Absent/vide → tout le pool de l'organisation (même défaut que `modifierReglagesCampagne`). */
  boiteIds: z.array(z.string().uuid()).max(50).optional(),
  /** `true` = « Créer et lancer » ; `false` = « Enregistrer en brouillon ». */
  lancer: z.boolean().default(false),
});

export interface ResultatCreerCampagneComplete {
  readonly campagneId: string;
  readonly lancee: boolean;
  /** Non vide seulement si `lancer: true` a été demandé et refusé (campagne restée en brouillon). */
  readonly manques: string[];
}

/**
 * Écrit la campagne complète dans UNE transaction (campagne brouillon →
 * sources → étapes → réglages), tout ou rien : la moindre erreur — variable
 * de message inconnue, config de source invalide, etc. — annule tout, aucune
 * campagne à moitié écrite. Exige `admin` en tête (même seuil
 * qu'`enregistrerEtape`, la plus stricte des fonctions composées ici) pour
 * échouer avant la moindre écriture plutôt qu'au milieu de la transaction.
 *
 * `lancer` (si demandé) tourne APRÈS la transaction validée, avec le
 * `Contexte` d'ORIGINE (pas celui, sur le client loué, de la transaction déjà
 * refermée) : un lancement refusé (boîte manquante, etc.) laisse la campagne
 * EN BROUILLON, ses manques renvoyés à l'appelant — jamais une exception, et
 * jamais une écriture partielle puisque la campagne elle-même est déjà
 * validée en base à ce stade.
 */
export async function creerCampagneComplete(ctx: Contexte, entree: unknown): Promise<ResultatCreerCampagneComplete> {
  exiger(ctx, 'admin');
  const e = valider(schemaCreerCampagneComplete, entree);

  const campagneId = await dansUneTransaction(ctx.ex, async (tx) => {
    const ctxTx: Contexte = { ...ctx, ex: tx };

    const { id } = await creerCampagne(ctxTx, { name: e.nom, personaIds: e.personaIds });

    for (const source of e.sources) {
      await creerSource(ctxTx, {
        campagneId: id,
        providerId: source.providerId,
        nom: source.nom,
        config: source.config,
        ...(source.schedule ? { schedule: source.schedule } : {}),
      });
    }

    // Ordre d'insertion = ordre de la séquence : `position` explicite (1-based,
    // `schemaEnregistrerEtape`), pour ne pas dépendre de l'ordre d'exécution
    // des requêtes précédentes sur le client loué.
    for (const [index, etape] of e.etapes.entries()) {
      await enregistrerEtape(ctxTx, {
        campagneId: id,
        canal: etape.canal,
        ...(etape.sujet !== undefined ? { sujet: etape.sujet } : {}),
        corps: etape.corps,
        delaiHeures: etape.delaiHeures,
        position: index + 1,
      });
    }

    await modifierReglagesCampagne(ctxTx, {
      campagneId: id,
      minScore: e.minScore,
      dailyCap: e.dailyCap,
      ...(e.relecturePremiersEnvois !== undefined ? { relecturePremiersEnvois: e.relecturePremiersEnvois } : {}),
      ...(e.boiteIds !== undefined ? { boiteIds: e.boiteIds } : {}),
    });

    return id;
  });

  if (!e.lancer) {
    return { campagneId, lancee: false, manques: [] };
  }
  const resultat = await lancer(ctx, { campagneId });
  if (resultat.ok) {
    return { campagneId, lancee: true, manques: [] };
  }
  return { campagneId, lancee: false, manques: resultat.manques };
}
