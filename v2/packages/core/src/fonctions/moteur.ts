/**
 * État du moteur (worker), pour la coquille et la page Aujourd'hui.
 *
 * `engine_status` (migration `20260910130000_engine_status`) est une table
 * mono-instance sans `organization_id` : une ligne par processus worker, pas
 * par organisation (modèle standalone mono-opérateur). On y lit la plus
 * récemment mise à jour, sans jamais exposer `hostname` ni `instance_id` —
 * ce dépôt est public, ces deux colonnes désignent la machine de production.
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider } from './contexte.js';
import { ecrireEvenement } from '../journal.js';
import { normaliserIntervalleReleve } from '../reglages-salesblink.js';

/**
 * Intervalle entre deux tours de la boucle `sequence.tick` du worker.
 *
 * Source : `apps/worker/src/traitements.ts` (`TICK_INTERVAL_MS`, surchargeable
 * là-bas par la variable d'environnement du même nom, 60 000 ms par défaut).
 * Dupliquée ici en dur : `packages/core` ne lit pas l'environnement du worker,
 * et cette constante ne sert qu'à afficher un prochain passage indicatif.
 */
export const INTERVALLE_TICK_MS = 60_000;

/**
 * Intervalle du producteur périodique (scoring, enrichissement, collecte des
 * sources) — même motif que `INTERVALLE_TICK_MS` : dupliqué en dur depuis
 * `apps/worker/src/traitements.ts` (`DISCOVER_INTERVAL_MS`, surchargeable
 * là-bas par la variable d'environnement du même nom, 15 minutes par défaut).
 * Sert uniquement à composer le texte d'aide de l'écran Moteur (tour de
 * correction 1, Important n° 1 : « tourne en continu, aucun déclenchement
 * manuel possible ici ») — jamais une valeur d'exécution réelle.
 */
export const INTERVALLE_PRODUCTION_MS = 15 * 60_000;

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
      // `entity_type = 'engine'` seul ne suffit plus depuis la tâche 6 : les
      // journaux de lot (`scoring_batch`, `enrichment_batch`) portent aussi
      // cet `entity_type` (pas de source/campagne unique à rattacher) — sans
      // le filtre sur `action`, un lot de scoring réussi gonflerait ce
      // compteur d'erreurs comme s'il en était une.
      `select count(*)::int as n /* jr:engine_errors */
         from audit_events
        where organization_id = $1
          and entity_type = 'engine'
          and action = 'engine_error'
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

// ---------------------------------------------------------------------------
// Pause d'envoi globale (tâche 23)
// ---------------------------------------------------------------------------

export const schemaBasculerPauseEnvoi = z.object({ pause: z.boolean() });

/**
 * Bascule l'interrupteur d'arrêt global des envois (`organizations.sending_paused_at`,
 * migration `20260828130000_sending_kill_switch`) — lu par le worker
 * (`traitements.ts`, `handlers/message-values.ts`) avant tout envoi, et par le
 * bandeau d'Aujourd'hui (`fonctions/aujourdhui.ts`). Réservé aux admins : une
 * pause coupe tous les canaux de toutes les campagnes d'un coup.
 *
 * Idempotent et silencieux si l'état demandé est déjà en place (`rowCount = 0`) :
 * aucune ligne de journal en double pour deux clics sur un interrupteur déjà
 * dans la position visée.
 */
export async function basculerPauseEnvoi(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'admin');
  const { pause } = valider(schemaBasculerPauseEnvoi, entree);

  const res = pause
    ? await ctx.ex.query(
        `update organizations /* jr:moteur_pause_envoi */
            set sending_paused_at = now()
          where id = $1 and sending_paused_at is null`,
        [ctx.organisationId],
      )
    : await ctx.ex.query(
        `update organizations /* jr:moteur_pause_envoi */
            set sending_paused_at = null, sending_paused_reason = null
          where id = $1 and sending_paused_at is not null`,
        [ctx.organisationId],
      );

  if ((res.rowCount ?? 0) === 0) return;

  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'engine',
      entityId: null,
      action: pause ? 'sending_paused' : 'sending_resumed',
      diff: { libelle: pause ? 'Envois mis en pause pour toute l’organisation.' : 'Envois relancés.' },
      actorId: ctx.utilisateurId,
    });
  } catch (err) {
    console.warn('[journal] sending_paused/sending_resumed', err);
  }
}

export interface EtatPauseEnvoi {
  actif: boolean;
  depuis: string | null;
  motif: string | null;
  /** Auteur de la pause EN COURS (`null` si aucune pause active, ou si le journal n'a gardé aucune trace). */
  depuisQui: string | null;
  /** Dernière fenêtre de pause déjà refermée (début ET fin connus) — distincte de `actif`/`depuis`, qui décrivent l'état COURANT. */
  dernierePause: { depuis: string; jusqua: string; parQui: string } | null;
}

interface LigneHistoriquePause {
  created_at: string;
  action: string;
  acteur_nom: string | null;
}

/**
 * État courant de la pause (`organizations.sending_paused_at/reason`, déjà lu
 * par `aujourdhui.ts`) et dernière fenêtre COMPLÈTE (début ET fin) tirée du
 * journal (`sending_paused`/`sending_resumed`, `basculerPauseEnvoi`). Les deux
 * informations sont indépendantes : une organisation actuellement en pause
 * affiche quand même sa dernière fenêtre refermée, pas la pause en cours (sans
 * fin) — ce que montre la maquette `reglages-moteur.html`.
 */
export async function lireEtatPauseEnvoi(ctx: Contexte): Promise<EtatPauseEnvoi> {
  exiger(ctx, 'viewer');
  const [orgRes, historiqueRes] = await Promise.all([
    ctx.ex.query<{ sending_paused_at: string | null; sending_paused_reason: string | null }>(
      `select sending_paused_at, sending_paused_reason /* jr:moteur_pause_etat */
         from organizations
        where id = $1`,
      [ctx.organisationId],
    ),
    ctx.ex.query<LigneHistoriquePause>(
      `select ae.created_at, ae.action,
              coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)) as acteur_nom
         from audit_events ae /* jr:moteur_pause_historique */
         left join auth.users u on u.id = ae.actor_id
        where ae.organization_id = $1
          and ae.entity_type = 'engine'
          and ae.action in ('sending_paused', 'sending_resumed')
        order by ae.created_at desc
        limit 4`,
      [ctx.organisationId],
    ),
  ]);

  const org = orgRes.rows[0] ?? null;
  const lignes = historiqueRes.rows;
  const actif = org?.sending_paused_at !== null && org?.sending_paused_at !== undefined;

  const indexReprise = lignes.findIndex((l) => l.action === 'sending_resumed');
  let dernierePause: EtatPauseEnvoi['dernierePause'] = null;
  if (indexReprise !== -1) {
    const pauseAssociee = lignes.slice(indexReprise + 1).find((l) => l.action === 'sending_paused');
    if (pauseAssociee) {
      dernierePause = {
        depuis: pauseAssociee.created_at,
        jusqua: lignes[indexReprise]!.created_at,
        parQui: pauseAssociee.acteur_nom ?? '—',
      };
    }
  }

  // Auteur de la pause EN COURS : la ligne `sending_paused` la plus récente,
  // seulement si rien de plus récent ne l'a refermée entre-temps.
  const derniereLigne = lignes[0];
  const depuisQui = actif && derniereLigne?.action === 'sending_paused' ? (derniereLigne.acteur_nom ?? null) : null;

  return {
    actif,
    depuis: org?.sending_paused_at ?? null,
    motif: org?.sending_paused_reason ?? null,
    depuisQui,
    dernierePause,
  };
}

// ---------------------------------------------------------------------------
// Erreurs récentes (tâche 23)
// ---------------------------------------------------------------------------

export interface ErreurMoteur {
  quand: string;
  libelle: string;
  detail: string | null;
}

interface LigneErreurMoteur {
  created_at: string;
  diff: { libelle?: string; detail?: string } | null;
}

/**
 * Sept derniers jours d'`engine_error` (`audit_events`), le plus récent en
 * premier. Ne lit jamais `pgboss.job` : cette table n'a pas de forme stable
 * accessible depuis cette couche et son `output` peut porter un message brut
 * de fournisseur (donc potentiellement une clé) — `diff.libelle` est déjà
 * nettoyé à l'écriture (`nettoyerMessageErreurJournal`, `journal.ts`).
 */
export async function listerErreursRecentes(ctx: Contexte): Promise<ErreurMoteur[]> {
  exiger(ctx, 'viewer');
  const res = await ctx.ex.query<LigneErreurMoteur>(
    `select created_at, diff /* jr:moteur_erreurs_recentes */
       from audit_events
      where organization_id = $1
        and entity_type = 'engine'
        and action = 'engine_error'
        and created_at >= now() - interval '7 days'
      order by created_at desc
      limit 50`,
    [ctx.organisationId],
  );
  return res.rows.map((r) => ({
    quand: r.created_at,
    libelle: r.diff?.libelle ?? '',
    detail: r.diff?.detail ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Tâches manuelles (tâche 23)
// ---------------------------------------------------------------------------

/**
 * Catalogue des cinq tâches montrées à l'écran Moteur. Une seule est
 * réellement pilotable depuis le web : `sources` réutilise le mécanisme déjà
 * existant (`sources.run_requested_at`, relevé par le worker toutes les
 * `REQUESTED_RUN_POLL_MS`). Le scoring et l'enrichissement tournent déjà en
 * continu (`produire()`, toutes les `DISCOVER_INTERVAL_MS`, 15 minutes par
 * défaut) sans drapeau de déclenchement immédiat côté base — en ajouter un
 * demanderait de faire évoluer le worker (`apps/worker`, hors périmètre de
 * cette tâche, qui ne touche que `packages/core` et le web). La relève des
 * réponses et son rattrapage sont conduits par un curseur autonome
 * (`provider_sync_state`, `apps/worker/src/handlers/releve-*.ts`) : la spec
 * (§6.13) les dit explicitement « affichés en lecture ». Ces quatre tâches
 * sont donc renvoyées avec `lancable: false` — écart assumé sur la maquette
 * `reglages-moteur.html`, qui montre un bouton actif sur trois d'entre elles.
 */
export interface EtatTachesMoteur {
  sources: { lancable: boolean; actives: number; dernierPassage: string | null };
  scoring: { lancable: boolean; enAttente: number };
  enrichissement: { lancable: boolean; enAttente: number };
  releve: { lancable: boolean; dernierPassage: string | null };
}

export async function listerTaches(ctx: Contexte): Promise<EtatTachesMoteur> {
  exiger(ctx, 'viewer');
  const [sourcesRes, scoringRes, enrichissementRes, releveRes] = await Promise.all([
    ctx.ex.query<{ n: number; dernier: string | null }>(
      // Point 4 (tour de correction 5) : « 0 source(s) active(s) · aucun
      // passage encore » alors que des sources avaient déjà tourné — cette
      // carte compte les sources actives de TOUTE l'organisation (pas
      // seulement celles rattachées à une campagne ACTIVE : `lancerTache`,
      // lui, restreint volontairement à ce sous-ensemble déclenchable, un
      // besoin différent de ce simple état des lieux) et prend le dernier
      // passage RÉEL (`source_runs.started_at`, sans filtre de statut — même
      // colonne que l'onglet Sources, `jr:sources_dernier_passage`), pas
      // seulement les passages réussis.
      `select
          (select count(*)::int from sources s where s.organization_id = $1 and s.is_active) as n,
          (select max(sr.started_at) from source_runs sr
             join sources s2 on s2.id = sr.source_id
            where s2.organization_id = $1) as dernier
        /* jr:moteur_taches_sources */`,
      [ctx.organisationId],
    ),
    ctx.ex.query<{ n: number }>(
      `select count(*)::int as n /* jr:moteur_taches_scoring */
         from signals
        where organization_id = $1 and status = 'new' and score is null`,
      [ctx.organisationId],
    ),
    ctx.ex.query<{ n: number }>(
      // Même population que `enqueueEnrichmentForQualified` (comptes qualifiés
      // jamais enrichis), sans le détail par persona : un compte compte une
      // seule fois même qualifié par plusieurs personas.
      `select count(distinct a.id)::int as n /* jr:moteur_taches_enrichissement */
         from signals s
         join accounts a on a.id = s.account_id
        where s.organization_id = $1 and s.status = 'qualified' and a.enriched_at is null`,
      [ctx.organisationId],
    ),
    ctx.ex.query<{ provider: string; last_run_at: string | null; cursor_ms: string | number | null }>(
      `select provider, last_run_at, cursor_ms /* jr:moteur_taches_releve */
         from provider_sync_state
        where organization_id = $1
        order by last_run_at desc nulls last
        limit 1`,
      [ctx.organisationId],
    ),
  ]);

  return {
    sources: {
      lancable: true,
      actives: sourcesRes.rows[0]?.n ?? 0,
      dernierPassage: sourcesRes.rows[0]?.dernier ?? null,
    },
    scoring: { lancable: false, enAttente: scoringRes.rows[0]?.n ?? 0 },
    enrichissement: { lancable: false, enAttente: enrichissementRes.rows[0]?.n ?? 0 },
    releve: { lancable: false, dernierPassage: releveRes.rows[0]?.last_run_at ?? null },
  };
}

export const schemaLancerTache = z.object({ tache: z.literal('sources') });

/**
 * Lance à la main la seule tâche qui le permette réellement (`sources`, voir
 * `listerTaches`) : pose `run_requested_at` sur toutes les sources actives de
 * l'organisation rattachées à au moins une campagne active (R72, même règle
 * que le producteur et que `lancerPassage` — la variante à une seule source
 * de `fonctions/sources.ts`). Un `tache` hors catalogue est une entrée
 * invalide (`ErreurEntree`), pas une erreur silencieuse : l'écran ne doit
 * jamais pouvoir demander une tâche qu'aucun mécanisme ne sait honorer.
 */
export async function lancerTache(ctx: Contexte, entree: unknown): Promise<{ sourcesDeclenchees: number }> {
  exiger(ctx, 'operator');
  valider(schemaLancerTache, entree);

  const res = await ctx.ex.query(
    `update sources s /* jr:moteur_lancer_toutes_sources */
        set run_requested_at = now()
      where s.organization_id = $1
        and s.is_active = true
        and exists (
          select 1 from campaign_sources cs
            join campaigns c on c.id = cs.campaign_id
           where cs.source_id = s.id and c.status = 'active'
        )`,
    [ctx.organisationId],
  );
  const sourcesDeclenchees = res.rowCount ?? 0;

  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'engine',
      entityId: null,
      action: 'source.run_requested',
      diff: { libelle: `Passage de toutes les sources demandé (${sourcesDeclenchees} source(s)).` },
      actorId: ctx.utilisateurId,
    });
  } catch (err) {
    console.warn('[journal] source.run_requested (toutes sources)', err);
  }

  return { sourcesDeclenchees };
}

// ---------------------------------------------------------------------------
// Réglage effectif de la relève des réponses (point 4, tour de correction 5)
// ---------------------------------------------------------------------------

export interface ReglageReleve {
  minutes: number;
  /** `'reglee'` : `sync_interval_min` posé dans Fournisseurs › SalesBlink. `'defaut'` : rien saisi, le worker applique 5 minutes. */
  origine: 'reglee' | 'defaut';
}

/**
 * Carte « Relève des réponses » de l'écran Moteur : disait « Réglé par
 * l'environnement du serveur. Se change avec un redéploiement, pas ici. » —
 * faux sur les deux points (aucune variable d'environnement n'existe pour ce
 * réglage, `normaliserIntervalleReleve` retombe sur un défaut en dur) et
 * contredisait Fournisseurs › SalesBlink, où « Fréquence de relève (minutes) »
 * EST éditable (`modifierConfigFournisseur`, `credentials.config.sync_interval_min`,
 * lu par `releve-salesblink.ts`/`releve-graph.ts` via `normaliserIntervalleReleve`).
 * Lit le même champ, dans le même ordre de repli que le worker — jamais une
 * valeur différente de celle réellement appliquée au prochain passage.
 */
export async function lireReglageReleve(ctx: Contexte): Promise<ReglageReleve> {
  exiger(ctx, 'viewer');
  const res = await ctx.ex.query<{ config: { sync_interval_min?: string } | null }>(
    `select config from credentials /* jr:moteur_reglage_releve */
      where organization_id = $1 and provider_id = 'salesblink' and status = 'configured'`,
    [ctx.organisationId],
  );
  const brut = res.rows[0]?.config?.sync_interval_min;
  const regle = typeof brut === 'string' && brut.trim() !== '';
  return { minutes: normaliserIntervalleReleve(brut), origine: regle ? 'reglee' : 'defaut' };
}
