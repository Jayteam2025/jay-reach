/**
 * Réglages › Fournisseurs (spec lot 2 §6.13, tâche 21) : une carte par
 * fournisseur externe — statut de la clé, dernier test, consommation du
 * jour quand elle se mesure, lien vers le plafond qui la gouverne.
 *
 * `packages/core` ne dépend PAS de `@jay-reach/providers` (ce dernier dépend
 * déjà de `@jay-reach/core` — `packages/providers/package.json` — une
 * dépendance dans l'autre sens créerait un cycle). Le catalogue ci-dessous ne
 * reprend donc que ce que CET écran a besoin de savoir sur chaque fournisseur
 * (identité, classement) : PAS ses champs de formulaire, qui restent le
 * travail de `PROVIDER_CATALOG` (`packages/providers/src/catalog.ts`), lu par
 * la page côté web pour composer le geste « Remplacer ».
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider } from './contexte.js';
import { lireConsommationDuJour, lireReglages, type JaugeEnvois } from './plafonds.js';

export type CategorieFournisseur = 'ia' | 'enrichissement' | 'envoi' | 'offres' | 'linkedin' | 'reception';
export type StatutCle = 'a_renseigner' | 'valide' | 'echec';

export interface DefinitionFournisseur {
  readonly id: string;
  readonly nom: string;
  readonly categorie: CategorieFournisseur;
  /** Relevé par `provider_sync_state` (lot 3 bis) — seuls SalesBlink et Microsoft Graph y écrivent. */
  readonly releve: boolean;
}

/**
 * Les dix fournisseurs du catalogue (`PROVIDER_CATALOG`), reclassés dans les
 * six catégories de l'écran (brief tâche 21 : ia / enrichissement / envoi /
 * offres / linkedin / réception — la dernière ajoutée par le lot 3 bis, après
 * l'écriture du plan). Microsoft Graph ne fait QUE lire les réponses
 * (transport toujours SalesBlink) : catégorie « réception », pas « envoi ».
 *
 * Exportée (relecture tâche 21, point 3) : `packages/providers` (qui DÉPEND de
 * `@jay-reach/core`, jamais l'inverse) porte un test d'alignement comparant
 * ces dix identifiants à ceux de `PROVIDER_CATALOG` — sans lui, les deux
 * listes auraient pu diverger silencieusement (un onzième fournisseur ajouté
 * d'un côté, oublié de l'autre) sans qu'aucun test ne le remarque.
 */
export const CATALOGUE_FOURNISSEURS: readonly DefinitionFournisseur[] = [
  { id: 'anthropic', nom: 'Anthropic', categorie: 'ia', releve: false },
  { id: 'fullenrich', nom: 'FullEnrich', categorie: 'enrichissement', releve: false },
  { id: 'dropcontact', nom: 'Dropcontact', categorie: 'enrichissement', releve: false },
  { id: 'bouncer', nom: 'Bouncer', categorie: 'enrichissement', releve: false },
  { id: 'reoon', nom: 'Reoon', categorie: 'enrichissement', releve: false },
  { id: 'salesblink', nom: 'SalesBlink', categorie: 'envoi', releve: true },
  { id: 'microsoft_graph', nom: 'Microsoft Graph', categorie: 'reception', releve: true },
  { id: 'adzuna', nom: 'Adzuna', categorie: 'offres', releve: false },
  { id: 'francetravail', nom: 'France Travail', categorie: 'offres', releve: false },
  { id: 'apify', nom: 'Apify', categorie: 'linkedin', releve: false },
];

const IDS_FOURNISSEURS = CATALOGUE_FOURNISSEURS.map((f) => f.id) as [string, ...string[]];

export interface FournisseurVue {
  providerId: string;
  nom: string;
  categorie: CategorieFournisseur;
  cle: { presente: boolean; testeeLe: string | null; statut: StatutCle; dernierCaracteres: string | null };
  /** Config non secrète déjà enregistrée (app_id, tenant_id…) — jamais le secret. */
  config: Record<string, string> | null;
  /** Jauge du jour, seulement pour les trois fournisseurs qui portent un plafond organisation (anthropic, fullenrich, salesblink) — `null` sinon. */
  /**
   * `plafond` nul = aucune limite réglée, pas une pause — seul SalesBlink
   * (les envois) peut le rendre, son plafond venant des boîtes d'envoi.
   */
  consommationDuJour: JaugeEnvois | null;
  /** Dernier passage / dernière erreur de la relève — seulement SalesBlink et Microsoft Graph, `null` pour les fournisseurs qui ne relèvent rien. */
  releve: { dernierPassage: string | null; derniereErreur: string | null } | null;
  /** Route de l'écran Plafonds quand ce fournisseur y a une ligne éditable (anthropic, fullenrich), `null` sinon. */
  lienPlafond: string | null;
}

interface LigneCredential {
  provider_id: string;
  status: string;
  last_checked_at: string | null;
  config: Record<string, string> | null;
  last4: string | null;
}

interface LigneSyncState {
  provider: string;
  last_run_at: string | null;
  last_error: string | null;
}

export async function listerFournisseurs(ctx: Contexte): Promise<FournisseurVue[]> {
  // I7 (Important, revue finale du 14/09) : seule lecture du module sans
  // contrôle de rôle jusqu'ici — elle rend pourtant l'état de chaque clé de
  // fournisseur, la date du dernier test et la consommation du jour.
  exiger(ctx, 'viewer');
  const [credRes, syncRes, reglages] = await Promise.all([
    ctx.ex.query<LigneCredential>(
      `select provider_id, status, last_checked_at, config, last4
         from credentials /* jr:lister_fournisseurs_credentials */
        where organization_id = $1`,
      [ctx.organisationId],
    ),
    ctx.ex.query<LigneSyncState>(
      `select provider, last_run_at, last_error
         from provider_sync_state /* jr:lister_fournisseurs_releve */
        where organization_id = $1 and provider in ('salesblink', 'microsoft_graph')`,
      [ctx.organisationId],
    ),
    lireReglages(ctx),
  ]);
  const consommation = await lireConsommationDuJour(ctx, reglages);

  const parCredential = new Map(credRes.rows.map((r) => [r.provider_id, r]));
  const parSync = new Map(syncRes.rows.map((r) => [r.provider, r]));

  return CATALOGUE_FOURNISSEURS.map((def): FournisseurVue => {
    const credential = parCredential.get(def.id);
    const sync = def.releve ? parSync.get(def.id) : undefined;
    const presente = credential?.status === 'configured';

    const statut: StatutCle = !presente ? 'a_renseigner' : sync?.last_error ? 'echec' : 'valide';

    const consommationDuJour: JaugeEnvois | null =
      def.id === 'anthropic'
        ? consommation.scoring
        : def.id === 'fullenrich'
          ? consommation.enrichissement
          : def.id === 'salesblink'
            ? consommation.envois
            : null;

    return {
      providerId: def.id,
      nom: def.nom,
      categorie: def.categorie,
      cle: { presente, testeeLe: credential?.last_checked_at ?? null, statut, dernierCaracteres: credential?.last4 ?? null },
      config: credential?.config ?? null,
      consommationDuJour,
      releve: def.releve ? { dernierPassage: sync?.last_run_at ?? null, derniereErreur: sync?.last_error ?? null } : null,
      lienPlafond: def.id === 'anthropic' || def.id === 'fullenrich' ? '/settings/limits' : null,
    };
  });
}

// ---------------------------------------------------------------------------
// enregistrerCle
// ---------------------------------------------------------------------------

export const schemaEnregistrerCle = z.object({
  providerId: z.enum(IDS_FOURNISSEURS),
  /** Le champ marqué `secret: true` dans `PROVIDER_CATALOG` (api_key, app_key, client_secret…) — toujours retapé en entier : pas de « laisser vide pour garder l'ancienne » (ambiguïté corrigée, cf. note ci-dessous). */
  secret: z.string().min(1, 'La clé ne peut pas être vide.'),
  /** Champs non secrets du même fournisseur (app_id, tenant_id, client_id, sync_interval_min…). */
  config: z.record(z.string()).optional(),
});

/**
 * Enregistre la clé d'un fournisseur — réutilise le CHIFFREMENT de
 * `setProviderCredential` (`apps/web/app/actions/providers.ts`, T5) : même
 * fonction SQL `set_provider_credential` (pgcrypto), appelée ici directement
 * via `ctx.ex` (connexion directe `postgres`, superutilisateur — elle exécute
 * cette fonction `security definer` réservée à `service_role` sans qu'aucun
 * grant supplémentaire soit nécessaire, comme le fait déjà `chercherEmail`
 * pour `enrichissement_deja_en_file`).
 *
 * Le secret est toujours exigé (`schemaEnregistrerCle`, min 1) : l'ancien
 * formulaire (`ProviderForm`) acceptait un secret vide et l'envoyait quand
 * même à `setProviderCredential`, qui l'aurait alors ÉCRASÉ par une chaîne
 * vide dès qu'un opérateur modifiait un seul réglage non secret sans retaper
 * la clé — ce nouvel écran n'expose plus cette ambiguïté : « Remplacer »
 * demande la clé complète, il n'y a rien à laisser vide.
 */
export async function enregistrerCle(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'admin');
  const { providerId, secret, config } = valider(schemaEnregistrerCle, entree);

  const cleChiffrement = process.env.ENCRYPTION_KEY;
  if (!cleChiffrement) {
    throw new Error('Clé de chiffrement manquante (ENCRYPTION_KEY) : impossible d’enregistrer un fournisseur.');
  }

  await ctx.ex.query(
    `select set_provider_credential($1, $2, $3, $4, $5::jsonb) /* jr:enregistrer_cle */`,
    [ctx.organisationId, providerId, secret, cleChiffrement, JSON.stringify(config ?? {})],
  );
}

// ---------------------------------------------------------------------------
// modifierConfigFournisseur
// ---------------------------------------------------------------------------

export const schemaModifierConfigFournisseur = z.object({
  providerId: z.enum(IDS_FOURNISSEURS),
  /** Champs non secrets seulement (sync_interval_min, reply_max_delay_h, model_smart…) — jamais le secret, cf. `merge_provider_config`. */
  config: z.record(z.string()),
});

/**
 * Modifie un ou plusieurs champs non secrets (`sync_interval_min`,
 * `reply_max_delay_h`, `model_smart`…) SANS toucher au secret déjà enregistré
 * — réutilise `merge_provider_config` (migration `20260825160000`, déjà posée
 * pour exactement ce besoin : « poser `config.webhook_secret` sans re-fournir
 * la clé API »). Relecture tâche 21 (point 2) : `enregistrerCle` seul aurait
 * obligé à retaper le secret complet pour changer un simple intervalle de
 * relève — `releve-graph.ts`/`releve-salesblink.ts` lisent `sync_interval_min`
 * sur `credentials.config`, jamais recopié ailleurs, donc cette fonction est
 * la seule façon de le changer depuis l'écran sans passer par la base à la main.
 *
 * `merge_provider_config` fusionne (`||`) la config existante avec celle
 * fournie : les autres clés déjà enregistrées (dont un éventuel `daily_cap`)
 * restent inchangées, seules celles présentes dans `config` sont écrasées.
 */
export async function modifierConfigFournisseur(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'admin');
  const { providerId, config } = valider(schemaModifierConfigFournisseur, entree);
  await ctx.ex.query(
    `select merge_provider_config($1, $2, $3::jsonb) /* jr:modifier_config_fournisseur */`,
    [ctx.organisationId, providerId, JSON.stringify(config)],
  );
}

// ---------------------------------------------------------------------------
// testerFournisseur
// ---------------------------------------------------------------------------

/** Refus métier : rien à tester tant qu'aucune clé n'est enregistrée pour ce fournisseur (R73 : nom propre, pas `ErreurEntree`). */
export class ErreurFournisseurNonConfigure extends Error {
  constructor(providerId: string) {
    super(`Aucune clé enregistrée pour « ${providerId} » : rien à tester.`);
    this.name = 'ErreurFournisseurNonConfigure';
  }
}

export const schemaTesterFournisseur = z.object({ providerId: z.enum(IDS_FOURNISSEURS) });

/**
 * Test de connexion — réutilise `testProviderConnection` (`apps/web/app/actions/providers.ts`,
 * lot 3 bis) : « le test réel par provider arrive avec chaque implémentation ».
 * Ici, on prouve le geste (la clé existe, l'horodatage avance) sans appeler
 * AUCUN fournisseur en réel — même limite assumée que l'ancien stub, jamais
 * comblée depuis (aucune des dix intégrations n'a encore de test réel).
 */
export async function testerFournisseur(ctx: Contexte, entree: unknown): Promise<{ testeeLe: string }> {
  exiger(ctx, 'admin');
  const { providerId } = valider(schemaTesterFournisseur, entree);

  const res = await ctx.ex.query<{ last_checked_at: string }>(
    `update credentials /* jr:tester_fournisseur */
        set last_checked_at = now()
      where organization_id = $1 and provider_id = $2 and status = 'configured'
      returning last_checked_at`,
    [ctx.organisationId, providerId],
  );
  if (res.rowCount === 0) throw new ErreurFournisseurNonConfigure(providerId);
  return { testeeLe: res.rows[0]!.last_checked_at };
}
