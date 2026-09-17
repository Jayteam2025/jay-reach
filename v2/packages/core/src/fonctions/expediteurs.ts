/**
 * Réglages › Expéditeurs (tâche 20, lot 2) : boîtes email (état SalesBlink,
 * plafonds, fenêtre d'envoi, relève des réponses) et comptes LinkedIn.
 * Spec « une fonction, deux façades » : l'écran
 * (`apps/web/app/actions/senders.ts`, `linkedin.ts`) et le futur serveur MCP
 * (#100) appellent les mêmes fonctions avec le même `Contexte`.
 *
 * `packages/core` ne dépend pas de `@jay-reach/providers` (le sens inverse
 * créerait un cycle, même règle que `email-transport/rapports.ts` et
 * `inbox/repondre-au-fil.ts`) : tout appel réseau (lecture de santé
 * SalesBlink, liste des boîtes du workspace, liaison côté SalesBlink) est
 * injecté par l'appelant — jamais importé ici. Ce fichier ne connaît que
 * `senders`, `provider_sync_state`, `linkedin_settings` et `extension_tokens`.
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider, ErreurIntrouvable } from './contexte.js';
import { marqueBoite } from './campagnes.js';
import { comparerInstantsDesc } from '../temps.js';

// ---------------------------------------------------------------------------
// Fenêtre d'envoi : conversion HH:MM ↔ heure pleine
// ---------------------------------------------------------------------------

/**
 * `senders.business_hours`/`linkedin_settings` ne stockent que des heures
 * PLEINES (`startHour`/`endHour`, entiers) — c'est ce que lisent déjà le
 * séquenceur (`apps/worker/src/handlers/sequence.ts`) et l'ancienne action
 * `senders.ts`. L'écran de la tâche 20 saisit une heure au format `HH:MM`
 * (plus proche de la maquette « 9 h à 18 h ») : on ne l'accepte que sur une
 * minute pleine (`:00`), pour ne jamais tronquer silencieusement une saisie
 * en la ramenant à l'heure entière la plus proche.
 */
function heurePleineDepuisHHMM(valeur: string, min: number, max: number): number | null {
  const m = /^([0-2]\d):00$/.exec(valeur);
  if (!m) return null;
  const heure = Number(m[1]);
  return heure >= min && heure <= max ? heure : null;
}

function hhmmDepuisHeurePleine(heure: number): string {
  return `${String(heure).padStart(2, '0')}:00`;
}

/**
 * Valeur admise pour `senders.inbox_provider` (redéclaré depuis
 * `apps/web/lib/inbox-provider.ts` : ce web-lib ne peut pas être importé
 * depuis `packages/core`, sens de dépendance inverse — même geste que les
 * autres redéclarations de ce fichier).
 */
export function normaliserInboxProvider(valeur: unknown): 'microsoft_graph' | null | 'invalide' {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  if (valeur === 'microsoft_graph') return 'microsoft_graph';
  return 'invalide';
}

// ---------------------------------------------------------------------------
// Boîtes email
// ---------------------------------------------------------------------------

export type MarqueBoiteAffichage = 'outlook' | 'gmail' | 'autre';

/**
 * État de santé SalesBlink d'une boîte, tel qu'affiché sur sa carte :
 * - `sans_objet` : boîte non reliée à SalesBlink (`providerRef` absent) —
 *   aucune santé à lire.
 * - `indisponible` : boîte reliée, mais `lireSante` n'a pas répondu dans le
 *   délai de 3 s ou a échoué — la carte affiche « état SalesBlink
 *   indisponible » plutôt qu'une valeur périmée.
 * - `connue` : dernière lecture réussie.
 */
export type SanteBoiteAffichage =
  | { readonly etat: 'sans_objet' }
  | { readonly etat: 'indisponible' }
  | { readonly etat: 'connue'; readonly connectee: boolean; readonly score: number | null };

export interface FenetreEnvoi {
  readonly debut: string;
  readonly fin: string;
  readonly jours: number[];
  readonly fuseau: string;
}

export interface DerniereReleve {
  readonly quand: string | null;
  readonly erreur: string | null;
}

export interface Boite {
  readonly id: string;
  readonly identite: string;
  readonly nomAffiche: string | null;
  readonly marque: MarqueBoiteAffichage;
  readonly providerRef: string | null;
  readonly inboxProvider: 'microsoft_graph' | null;
  readonly active: boolean;
  readonly quotas: { readonly jour: number | null; readonly heure: number | null };
  readonly usageDuJour: number;
  readonly heures: FenetreEnvoi;
  readonly sante: SanteBoiteAffichage;
  readonly derniereReleve: DerniereReleve | null;
  readonly creeLe: string;
}

/** Lit la santé SalesBlink d'une boîte reliée, injectée par l'appelant (client HTTP + clé). */
export type LecteurSanteBoite = (providerRef: string) => Promise<{ connectee: boolean; score: number | null }>;

const DELAI_SANTE_MS = 3_000;

async function avecDelai<T>(promesse: Promise<T>, delaiMs: number): Promise<T | 'expire'> {
  return Promise.race([
    promesse,
    new Promise<'expire'>((resolve) => setTimeout(() => resolve('expire'), delaiMs)),
  ]);
}

interface LigneBoite {
  id: string;
  identity: string;
  display_name: string | null;
  daily_quota: number | null;
  hourly_quota: number | null;
  timezone: string | null;
  business_hours: { startHour?: number; endHour?: number; days?: number[] } | null;
  is_active: boolean;
  provider_ref: string | null;
  inbox_provider: string | null;
  used_today: number;
  created_at: string;
}

interface LigneReleve {
  provider: string;
  last_run_at: string | null;
  last_error: string | null;
}

function fenetreDepuisLigne(l: Pick<LigneBoite, 'business_hours' | 'timezone'>): FenetreEnvoi {
  const bh = l.business_hours;
  return {
    debut: hhmmDepuisHeurePleine(bh?.startHour ?? 9),
    fin: hhmmDepuisHeurePleine(bh?.endHour ?? 18),
    jours: bh?.days && bh.days.length > 0 ? [...bh.days].sort((a, b) => a - b) : [1, 2, 3, 4, 5],
    fuseau: l.timezone ?? 'Europe/Paris',
  };
}

/**
 * Boîtes email de l'organisation pour l'écran Réglages › Expéditeurs.
 *
 * Ne remplace PAS les appels existants à `listerBoitesPourCampagne` (tâche
 * 13, `campagnes.ts`) : l'assistant et l'onglet Réglages d'une campagne n'ont
 * besoin que d'un résumé pauvre (id/identité/marque) et cette fonction reste
 * en place pour ne pas rouvrir T13/T14 (déjà fusionnées, relues, testées en
 * réel). Les deux fonctions lisent la même source (`senders`/`inbox_provider`,
 * même `marqueBoite`) et restent donc cohérentes entre elles sans code
 * partagé de plus haut niveau.
 *
 * `lireSante`, injectée, n'est appelée que pour une boîte reliée
 * (`providerRef` non nul) et court-circuitée après 3 s (délai mesuré côté
 * écran, tâche 15) : au-delà, la carte affiche « état SalesBlink
 * indisponible » plutôt que de bloquer tout l'écran sur une boîte en panne.
 */
export async function listerBoites(ctx: Contexte, lireSante?: LecteurSanteBoite): Promise<Boite[]> {
  exiger(ctx, 'viewer');

  const [boites, releve] = await Promise.all([
    ctx.ex.query<LigneBoite>(
      `select s.id, s.identity, s.display_name, s.daily_quota, s.hourly_quota, s.timezone, s.business_hours,
              s.is_active, s.provider_ref, s.inbox_provider, s.created_at,
              (select count(*)::int from actions act
                where act.sender_id = s.id
                  and act.status in ('dispatched', 'delivered')
                  and act.dispatched_at >= date_trunc('day', now())) as used_today
         from senders s /* jr:expediteurs_boites */
        where s.organization_id = $1 and s.kind = 'email'
        order by s.created_at asc`,
      [ctx.organisationId],
    ),
    ctx.ex.query<LigneReleve>(
      `select provider, last_run_at, last_error from provider_sync_state /* jr:expediteurs_releve */
        where organization_id = $1 and provider in ('salesblink', 'microsoft_graph')`,
      [ctx.organisationId],
    ),
  ]);

  const releveParProvider = new Map(releve.rows.map((r) => [r.provider, r]));

  return Promise.all(
    boites.rows.map(async (l) => {
      const providerReleve = l.inbox_provider === 'microsoft_graph' ? 'microsoft_graph' : 'salesblink';
      const ligneReleve = releveParProvider.get(providerReleve) ?? null;

      let sante: SanteBoiteAffichage = { etat: 'sans_objet' };
      if (l.provider_ref && lireSante) {
        const resultat = await avecDelai(lireSante(l.provider_ref), DELAI_SANTE_MS).catch(() => 'erreur' as const);
        sante =
          resultat === 'expire' || resultat === 'erreur'
            ? { etat: 'indisponible' }
            : { etat: 'connue', connectee: resultat.connectee, score: resultat.score };
      } else if (l.provider_ref) {
        sante = { etat: 'indisponible' };
      }

      return {
        id: l.id,
        identite: l.identity,
        nomAffiche: l.display_name,
        marque: marqueBoite(l.identity, l.inbox_provider) ?? 'autre',
        providerRef: l.provider_ref,
        inboxProvider: l.inbox_provider === 'microsoft_graph' ? 'microsoft_graph' : null,
        active: l.is_active,
        quotas: { jour: l.daily_quota, heure: l.hourly_quota },
        usageDuJour: l.used_today,
        heures: fenetreDepuisLigne(l),
        sante,
        derniereReleve: l.provider_ref || l.inbox_provider === 'microsoft_graph'
          ? { quand: ligneReleve?.last_run_at ?? null, erreur: ligneReleve?.last_error ?? null }
          : null,
        creeLe: l.created_at,
      };
    }),
  );
}

export const schemaModifierBoite = z.object({
  boiteId: z.string().uuid(),
  quotaJour: z.number().int().min(1).max(200).nullable(),
  quotaHeure: z.number().int().min(1).max(50).nullable(),
  heures: z.object({
    debut: z.string().regex(/^\d{2}:\d{2}$/),
    fin: z.string().regex(/^\d{2}:\d{2}$/),
    jours: z.array(z.number().int().min(1).max(7)).min(1),
    fuseau: z.string().min(1),
  }),
  active: z.boolean(),
  inboxProvider: z.union([z.literal('microsoft_graph'), z.null()]),
});

/** Modifie une boîte email (droit administrateur requis). */
export async function modifierBoite(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'admin');
  const e = valider(schemaModifierBoite, entree);

  const debut = heurePleineDepuisHHMM(e.heures.debut, 0, 23);
  const fin = heurePleineDepuisHHMM(e.heures.fin, 1, 24);
  if (debut === null || fin === null) {
    throw new Error("L'heure de début et de fin doivent être des heures pleines (« 09:00 »), entre 0 h et 24 h.");
  }
  if (fin <= debut) {
    throw new Error("L'heure de fin doit venir après l'heure de début.");
  }
  if (e.quotaJour !== null && e.quotaHeure !== null && e.quotaHeure > e.quotaJour) {
    throw new Error('Le plafond horaire ne peut pas dépasser le plafond quotidien.');
  }

  const res = await ctx.ex.query(
    `update senders /* jr:expediteurs_modifier_boite */
        set daily_quota = $3, hourly_quota = $4, business_hours = $5::jsonb, timezone = $6,
            is_active = $7, inbox_provider = $8
      where id = $1 and organization_id = $2 and kind = 'email'`,
    [
      e.boiteId,
      ctx.organisationId,
      e.quotaJour,
      e.quotaHeure,
      JSON.stringify({ startHour: debut, endHour: fin, days: [...e.heures.jours].sort((a, b) => a - b) }),
      e.heures.fuseau,
      e.active,
      e.inboxProvider,
    ],
  );
  if ((res.rowCount ?? 0) !== 1) {
    throw new ErreurIntrouvable('Boîte');
  }
}

/** Boîte du workspace SalesBlink, non encore reliée à un expéditeur — forme injectée par l'appelant. */
export interface BoiteSalesBlinkDistante {
  readonly providerRef: string;
  readonly email: string;
  readonly nom: string;
}

/**
 * Boîtes du workspace SalesBlink pas encore reliées à un expéditeur de
 * l'organisation, pour le sélecteur du bouton « Relier une boîte ».
 * `listerDistantes` (injectée : clé + client HTTP restent du ressort de
 * l'appelant) porte le contenu réel de `GET /senders` — déplacé ici depuis
 * `apps/web/lib/salesblink.ts` (`listerBoitesSalesBlink`), qui devient un
 * simple appelant de cette fonction avec ses vrais transports.
 */
export async function boitesSalesBlinkNonReliees(
  ctx: Contexte,
  listerDistantes: () => Promise<BoiteSalesBlinkDistante[]>,
): Promise<BoiteSalesBlinkDistante[]> {
  exiger(ctx, 'admin');

  const [distantes, reliees] = await Promise.all([
    listerDistantes(),
    ctx.ex.query<{ provider_ref: string }>(
      `select provider_ref from senders /* jr:expediteurs_boites_reliees */
        where organization_id = $1 and kind = 'email' and provider_ref is not null`,
      [ctx.organisationId],
    ),
  ]);
  const idsRelies = new Set(reliees.rows.map((r) => r.provider_ref));
  return distantes.filter((b) => !idsRelies.has(b.providerRef));
}

export const schemaRelierBoite = z.object({
  providerRef: z.string().min(1),
  identite: z.string().email(),
});

/**
 * Relie une boîte du workspace SalesBlink : crée l'expéditeur email
 * correspondant (plafonds et fenêtre d'envoi par défaut, spec §7 : 30/jour,
 * 5/heure, 9 h-18 h du lundi au vendredi, `Europe/Paris` — modifiables
 * ensuite par `modifierBoite`), puis délègue à `activerInbox` (injectée) le
 * `PATCH /senders/{id} {inbox_enabled: true}` côté SalesBlink : une boîte
 * Outlook fraîchement ajoutée l'a à `false`, et sans ce geste aucune réponse
 * ne remonterait jamais (constat du 11/09).
 */
export async function relierBoite(
  ctx: Contexte,
  entree: unknown,
  activerInbox: (providerRef: string) => Promise<void>,
): Promise<{ id: string }> {
  exiger(ctx, 'admin');
  const e = valider(schemaRelierBoite, entree);

  const deja = await ctx.ex.query<{ id: string }>(
    `select id from senders /* jr:expediteurs_relier_dedup */
      where organization_id = $1 and kind = 'email' and lower(identity) = lower($2)
      limit 1`,
    [ctx.organisationId, e.identite],
  );
  if (deja.rows.length > 0) {
    throw new Error('Un expéditeur utilise déjà cette identité.');
  }

  const cree = await ctx.ex.query<{ id: string }>(
    `insert into senders (organization_id, kind, identity, daily_quota, hourly_quota, business_hours, timezone,
                           is_active, provider_id, provider_ref)
     values ($1, 'email', $2, 30, 5, $3::jsonb, 'Europe/Paris', true, 'salesblink', $4)
     returning id`,
    [ctx.organisationId, e.identite, JSON.stringify({ startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] }), e.providerRef],
  );
  const id = cree.rows[0]!.id;

  try {
    await activerInbox(e.providerRef);
  } catch (err) {
    // `activerInbox` est un appel réseau (PATCH SalesBlink), pas une écriture
    // transactionnelle avec l'insertion ci-dessus : sans ce rattrapage, un
    // échec laisserait un expéditeur relié mais avec la lecture des réponses
    // jamais activée, invisible depuis aucun écran (rien ne réessaie ce
    // PATCH). On retire l'expéditeur tout juste créé et on relance l'erreur :
    // `relierBoite` réussit entièrement ou pas du tout.
    await ctx.ex.query(`delete from senders /* jr:expediteurs_relier_rollback */ where id = $1`, [id]);
    throw err;
  }

  return { id };
}

// ---------------------------------------------------------------------------
// Comptes LinkedIn
// ---------------------------------------------------------------------------

export interface CompteLinkedIn {
  /**
   * `extension_tokens.user_id` — identifie la personne dont la session
   * d'extension est reliée. Jamais `token_hash` (empreinte SHA-256 du jeton,
   * migration `20260828140000_extension_token_hash.sql`) : ce champ ne doit
   * jamais atteindre l'écran, même sous forme de hash — seuls la présence
   * d'une connexion et sa date comptent ici.
   */
  readonly id: string;
  readonly nom: string;
  readonly connecte: boolean;
  readonly derniereActivite: string | null;
  readonly active: boolean;
  readonly quotas: { readonly parJour: number; readonly parSemaine: number };
  readonly heures: FenetreEnvoi;
}

interface LigneReglagesLinkedIn {
  daily_cap: number;
  weekly_cap: number;
  send_from_hour: number;
  send_to_hour: number;
  send_days: number[];
  timezone: string;
}

const REGLAGES_LINKEDIN_PAR_DEFAUT: LigneReglagesLinkedIn = {
  daily_cap: 25,
  weekly_cap: 100,
  send_from_hour: 9,
  send_to_hour: 18,
  send_days: [1, 2, 3, 4, 5],
  timezone: 'Europe/Paris',
};

/**
 * Comptes LinkedIn connectés (un par utilisateur ayant relié une extension —
 * un jeton désactivé reste affiché, pour qu'un administrateur puisse le
 * reconnaître et le réactiver ; `distinct on (user_id)` ne garde que le
 * jeton le plus récent d'une même personne, pour ne pas afficher deux cartes
 * pour un jeton régénéré). Les quotas et la fenêtre d'envoi restent
 * aujourd'hui RÉGLÉS PAR ORGANISATION (`linkedin_settings`, une seule ligne) :
 * il n'existe pas encore de plafond par compte dans le schéma — chaque carte
 * affiche donc le même réglage, partagé, tant qu'un seul compte est relié en
 * pratique (`docs`, canal LinkedIn actuel).
 *
 * Ne sélectionne jamais `token_hash` (empreinte du jeton, colonne réellement
 * nommée ainsi depuis la migration `20260828140000_extension_token_hash.sql` —
 * `token` n'existe plus) : rien ici n'en a besoin, `user_id` suffit à cibler
 * la ligne depuis `modifierCompteLinkedIn`.
 */
export async function listerComptesLinkedIn(ctx: Contexte): Promise<CompteLinkedIn[]> {
  exiger(ctx, 'viewer');

  const [jetons, reglages] = await Promise.all([
    ctx.ex.query<{
      user_id: string;
      linkedin_profile_name: string | null;
      /** `extension_tokens.last_used_at`, `timestamptz` : `pg` le renvoie en objet `Date`, pas une chaîne. */
      last_used_at: string | Date | null;
      is_active: boolean;
    }>(
      `select distinct on (user_id) user_id, linkedin_profile_name, last_used_at, is_active
         from extension_tokens /* jr:expediteurs_comptes_linkedin */
        where organization_id = $1
        order by user_id, last_used_at desc nulls last`,
      [ctx.organisationId],
    ),
    ctx.ex.query<LigneReglagesLinkedIn>(
      `select daily_cap, weekly_cap, send_from_hour, send_to_hour, send_days, timezone
         from linkedin_settings /* jr:expediteurs_reglages_linkedin */
        where organization_id = $1`,
      [ctx.organisationId],
    ),
  ]);

  const r = reglages.rows[0] ?? REGLAGES_LINKEDIN_PAR_DEFAUT;
  const comptes = jetons.rows.map((j) => ({
    id: j.user_id,
    nom: j.linkedin_profile_name ?? 'Compte LinkedIn',
    connecte: j.is_active && j.last_used_at !== null,
    // Forme publique inchangée (`CompteLinkedIn.derniereActivite: string | null`) :
    // le tri ci-dessous compare `j.last_used_at` (honnêtement `string | Date | null`)
    // directement, ce cast ne change rien à la valeur portée par ce champ.
    derniereActivite: j.last_used_at as string | null,
    active: j.is_active,
    quotas: { parJour: r.daily_cap, parSemaine: r.weekly_cap },
    heures: {
      debut: hhmmDepuisHeurePleine(r.send_from_hour),
      fin: hhmmDepuisHeurePleine(r.send_to_hour),
      jours: [...r.send_days].sort((a, b) => a - b),
      fuseau: r.timezone,
    },
  }));

  // `distinct on (user_id)` impose `order by user_id, ...` côté SQL — l'ordre
  // d'affichage voulu (compte le plus récemment actif en tête) se refait donc
  // ici, en mémoire. `comparerInstantsDesc` accepte chaîne ou `Date` (jamais
  // `.localeCompare()`, absent de `Date.prototype`) ; départage par id (desc)
  // pour un ordre déterministe entre deux comptes à la même dernière activité.
  return comptes.sort((a, b) => comparerInstantsDesc(a.derniereActivite, b.derniereActivite) || b.id.localeCompare(a.id));
}

export const schemaModifierCompteLinkedIn = z.object({
  compteId: z.string().uuid(),
  active: z.boolean(),
  quotaJour: z.number().int().min(1).max(200),
  quotaSemaine: z.number().int().min(1).max(200),
  heures: z.object({
    debut: z.string().regex(/^\d{2}:\d{2}$/),
    fin: z.string().regex(/^\d{2}:\d{2}$/),
    jours: z.array(z.number().int().min(1).max(7)).min(1),
    fuseau: z.string().min(1),
  }),
});

/**
 * Modifie un compte LinkedIn (droit administrateur requis). `active` porte
 * sur LE JETON D'EXTENSION LE PLUS RÉCENT de la personne visée (`compteId` =
 * `extension_tokens.user_id`, jamais `token_hash` — même ligne que celle
 * affichée par `listerComptesLinkedIn`, choisie par la même sous-requête
 * `order by last_used_at desc` : une personne qui a régénéré son jeton n'a
 * que sa dernière session basculée, jamais une session périmée) ; les quotas
 * et la fenêtre d'envoi restent partagés par organisation
 * (`linkedin_settings`, voir `listerComptesLinkedIn`) — les modifier depuis
 * N'IMPORTE QUELLE carte les change pour tous les comptes, tant qu'un
 * plafond par compte n'existe pas.
 */
export async function modifierCompteLinkedIn(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'admin');
  const e = valider(schemaModifierCompteLinkedIn, entree);

  const debut = heurePleineDepuisHHMM(e.heures.debut, 0, 23);
  const fin = heurePleineDepuisHHMM(e.heures.fin, 1, 24);
  if (debut === null || fin === null) {
    throw new Error("L'heure de début et de fin doivent être des heures pleines (« 09:00 »), entre 0 h et 24 h.");
  }
  if (fin <= debut) {
    throw new Error("L'heure de fin doit venir après l'heure de début.");
  }

  const jeton = await ctx.ex.query(
    `update extension_tokens /* jr:expediteurs_modifier_compte_li */
        set is_active = $3
      where organization_id = $2
        and token_hash = (
          select token_hash from extension_tokens
           where user_id = $1 and organization_id = $2
           order by last_used_at desc nulls last
           limit 1
        )`,
    [e.compteId, ctx.organisationId, e.active],
  );
  if ((jeton.rowCount ?? 0) !== 1) {
    throw new ErreurIntrouvable('Compte LinkedIn');
  }

  await ctx.ex.query(
    `insert into linkedin_settings (organization_id, daily_cap, weekly_cap, send_from_hour, send_to_hour, send_days, timezone, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (organization_id) do update
       set daily_cap = excluded.daily_cap, weekly_cap = excluded.weekly_cap,
           send_from_hour = excluded.send_from_hour, send_to_hour = excluded.send_to_hour,
           send_days = excluded.send_days, timezone = excluded.timezone, updated_at = now()`,
    [ctx.organisationId, e.quotaJour, e.quotaSemaine, debut, fin, [...e.heures.jours].sort((a, b) => a - b), e.heures.fuseau],
  );
}
