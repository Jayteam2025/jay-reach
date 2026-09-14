/**
 * État du moteur (worker), pour la coquille et la page Aujourd'hui.
 *
 * `engine_status` (migration `20260910130000_engine_status`) est une table
 * mono-instance sans `organization_id` : une ligne par processus worker, pas
 * par organisation (modèle standalone mono-opérateur). On y lit la plus
 * récemment mise à jour, sans jamais exposer `hostname` ni `instance_id` —
 * ce dépôt est public, ces deux colonnes désignent la machine de production.
 */
import type { Contexte } from './contexte.js';
import { exiger } from './contexte.js';

/**
 * Intervalle entre deux tours de la boucle `sequence.tick` du worker.
 *
 * Source : `apps/worker/src/traitements.ts` (`TICK_INTERVAL_MS`, surchargeable
 * là-bas par la variable d'environnement du même nom, 60 000 ms par défaut).
 * Dupliquée ici en dur : `packages/core` ne lit pas l'environnement du worker,
 * et cette constante ne sert qu'à afficher un prochain passage indicatif.
 */
export const INTERVALLE_TICK_MS = 60_000;

/** Passé ce délai sans tour enregistré, le moteur est considéré arrêté. */
const SEUIL_SILENCE_MS = 15 * 60_000;

export interface EtatMoteurResume {
  enMarche: boolean;
  dernierPassage: string | null;
  prochainPassage: string | null;
  erreursDepuisMinuit: number;
  version: string | null;
  derniereErreur: string | null;
}

interface LigneEngineStatus {
  version: string | null;
  last_tick_at: string | null;
  last_error: string | null;
}

export async function lireEtatMoteur(ctx: Contexte): Promise<EtatMoteurResume> {
  exiger(ctx, 'viewer');
  const [etatRes, erreursRes] = await Promise.all([
    ctx.ex.query<LigneEngineStatus>(
      `select version, last_tick_at, last_error /* jr:engine_status */
         from engine_status
        order by updated_at desc
        limit 1`,
    ),
    ctx.ex.query<{ n: number }>(
      `select count(*)::int as n /* jr:engine_errors */
         from audit_events
        where organization_id = $1
          and entity_type = 'engine'
          and created_at >= date_trunc('day', now())`,
      [ctx.organisationId],
    ),
  ]);

  const ligne = etatRes.rows[0] ?? null;
  const dernierPassage = ligne?.last_tick_at ?? null;
  const enMarche = dernierPassage !== null && Date.now() - new Date(dernierPassage).getTime() < SEUIL_SILENCE_MS;
  const prochainPassage = dernierPassage ? new Date(new Date(dernierPassage).getTime() + INTERVALLE_TICK_MS).toISOString() : null;

  return {
    enMarche,
    dernierPassage,
    prochainPassage,
    erreursDepuisMinuit: erreursRes.rows[0]?.n ?? 0,
    version: ligne?.version ?? null,
    derniereErreur: ligne?.last_error ?? null,
  };
}
