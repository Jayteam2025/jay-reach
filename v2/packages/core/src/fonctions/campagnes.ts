/**
 * Fonctions métier de la campagne : lecture (liste, vue d'ensemble, contacts,
 * file du jour, activité) et cycle de vie (création, réglages, lancement,
 * pause, archivage). Spec « une fonction, deux façades » : l'écran
 * (`apps/web/app/actions/campaigns.ts`, une façade fine) et le futur serveur
 * MCP appellent les mêmes fonctions avec le même `Contexte`.
 *
 * Convention de rôle : lecture = `viewer`, écriture = `operator`, sauf
 * l'archivage qui exige `admin` (irréversible côté produit — la campagne
 * sort des listes actives).
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider, ErreurIntrouvable } from './contexte.js';
import { ecrireEvenement, type ActionJournal } from '../journal.js';
import { dansUneTransaction } from '../transaction.js';
import { lireConsommationDuJour, lireReglages } from './plafonds.js';
import { manquesTransportEmail } from './transport-email.js';
import { campaignCreateSchema, campaignStatusSchema, toEntryRules, type CampaignStatus } from '../campaigns/validation.js';
import type { EnvoiPrevu, CanalFil } from './aujourdhui.js';
import { SQL_PROVIDER_ID_AFFICHAGE } from './sources.js';

// ---------------------------------------------------------------------------
// Statut dérivé d'un contact de campagne
// ---------------------------------------------------------------------------

export type StatutContactCampagne =
  | 'a_contacter'
  | 'sans_email'
  | 'en_sequence'
  | 'a_repondu'
  | 'interesse'
  | 'ecarte'
  | 'termine'
  | 'rebond'
  | 'ne_plus_contacter';

/** Ordre de priorité (le premier qui s'applique gagne) — reflète l'urgence pour l'opérateur. */
export const ORDRE_STATUTS: readonly StatutContactCampagne[] = [
  'ne_plus_contacter',
  'rebond',
  'interesse',
  'a_repondu',
  'ecarte',
  'termine',
  'en_sequence',
  'sans_email',
  'a_contacter',
];

/**
 * Expression SQL du statut dérivé, dans l'ordre de `ORDRE_STATUTS`. `c` = le
 * contact (jointure interne dans `FROM_POPULATION_CAMPAGNE` : la population
 * de l'onglet Contacts, ce sont des personnes, jamais des signaux bruts —
 * tour de correction 1, R29), `e` = sa dernière inscription DANS CETTE
 * campagne (LEFT JOIN LATERAL, au plus une ligne), `s` = son signal d'origine
 * qualifié pour cette campagne — `null` pour un contact inscrit sans signal
 * (R36, tour de correction 1 : inscription manuelle/import de liste).
 *
 * `sup.organization_id = c.organization_id` (pas `s.organization_id`) :
 * fonctionne aussi quand `s` est `null` — un contact reste vérifié contre les
 * suppressions de SA propre organisation, avec ou sans signal.
 */
const CASE_STATUT_DERIVE = `case
      when c.status = 'do_not_contact' or exists (
        select 1 from suppressions sup
         where sup.organization_id = c.organization_id
           and c.email is not null
           and ((sup.scope = 'email' and lower(sup.value) = lower(c.email))
             or (sup.scope = 'domain' and lower(sup.value) = lower(split_part(c.email, '@', 2))))
      ) then 'ne_plus_contacter'
      when e.status = 'bounced' then 'rebond'
      when exists (
        select 1 from threads t where t.contact_id = c.id and t.interest = 'interested'
      ) then 'interesse'
      when e.status = 'replied' then 'a_repondu'
      when s.status = 'discarded' or e.status = 'stopped' then 'ecarte'
      when e.status = 'completed' then 'termine'
      when e.status in ('active', 'paused', 'paused_absence') then 'en_sequence'
      when c.email is null or c.email_status <> 'valid' then 'sans_email'
      else 'a_contacter'
    end`;

/**
 * Population d'une campagne (onglet Contacts), R36 (tour de correction 1) :
 * les personnes identifiées par un signal qualifié de ses thèmes de veille
 * (`campaign_sources`, spec §6.5, R29 : signaux `new` exclus) UNION celles
 * inscrites dans la campagne sans passer par un signal (inscription
 * manuelle, import de liste — constat base : les 7 inscriptions de
 * production existantes au 14/09 sont toutes dans ce cas). Chaque contact
 * compte une seule fois : la branche « inscrit » exclut explicitement ceux
 * déjà couverts par la branche « signal », `union` (pas `union all`) dédoublonne
 * le reste. `$1` = id de la campagne, même paramètre pour les deux requêtes
 * qui utilisent cette constante (`listerContactsCampagne`).
 *
 * `s.id`/`s.account_id` restent `null` pour un contact sans signal
 * qualifiant : `score`/`pourquoi` (R33) et l'entreprise via le signal
 * suivent, mais `ac` retombe alors sur le compte du contact lui-même.
 */
const FROM_POPULATION_CAMPAGNE = `from (
        select c0.id as contact_id, s0.id as signal_id
          from signals s0
          join campaign_sources cs0 on cs0.source_id = s0.source_id
          join contacts c0 on c0.source_signal_id = s0.id
         where cs0.campaign_id = $1 and s0.status <> 'new'
        union
        select e1.contact_id, null::uuid
          from enrollments e1
         where e1.campaign_id = $1
           and not exists (
             select 1 from signals s2
               join campaign_sources cs2 on cs2.source_id = s2.source_id
               join contacts c2 on c2.source_signal_id = s2.id
              where c2.id = e1.contact_id and cs2.campaign_id = $1 and s2.status <> 'new'
           )
      ) pop
      join contacts c on c.id = pop.contact_id
      left join signals s on s.id = pop.signal_id
      left join lateral (
        select e2.status, e2.current_step
          from enrollments e2
         where e2.contact_id = c.id and e2.campaign_id = $1
         order by e2.started_at desc
         limit 1
      ) e on true
      left join accounts ac on ac.id = coalesce(s.account_id, c.account_id)`;

// ---------------------------------------------------------------------------
// Petits utilitaires partagés (copies volontairement locales de celles
// d'`aujourdhui.ts`, non exportées là-bas — éviter d'y toucher pendant que
// d'autres tâches du lot y travaillent en parallèle).
// ---------------------------------------------------------------------------

function nomComplet(prenom: string | null, nom: string | null): string {
  return `${prenom ?? ''} ${nom ?? ''}`.trim() || '—';
}

function canalDe(channel: string): CanalFil {
  if (channel.startsWith('linkedin')) return 'linkedin';
  if (channel === 'email') return 'email';
  return undefined;
}

function formatterHeure(iso: string, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** Échappe `%`, `_` et `\` avant de les envelopper en motif `ilike` — un utilisateur qui tape un `%` ne doit pas élargir sa propre recherche. */
function motifRecherche(recherche: string | undefined): string | null {
  if (!recherche) return null;
  return `%${recherche.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Marque d'une boîte, par heuristique de domaine sur son identité (adresse
 * email) — sert uniquement à choisir un logo dans `TuileLogo` (tâche 9).
 * Une boîte sur un domaine propre à l'organisation (le cas courant en
 * production) ne matche aucune entrée : `null`, pas de logo, jamais une
 * erreur. Aucune fonction équivalente n'existait déjà dans `aujourdhui.ts`.
 */
const DOMAINES_MARQUE: Record<string, 'outlook' | 'gmail'> = {
  'outlook.com': 'outlook',
  'hotmail.com': 'outlook',
  'hotmail.fr': 'outlook',
  'live.com': 'outlook',
  'msn.com': 'outlook',
  'office365.com': 'outlook',
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
};

/**
 * `inboxProvider` (`senders.inbox_provider`, lot 3 bis — colonne posée par une
 * branche fusionnée après celle-ci, absente des migrations suivies par CE
 * worktree mais déjà appliquée sur la base OSS partagée) prime sur
 * l'heuristique de domaine (tour de correction 2, R63) : une boîte Microsoft
 * 365 connectée en Graph a un domaine propre à l'organisation (pas
 * `outlook.com`), que l'heuristique seule ne reconnaît jamais — elle
 * s'affichait donc en tuile « @ » plutôt qu'en Outlook.
 */
export function marqueBoite(identite: string, inboxProvider?: string | null): 'outlook' | 'gmail' | null {
  if (inboxProvider === 'microsoft_graph') return 'outlook';
  const domaine = identite.split('@')[1]?.toLowerCase().trim();
  if (!domaine) return null;
  return DOMAINES_MARQUE[domaine] ?? null;
}

// ---------------------------------------------------------------------------
// Types produits
// ---------------------------------------------------------------------------

export interface BoiteCampagne {
  readonly id: string;
  readonly identite: string;
  readonly marque: 'outlook' | 'gmail' | null;
}

/**
 * Nommé `CampagneListeResume` (et non `CampagneResume`, comme suggéré par le
 * brief de tâche) pour ne pas entrer en collision avec le type du même nom
 * déjà exporté par `aujourdhui.ts` (résumé plus pauvre, dédié à la page
 * Aujourd'hui) — renommer celui-là était hors périmètre de cette tâche.
 */
export interface CampagneListeResume {
  readonly id: string;
  readonly nom: string;
  readonly statut: CampaignStatus;
  readonly boites: BoiteCampagne[];
  readonly sources: { providerId: string | null }[];
  readonly qualifies: number;
  /** Personnes distinctes (pas des offres/signaux) reliées aux signaux retenus de la campagne — R31 : la colonne « Contacts » de la liste compte des personnes, pas des offres. */
  readonly contacts: number;
  readonly enSequence: number;
  readonly reponses: number;
  readonly tauxReponse: number;
  /** Livraisons par jour sur les 7 derniers jours (le plus ancien en premier) — sparkline de la liste des campagnes. */
  readonly tendance7j: number[];
  /** Fils dont l'intérêt est marqué, parmi les contacts inscrits dans cette campagne. */
  readonly interesses: number;
  /** Dernier événement du journal touchant cette campagne (`audit_events`), toutes natures confondues — `null` si aucun. */
  readonly derniereActivite: string | null;
}

export interface CampagneEnTete {
  readonly id: string;
  readonly nom: string;
  readonly statut: CampaignStatus;
  readonly boites: BoiteCampagne[];
  readonly scoreMin: number;
  readonly relecturePremiersEnvois: number;
  readonly dailyCap: number | null;
}

export interface Entonnoir {
  readonly trouves: number;
  readonly qualifies: number;
  /** Marche « Contacts identifiés » (R31) : personnes distinctes derrière les signaux qualifiés, pas les signaux eux-mêmes. */
  readonly contacts: number;
  readonly enSequence: number;
  readonly livres: number;
  readonly tauxLivres: number;
  readonly reponses: number;
  readonly tauxReponses: number;
  readonly interesses: number;
}

export interface SourceResume {
  /** `null` si le fournisseur réel n'a pu être résolu par aucun des trois repères (tour de correction 4, R70) — n'est jamais survenu en pratique mais reste possible sur une config disparue. */
  readonly providerId: string | null;
}

export interface Evenement {
  readonly id: string;
  readonly quand: string;
  readonly type: ActionJournal;
  readonly libelle: string;
  readonly detail: string | null;
}

export interface VueDEnsemble {
  readonly campagne: CampagneEnTete;
  readonly entonnoir: Entonnoir;
  readonly fileDuJour: EnvoiPrevu[];
  readonly plafonds: Awaited<ReturnType<typeof lireConsommationDuJour>>;
  readonly sources: SourceResume[];
  /**
   * Nombre RÉEL de sources reliées (lignes `campaign_sources`), pour le
   * compteur de l'onglet Sources (tâche 11) — `sources.length` ne convient
   * pas : c'est un nombre de FOURNISSEURS DISTINCTS (`distinct provider_id`),
   * qui sous-compte dès que deux thèmes partagent un même fournisseur (deux
   * veilles Adzuna, par exemple).
   */
  readonly nombreSources: number;
  readonly activite: Evenement[];
}

export interface ContactCampagne {
  /** `null` pour un contact inscrit sans passer par un signal (R36 : inscription manuelle, import de liste). */
  readonly signalId: string | null;
  readonly contactId: string | null;
  readonly nom: string;
  readonly poste: string | null;
  readonly entreprise: string | null;
  readonly email: string | null;
  readonly statut: StatutContactCampagne;
  readonly etape: number | null;
  /** `signals.score` du signal d'origine (R33) — `null` sans signal. */
  readonly score: number | null;
  /** `signals.title` du signal d'origine (R33, « Pourquoi lui ») — `null` sans signal. */
  readonly pourquoi: string | null;
}

// ---------------------------------------------------------------------------
// Résolution des boîtes d'une campagne
// ---------------------------------------------------------------------------

/**
 * Boîtes email actives de l'organisation. `campaigns.entry_rules.boiteIds`
 * (nouveau, posé par `modifierReglagesCampagne`) restreint la liste à ces
 * expéditeurs précis ; absent ou vide, la campagne partage le pool entier —
 * le comportement d'aujourd'hui, où rien ne relie un expéditeur à UNE
 * campagne (voir `apps/worker/src/handlers/sequence.ts:loadSenders`, qui
 * résout par organisation, jamais par campagne).
 */
async function boitesActivesDeLOrganisation(
  ctx: Contexte,
): Promise<{ id: string; identite: string; inboxProvider: string | null }[]> {
  const res = await ctx.ex.query<{ id: string; identity: string; inbox_provider: string | null }>(
    `select id, identity, inbox_provider from senders /* jr:boites_actives */ where organization_id = $1 and kind = 'email' and is_active`,
    [ctx.organisationId],
  );
  return res.rows.map((r) => ({ id: r.id, identite: r.identity, inboxProvider: r.inbox_provider }));
}

function resoudreBoites(
  toutes: { id: string; identite: string; inboxProvider: string | null }[],
  boiteIds: string[] | undefined,
): BoiteCampagne[] {
  const retenues = boiteIds && boiteIds.length > 0 ? toutes.filter((b) => boiteIds.includes(b.id)) : toutes;
  return retenues.map((b) => ({ id: b.id, identite: b.identite, marque: marqueBoite(b.identite, b.inboxProvider) }));
}

function boiteIdsDe(entryRules: unknown): string[] | undefined {
  const v = (entryRules as { boiteIds?: unknown } | null)?.boiteIds;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
}

/**
 * Boîtes email actives de l'organisation, pour le sélecteur « Boîtes
 * d'envoi » de l'onglet Réglages (tâche 13). Lecture directe de `senders`,
 * même condition que `boitesActivesDeLOrganisation` — remplacée à la tâche
 * 20 par une résolution qui tient compte du provider de transport. `entree`
 * n'a aujourd'hui aucun champ (signature `(ctx, {})`, réservée à ce
 * remplacement), d'où le schéma vide.
 */
export async function listerBoitesPourCampagne(ctx: Contexte, entree: unknown): Promise<BoiteCampagne[]> {
  exiger(ctx, 'viewer');
  valider(z.object({}), entree);

  const res = await ctx.ex.query<{ id: string; identity: string; provider_id: string | null; inbox_provider: string | null }>(
    `select id, identity, provider_id, inbox_provider from senders /* jr:boites_pour_campagne */ where organization_id = $1 and kind = 'email' and is_active`,
    [ctx.organisationId],
  );
  return res.rows.map((r) => ({ id: r.id, identite: r.identity, marque: marqueBoite(r.identity, r.inbox_provider) }));
}

// ---------------------------------------------------------------------------
// listerCampagnes
// ---------------------------------------------------------------------------

const NB_JOURS_TENDANCE = 7;

interface LigneCampagneListe {
  id: string;
  name: string;
  status: CampaignStatus;
  entry_rules: unknown;
  /** Chaque élément peut être `null` (R70, tour de correction 4) : `SQL_PROVIDER_ID_AFFICHAGE` renvoie `null` quand aucun des trois repères n'a de valeur. */
  sources: (string | null)[] | null;
  qualifies: number;
  contacts: number;
  en_sequence: number;
  reponses: number;
  interesses: number;
  derniere_activite: string | null;
}

export async function listerCampagnes(ctx: Contexte): Promise<CampagneListeResume[]> {
  exiger(ctx, 'viewer');

  const [campagnesRes, toutesBoites] = await Promise.all([
    ctx.ex.query<LigneCampagneListe>(
      `select c.id, c.name, c.status, c.entry_rules,
              coalesce((select array_agg(distinct ${SQL_PROVIDER_ID_AFFICHAGE}) from campaign_sources cs join sources so on so.id = cs.source_id where cs.campaign_id = c.id), '{}') as sources,
              (select count(*)::int from signals s2 join campaign_sources cs2 on cs2.source_id = s2.source_id
                where cs2.campaign_id = c.id and s2.status in ('qualified', 'enrolled')) as qualifies,
              (select count(distinct contact_id)::int from (
                  select c3.id as contact_id from signals s3 join campaign_sources cs3 on cs3.source_id = s3.source_id
                    join contacts c3 on c3.source_signal_id = s3.id
                   where cs3.campaign_id = c.id and s3.status <> 'new'
                  union
                  select e3b.contact_id from enrollments e3b where e3b.campaign_id = c.id
                ) pop3) as contacts,
              (select count(*)::int from enrollments e where e.campaign_id = c.id and e.status in ('active', 'paused', 'paused_absence')) as en_sequence,
              (select count(*)::int from enrollments e where e.campaign_id = c.id and e.status = 'replied') as reponses,
              (select count(distinct c4.id)::int from threads t4 join contacts c4 on c4.id = t4.contact_id join enrollments e4 on e4.contact_id = c4.id
                where e4.campaign_id = c.id and t4.interest = 'interested') as interesses,
              (select max(ae.created_at) from audit_events ae
                where (ae.entity_type = 'campaign' and ae.entity_id = c.id) or (ae.diff ->> 'campagneId' = c.id::text)) as derniere_activite
         from campaigns c /* jr:campagnes_liste */
        where c.organization_id = $1
        order by c.created_at desc`,
      [ctx.organisationId],
    ),
    boitesActivesDeLOrganisation(ctx),
  ]);

  const ids = campagnesRes.rows.map((r) => r.id);
  const tendanceParCampagne = new Map<string, number[]>();
  if (ids.length > 0) {
    const tendanceRes = await ctx.ex.query<{ campaign_id: string; jour: string; n: number }>(
      `select e.campaign_id, (a.dispatched_at at time zone 'UTC')::date::text as jour, count(*)::int as n
         from actions a /* jr:tendance_livraisons */
         join enrollments e on e.id = a.enrollment_id
        where e.campaign_id = any($1::uuid[])
          and a.status = 'delivered'
          and a.dispatched_at >= now() - interval '${NB_JOURS_TENDANCE} days'
        group by 1, 2`,
      [ids],
    );
    const parJourEtCampagne = new Map<string, number>();
    for (const r of tendanceRes.rows) parJourEtCampagne.set(`${r.campaign_id}|${r.jour}`, r.n);
    const aujourdhui = new Date();
    for (const id of ids) {
      const valeurs: number[] = [];
      for (let i = NB_JOURS_TENDANCE - 1; i >= 0; i--) {
        const jour = new Date(aujourdhui);
        jour.setUTCDate(jour.getUTCDate() - i);
        const cle = `${id}|${jour.toISOString().slice(0, 10)}`;
        valeurs.push(parJourEtCampagne.get(cle) ?? 0);
      }
      tendanceParCampagne.set(id, valeurs);
    }
  }

  return campagnesRes.rows.map((r) => ({
    id: r.id,
    nom: r.name,
    statut: r.status,
    boites: resoudreBoites(toutesBoites, boiteIdsDe(r.entry_rules)),
    sources: (r.sources ?? []).map((providerId) => ({ providerId })),
    qualifies: r.qualifies,
    contacts: r.contacts,
    enSequence: r.en_sequence,
    reponses: r.reponses,
    tauxReponse: r.qualifies > 0 ? Math.round((r.reponses / r.qualifies) * 1000) / 10 : 0,
    tendance7j: tendanceParCampagne.get(r.id) ?? new Array(NB_JOURS_TENDANCE).fill(0),
    interesses: r.interesses,
    derniereActivite: r.derniere_activite,
  }));
}

// ---------------------------------------------------------------------------
// lireVueDEnsemble
// ---------------------------------------------------------------------------

export const schemaCampagneId = z.object({ campagneId: z.string().uuid() });

interface LigneCampagneEnTete {
  id: string;
  name: string;
  status: CampaignStatus;
  entry_rules: unknown;
  daily_cap: number | null;
}

async function lireCampagneEnTete(ctx: Contexte, campagneId: string): Promise<CampagneEnTete> {
  const [res, toutesBoites, reglages] = await Promise.all([
    ctx.ex.query<LigneCampagneEnTete>(
      `select id, name, status, entry_rules, daily_cap from campaigns /* jr:campagne_entete */ where id = $1 and organization_id = $2`,
      [campagneId, ctx.organisationId],
    ),
    boitesActivesDeLOrganisation(ctx),
    lireReglages(ctx),
  ]);
  const ligne = res.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Campagne');

  const entryRules = (ligne.entry_rules ?? {}) as { min_score?: number; relecturePremiersEnvois?: number };
  return {
    id: ligne.id,
    nom: ligne.name,
    statut: ligne.status,
    boites: resoudreBoites(toutesBoites, boiteIdsDe(ligne.entry_rules)),
    scoreMin: typeof entryRules.min_score === 'number' ? entryRules.min_score : Number(reglages.score_min_defaut),
    relecturePremiersEnvois:
      typeof entryRules.relecturePremiersEnvois === 'number'
        ? entryRules.relecturePremiersEnvois
        : Number(reglages.relecture_premiers_envois_defaut),
    dailyCap: ligne.daily_cap,
  };
}

async function lireEntonnoir(ctx: Contexte, campagneId: string): Promise<Entonnoir> {
  const res = await ctx.ex.query<{
    trouves: number;
    qualifies: number;
    contacts: number;
    en_sequence: number;
    livres: number;
    reponses: number;
    interesses: number;
  }>(
    `select
        (select count(*)::int from signals s join campaign_sources cs on cs.source_id = s.source_id where cs.campaign_id = $1) as trouves,
        (select count(*)::int from signals s join campaign_sources cs on cs.source_id = s.source_id where cs.campaign_id = $1 and s.status in ('qualified', 'enrolled')) as qualifies,
        (select count(distinct contact_id)::int from (
            select c2.id as contact_id from signals s2 join campaign_sources cs2 on cs2.source_id = s2.source_id
              join contacts c2 on c2.source_signal_id = s2.id
             where cs2.campaign_id = $1 and s2.status <> 'new'
            union
            select e2b.contact_id from enrollments e2b where e2b.campaign_id = $1
          ) pop2) as contacts,
        (select count(*)::int from enrollments e where e.campaign_id = $1 and e.status in ('active', 'paused', 'paused_absence')) as en_sequence,
        (select count(*)::int from actions a join enrollments e on e.id = a.enrollment_id where e.campaign_id = $1 and a.status = 'delivered') as livres,
        (select count(*)::int from enrollments e where e.campaign_id = $1 and e.status = 'replied') as reponses,
        (select count(distinct c.id)::int from threads t join contacts c on c.id = t.contact_id join enrollments e on e.contact_id = c.id
          where e.campaign_id = $1 and t.interest = 'interested') as interesses
      /* jr:entonnoir_campagne */`,
    [campagneId],
  );
  const r = res.rows[0] ?? { trouves: 0, qualifies: 0, contacts: 0, en_sequence: 0, livres: 0, reponses: 0, interesses: 0 };
  return {
    trouves: r.trouves,
    qualifies: r.qualifies,
    contacts: r.contacts,
    enSequence: r.en_sequence,
    livres: r.livres,
    tauxLivres: r.qualifies > 0 ? Math.round((r.livres / r.qualifies) * 1000) / 10 : 0,
    reponses: r.reponses,
    tauxReponses: r.livres > 0 ? Math.round((r.reponses / r.livres) * 1000) / 10 : 0,
    interesses: r.interesses,
  };
}

interface LigneEnvoi {
  id: string;
  status: string;
  dispatched_at: string | null;
  scheduled_for: string | null;
  dispatch_after: string | null;
  channel: string;
  first_name: string | null;
  last_name: string | null;
  campagne_nom: string | null;
  etape: number | null;
  expediteur: string | null;
  // Colonnes de la tâche 10 (onglet File du jour) — `EnvoiPrevu` les porte en
  // champs optionnels, absents de la page Aujourd'hui (`aujourdhui.ts`, autre
  // requête, non modifiée par cette tâche).
  block_reason: string | null;
  error: string | null;
  objet: string | null;
  contact_id: string | null;
  sender_id: string | null;
  signal_id: string | null;
}

function versEnvoiPrevu(r: LigneEnvoi, fuseau: string): EnvoiPrevu {
  const quand = r.dispatched_at ?? r.scheduled_for ?? r.dispatch_after;
  return {
    id: r.id,
    heure: quand ? formatterHeure(quand, fuseau) : null,
    envoye: r.dispatched_at !== null,
    contactNom: nomComplet(r.first_name, r.last_name),
    // `sequence_steps.position` part de 0 — +1 pour l'affichage (même conversion qu'`aujourdhui.ts`).
    etape: r.etape !== null ? r.etape + 1 : null,
    campagneNom: r.campagne_nom,
    expediteur: r.expediteur,
    canal: canalDe(r.channel),
    etatDetaille: r.status as EnvoiPrevu['etatDetaille'],
    objet: r.objet,
    contactId: r.contact_id,
    expediteurId: r.sender_id,
    signalId: r.signal_id,
    raisonEchec: r.block_reason ?? r.error,
  };
}

async function lireEnvoisDuJour(
  ctx: Contexte,
  params: { campagneId?: string; jour?: string },
): Promise<{ envois: EnvoiPrevu[]; fuseau: string }> {
  const reglages = await lireReglages(ctx);
  const fuseau = String(reglages.fuseau);
  const jourRef = params.jour ?? new Date().toISOString().slice(0, 10);

  const valeurs: unknown[] = [ctx.organisationId, jourRef];
  let filtreCampagne = '';
  if (params.campagneId) {
    valeurs.push(params.campagneId);
    filtreCampagne = ` and e.campaign_id = $${valeurs.length}`;
  }

  const res = await ctx.ex.query<LigneEnvoi>(
    `select a.id, a.status, a.dispatched_at, a.scheduled_for, a.dispatch_after, a.channel,
            a.block_reason, a.error, a.payload ->> 'subject' as objet, a.sender_id,
            c.first_name, c.last_name, c.source_signal_id as signal_id,
            camp.name as campagne_nom, st.position as etape, s.identity as expediteur,
            e.contact_id
       from actions a /* jr:file_du_jour_campagne */
       join enrollments e on e.id = a.enrollment_id
       join campaigns camp on camp.id = e.campaign_id
       left join contacts c on c.id = e.contact_id
       left join sequence_steps st on st.id = a.step_id
       left join senders s on s.id = a.sender_id
      where camp.organization_id = $1
        and a.status <> 'cancelled'
        and coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) >= $2::date
        and coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) < $2::date + interval '1 day'
        ${filtreCampagne}
      order by coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) asc`,
    valeurs,
  );
  return { envois: res.rows.map((r) => versEnvoiPrevu(r, fuseau)), fuseau };
}

async function listerSourcesCampagneResume(ctx: Contexte, campagneId: string): Promise<SourceResume[]> {
  const res = await ctx.ex.query<{ provider_id: string | null }>(
    `select distinct ${SQL_PROVIDER_ID_AFFICHAGE} as provider_id /* jr:sources_campagne_resume */
       from campaign_sources cs
       join sources so on so.id = cs.source_id
      where cs.campaign_id = $1`,
    [campagneId],
  );
  return res.rows.map((r) => ({ providerId: r.provider_id }));
}

/** Nombre réel de sources reliées (une ligne `campaign_sources` = une carte de l'onglet Sources, tâche 11). */
async function compterSourcesCampagne(ctx: Contexte, campagneId: string): Promise<number> {
  const res = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n /* jr:sources_campagne_compte */ from campaign_sources where campaign_id = $1`,
    [campagneId],
  );
  return res.rows[0]?.n ?? 0;
}

/** Taille de l'aperçu d'activité affiché dans la vue d'ensemble (le total réel vit dans `listerActivite`). */
const NOMBRE_EVENEMENTS_APERCU = 10;

export async function lireVueDEnsemble(ctx: Contexte, entree: unknown): Promise<VueDEnsemble> {
  exiger(ctx, 'viewer');
  const { campagneId } = valider(schemaCampagneId, entree);

  const [campagne, entonnoir, { envois }, sources, nombreSources, { evenements }] = await Promise.all([
    lireCampagneEnTete(ctx, campagneId),
    lireEntonnoir(ctx, campagneId),
    lireEnvoisDuJour(ctx, { campagneId }),
    listerSourcesCampagneResume(ctx, campagneId),
    compterSourcesCampagne(ctx, campagneId),
    listerActivite(ctx, { campagneId, filtre: 'tout', page: 1 }),
  ]);
  const plafonds = await lireConsommationDuJour(ctx);

  return {
    campagne,
    entonnoir,
    fileDuJour: envois,
    plafonds,
    sources,
    nombreSources,
    activite: evenements.slice(0, NOMBRE_EVENEMENTS_APERCU),
  };
}

// ---------------------------------------------------------------------------
// listerContactsCampagne
// ---------------------------------------------------------------------------

const TAILLE_PAGE_CONTACTS = 50;

export const schemaListerContacts = schemaCampagneId.extend({
  filtre: z.enum(['tous', ...ORDRE_STATUTS]).default('tous'),
  recherche: z.string().max(80).optional(),
  page: z.number().int().min(1).max(10_000).default(1),
});

interface LigneContactCampagne {
  signal_id: string | null;
  contact_id: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  entreprise: string | null;
  current_step: number | null;
  statut: StatutContactCampagne;
  score: number | null;
  pourquoi: string | null;
}

export async function listerContactsCampagne(
  ctx: Contexte,
  entree: unknown,
): Promise<{ total: number; compteurs: Record<StatutContactCampagne | 'tous', number>; lignes: ContactCampagne[] }> {
  exiger(ctx, 'viewer');
  const { campagneId, filtre, recherche, page } = valider(schemaListerContacts, entree);

  const compteursRes = await ctx.ex.query<{ statut: StatutContactCampagne; n: number }>(
    `select statut, count(*)::int as n
       from (
         select ${CASE_STATUT_DERIVE} as statut
         ${FROM_POPULATION_CAMPAGNE}
       ) x /* jr:compteurs_contacts_campagne */
      group by statut`,
    [campagneId],
  );
  const compteurs = { tous: 0 } as Record<StatutContactCampagne | 'tous', number>;
  for (const st of ORDRE_STATUTS) compteurs[st] = 0;
  for (const r of compteursRes.rows) {
    compteurs[r.statut] = r.n;
    compteurs.tous += r.n;
  }
  // Le total vient des compteurs (déjà exacts, tous statuts confondus), pas d'un `count(*) over()`
  // posé sur la page demandée : une page au-delà de la dernière renvoie alors 0 ligne et 0 total,
  // au lieu du vrai total (tour de correction 1, relecture). `recherche` ne réduit pas ce total :
  // seul `filtre` le fait, les compteurs par onglet ne connaissant pas le texte recherché.
  const total = compteurs[filtre];

  const motif = motifRecherche(recherche);
  const lignesRes = await ctx.ex.query<LigneContactCampagne>(
    `select signal_id, contact_id, first_name, last_name, job_title, email, entreprise, current_step, statut, score, pourquoi
       from (
         select
           s.id as signal_id,
           c.id as contact_id,
           c.first_name, c.last_name, c.job_title, c.email,
           coalesce(ac.name, s.company_hint) as entreprise,
           e.current_step,
           s.score,
           s.title as pourquoi,
           ${CASE_STATUT_DERIVE} as statut
         ${FROM_POPULATION_CAMPAGNE}
       ) x /* jr:lignes_contacts_campagne */
      where ($2 = 'tous' or statut = $2)
        and ($3::text is null or first_name ilike $3 or last_name ilike $3 or entreprise ilike $3)
      order by signal_id desc nulls last, contact_id desc
      limit $4 offset $5`,
    [campagneId, filtre, motif, TAILLE_PAGE_CONTACTS, (page - 1) * TAILLE_PAGE_CONTACTS],
  );

  const lignes: ContactCampagne[] = lignesRes.rows.map((r) => ({
    signalId: r.signal_id,
    contactId: r.contact_id,
    nom: nomComplet(r.first_name, r.last_name),
    poste: r.job_title,
    entreprise: r.entreprise,
    email: r.email,
    statut: r.statut,
    etape: r.current_step !== null ? r.current_step + 1 : null,
    score: r.score,
    pourquoi: r.pourquoi,
  }));

  return { total, compteurs, lignes };
}

// ---------------------------------------------------------------------------
// listerFileDuJour
// ---------------------------------------------------------------------------

export const schemaFileDuJour = z.object({
  campagneId: z.string().uuid().optional(),
  jour: z.string().date().optional(),
});

async function plafondEnvoisOrganisation(ctx: Contexte): Promise<number> {
  const res = await ctx.ex.query<{ plafond: number }>(
    `select coalesce(sum(daily_quota), 0)::int as plafond /* jr:plafond_envois_org */ from senders where organization_id = $1 and kind = 'email' and is_active`,
    [ctx.organisationId],
  );
  return res.rows[0]?.plafond ?? 0;
}

export async function listerFileDuJour(
  ctx: Contexte,
  entree: unknown,
): Promise<{ prevus: EnvoiPrevu[]; partis: EnvoiPrevu[]; plafondDuJour: number }> {
  exiger(ctx, 'viewer');
  const { campagneId, jour } = valider(schemaFileDuJour, entree);

  const [{ envois }, plafondDuJour] = await Promise.all([
    lireEnvoisDuJour(ctx, { campagneId, jour }),
    (async () => {
      if (!campagneId) return plafondEnvoisOrganisation(ctx);
      const capRes = await ctx.ex.query<{ daily_cap: number | null }>(
        `select daily_cap from campaigns /* jr:file_du_jour_cap */ where id = $1 and organization_id = $2`,
        [campagneId, ctx.organisationId],
      );
      if (capRes.rowCount === 0) throw new ErreurIntrouvable('Campagne');
      return capRes.rows[0]!.daily_cap ?? (await plafondEnvoisOrganisation(ctx));
    })(),
  ]);

  return {
    prevus: envois.filter((e) => !e.envoye),
    partis: envois.filter((e) => e.envoye),
    plafondDuJour,
  };
}

// ---------------------------------------------------------------------------
// listerActivite
// ---------------------------------------------------------------------------

const TAILLE_PAGE_ACTIVITE = 20;

export const schemaActivite = schemaCampagneId.extend({
  filtre: z.enum(['tout', 'sources', 'scoring', 'envois', 'reponses', 'erreurs']).default('tout'),
  page: z.number().int().min(1).max(10_000).default(1),
});

type FiltreActivite = z.infer<typeof schemaActivite>['filtre'];

/**
 * Actions retenues par filtre (tâche 7, spec du coordinateur). `enrichment_batch`
 * n'a volontairement aucun filtre dédié — seul « tout » le montre — faute
 * d'indication contraire.
 */
const ACTIONS_PAR_FILTRE: Partial<Record<FiltreActivite, ActionJournal[]>> = {
  sources: ['source_run'],
  scoring: ['scoring_batch'],
  envois: ['action_sent', 'action_delivered'],
  reponses: ['reply_received', 'absence_detected'],
  erreurs: ['engine_error'],
};

export async function listerActivite(ctx: Contexte, entree: unknown): Promise<{ total: number; evenements: Evenement[] }> {
  exiger(ctx, 'viewer');
  const { campagneId, filtre, page } = valider(schemaActivite, entree);

  const conditionTout = `(
      (entity_type = 'campaign' and entity_id = $1::uuid)
      or (entity_type = 'contact' and action in ('action_sent', 'action_delivered', 'reply_received', 'absence_detected') and diff ->> 'campagneId' = $1::text)
      or (action in ('scoring_batch', 'enrichment_batch') and diff ->> 'campagneId' = $1::text)
      or (entity_type = 'source' and action = 'source_run' and entity_id in (select source_id from campaign_sources where campaign_id = $1::uuid))
      or (entity_type = 'engine' and action = 'engine_error')
    )`;

  // Clause WHERE commune au compte total et à la page : une requête `count(*)` séparée plutôt
  // qu'un `count(*) over()` posé sur la page demandée, qui renverrait 0 (aucune ligne, donc
  // aucune fenêtre) pour une page au-delà de la dernière (tour de correction 1, relecture).
  const params: unknown[] = [campagneId, ctx.organisationId];
  let where = `organization_id = $2 and ${conditionTout}`;
  const actionsFiltre = filtre === 'tout' ? undefined : ACTIONS_PAR_FILTRE[filtre];
  if (actionsFiltre) {
    params.push(actionsFiltre);
    where += ` and action = any($${params.length}::text[])`;
  }

  const totalRes = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n from audit_events /* jr:activite_campagne_total */ where ${where}`,
    params,
  );

  const paramsPage = [...params, TAILLE_PAGE_ACTIVITE, (page - 1) * TAILLE_PAGE_ACTIVITE];
  const res = await ctx.ex.query<{
    id: string;
    created_at: string;
    entity_type: string;
    action: ActionJournal;
    diff: { libelle?: string; detail?: string } | null;
  }>(
    `select id, created_at, entity_type, action, diff
       from audit_events /* jr:activite_campagne */
      where ${where}
      order by created_at desc
      limit $${paramsPage.length - 1} offset $${paramsPage.length}`,
    paramsPage,
  );

  const evenements: Evenement[] = res.rows.map((r) => ({
    id: r.id,
    quand: r.created_at,
    type: r.action,
    libelle: r.diff?.libelle ?? '',
    detail: r.diff?.detail ?? null,
  }));
  return { total: totalRes.rows[0]?.n ?? 0, evenements };
}

// ---------------------------------------------------------------------------
// listerPersonasCampagne (onglet Réglages, R54, tour de correction 1)
// ---------------------------------------------------------------------------

export interface PersonaCampagne {
  readonly id: string;
  readonly nom: string;
}

/**
 * Personas ciblés par la campagne (`entry_rules.personas`), en LECTURE SEULE
 * — la maquette montre leur nom et renvoie leur modification vers l'écran
 * Personas existant, jamais une écriture ici (R54, tour de correction 1).
 */
export async function listerPersonasCampagne(ctx: Contexte, entree: unknown): Promise<PersonaCampagne[]> {
  exiger(ctx, 'viewer');
  const { campagneId } = valider(schemaCampagneId, entree);

  const campagneRes = await ctx.ex.query<{ entry_rules: { personas?: string[] } | null }>(
    `select entry_rules from campaigns /* jr:personas_campagne_lire */ where id = $1 and organization_id = $2`,
    [campagneId, ctx.organisationId],
  );
  const campagne = campagneRes.rows[0];
  if (!campagne) throw new ErreurIntrouvable('Campagne');

  const personaIds = campagne.entry_rules?.personas ?? [];
  if (personaIds.length === 0) return [];

  const res = await ctx.ex.query<{ id: string; name: string }>(
    `select id, name from personas /* jr:personas_campagne */ where organization_id = $1 and id = any($2::uuid[])`,
    [ctx.organisationId, personaIds],
  );
  return res.rows.map((r) => ({ id: r.id, nom: r.name }));
}

/**
 * Tous les personas actifs de l'organisation, pour le sélecteur « Qui
 * cherchez-vous ? » de l'assistant de création de campagne (tâche 14) — à
 * la différence de `listerPersonasCampagne`, ne dépend d'AUCUNE campagne
 * existante (il n'y en a pas encore au moment où l'assistant en a besoin).
 */
export async function listerPersonasOrganisation(ctx: Contexte, entree: unknown): Promise<PersonaCampagne[]> {
  exiger(ctx, 'viewer');
  valider(z.object({}), entree);

  const res = await ctx.ex.query<{ id: string; name: string }>(
    `select id, name from personas /* jr:personas_organisation */ where organization_id = $1 and is_active order by name`,
    [ctx.organisationId],
  );
  return res.rows.map((r) => ({ id: r.id, nom: r.name }));
}

// ---------------------------------------------------------------------------
// Cycle de vie : création, réglages, lancement, pause, archivage
// ---------------------------------------------------------------------------

/**
 * Écrit un événement `campaign_activated`/`campaign_paused` sans jamais faire
 * échouer l'appelant : `ecrireEvenement` (journal.ts) documente cette
 * responsabilité comme étant à la charge de qui l'appelle — un journal qui
 * échoue ne doit jamais faire tomber le passage à l'état actif/en pause, déjà
 * écrit en base au moment de cet appel. Même garantie et même format de log
 * que l'ancienne implémentation (`apps/web/app/actions/campaigns.ts` avant
 * cette tâche : `console.warn('[journal] ${action}', error)`).
 */
async function ecrireEvenementCampagne(
  ctx: Contexte,
  action: 'campaign_activated' | 'campaign_paused',
  campagneId: string,
  libelle: string,
): Promise<void> {
  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'campaign',
      entityId: campagneId,
      action,
      diff: { libelle },
      actorId: ctx.utilisateurId,
    });
  } catch (err) {
    console.warn(`[journal] ${action}`, err);
  }
}

/** Collision de persona entre deux campagnes actives sur le même thème — conflit métier, pas une entrée invalide (`ErreurEntree`). */
export class ErreurConflit extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurConflit';
  }
}

/**
 * Une persona ne peut être servie que par une campagne active à la fois, sur
 * un même thème de veille — sinon le producteur d'inscription arbitrerait
 * silencieusement entre deux destinations pour le même contact (rationale
 * complète : `apps/web/app/actions/campaigns.ts` avant cette tâche).
 *
 * Version base directe (raw SQL) de l'ancienne `chercherCollisionDePersona` :
 * deux requêtes au lieu d'une par campagne active en boucle.
 */
async function collisionDePersona(ctx: Contexte, campagneId: string, personaIds: readonly string[]): Promise<string | null> {
  if (personaIds.length === 0) return null;

  const themesRes = await ctx.ex.query<{ source_id: string }>(
    `select source_id from campaign_sources /* jr:collision_themes */ where campaign_id = $1
     union
     select source_id from campaigns where id = $1 and source_id is not null`,
    [campagneId],
  );
  const themes = new Set(themesRes.rows.map((r) => r.source_id));
  if (themes.size === 0) return null;

  const autresRes = await ctx.ex.query<{ id: string; name: string; entry_rules: { personas?: string[] } | null; source_id: string | null }>(
    `select id, name, entry_rules, source_id
       from campaigns /* jr:collision_autres */
      where organization_id = $1 and status = 'active' and id <> $2`,
    [ctx.organisationId, campagneId],
  );
  if (autresRes.rows.length === 0) return null;

  const liensRes = await ctx.ex.query<{ campaign_id: string; source_id: string }>(
    `select campaign_id, source_id from campaign_sources /* jr:collision_liens */ where campaign_id = any($1::uuid[])`,
    [autresRes.rows.map((r) => r.id)],
  );
  const themesParCampagne = new Map<string, Set<string>>();
  for (const l of liensRes.rows) {
    if (!themesParCampagne.has(l.campaign_id)) themesParCampagne.set(l.campaign_id, new Set());
    themesParCampagne.get(l.campaign_id)!.add(l.source_id);
  }

  for (const autre of autresRes.rows) {
    const themesAutre = themesParCampagne.get(autre.id) ?? new Set<string>();
    if (autre.source_id) themesAutre.add(autre.source_id);
    if (![...themes].some((t) => themesAutre.has(t))) continue;
    const partagee = (autre.entry_rules?.personas ?? []).find((p) => personaIds.includes(p));
    if (partagee) {
      return `La campagne « ${autre.name} » est déjà active sur le même thème pour cette persona. Mettez-la en pause, ou retirez la persona de l’une des deux.`;
    }
  }
  return null;
}

export async function creerCampagne(ctx: Contexte, entree: unknown): Promise<{ id: string }> {
  exiger(ctx, 'operator');
  const { name, entryKind, entryId, sourceIds, minScore, personaIds, dailyCap } = valider(campaignCreateSchema, entree);

  const entryRules = toEntryRules({ minScore, personaIds });
  const res = await ctx.ex.query<{ id: string }>(
    `insert into campaigns /* jr:creer_campagne */ (organization_id, name, status, source_id, list_id, entry_rules, daily_cap)
     values ($1, $2, 'draft', $3, $4, $5::jsonb, $6)
     returning id`,
    [
      ctx.organisationId,
      name,
      entryKind === 'source' ? entryId : null,
      entryKind === 'list' ? entryId : null,
      JSON.stringify(entryRules),
      dailyCap ?? null,
    ],
  );
  const campagneId = res.rows[0]!.id;

  const themes = entryKind === 'source' ? (sourceIds ?? [entryId]) : [];
  if (themes.length > 0) {
    const placeholders = themes.map((_, i) => `($1, $${i + 2})`).join(', ');
    await ctx.ex.query(
      `insert into campaign_sources /* jr:creer_campagne_sources */ (campaign_id, source_id) values ${placeholders}`,
      [campagneId, ...themes],
    );
  }

  return { id: campagneId };
}

export const schemaModifierReglagesCampagne = schemaCampagneId.extend({
  name: z.string().trim().min(1).max(120).optional(),
  dailyCap: z.number().int().min(1).max(10_000).nullable().optional(),
  minScore: z.number().int().min(0).max(100).nullable().optional(),
  personaIds: z.array(z.string().uuid()).max(50).optional(),
  /** Nouveau (tâche 7) : nombre des premiers envois de la campagne soumis à relecture avant envoi. Absent → défaut d'organisation. */
  relecturePremiersEnvois: z.number().int().min(0).nullable().optional(),
  /** Nouveau (tâche 7) : boîtes assignées à cette campagne ; absent ou vide → tout le pool de l'organisation (comportement actuel). */
  boiteIds: z.array(z.string().uuid()).max(50).optional(),
});

export async function modifierReglagesCampagne(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const e = valider(schemaModifierReglagesCampagne, entree);

  const actuelleRes = await ctx.ex.query<{ entry_rules: Record<string, unknown> | null; status: CampaignStatus }>(
    `select entry_rules, status from campaigns /* jr:reglages_lire */ where id = $1 and organization_id = $2`,
    [e.campagneId, ctx.organisationId],
  );
  const actuelle = actuelleRes.rows[0];
  if (!actuelle) throw new ErreurIntrouvable('Campagne');

  // Même garde qu'à l'activation : élargir les personas d'une campagne déjà active peut créer la collision aussi sûrement que l'activer.
  if (e.personaIds !== undefined && e.personaIds.length > 0 && actuelle.status === 'active') {
    const collision = await collisionDePersona(ctx, e.campagneId, e.personaIds);
    if (collision) throw new ErreurConflit(collision);
  }

  const entryRules: Record<string, unknown> = { ...(actuelle.entry_rules ?? {}) };
  if (e.minScore !== undefined) {
    if (e.minScore === null) delete entryRules.min_score;
    else entryRules.min_score = e.minScore;
  }
  if (e.personaIds !== undefined) entryRules.personas = e.personaIds;
  if (e.relecturePremiersEnvois !== undefined) {
    if (e.relecturePremiersEnvois === null) delete entryRules.relecturePremiersEnvois;
    else entryRules.relecturePremiersEnvois = e.relecturePremiersEnvois;
  }
  if (e.boiteIds !== undefined) entryRules.boiteIds = e.boiteIds;

  const colonnes = ['entry_rules = $3::jsonb'];
  const valeurs: unknown[] = [e.campagneId, ctx.organisationId, JSON.stringify(entryRules)];
  if (e.name !== undefined) {
    valeurs.push(e.name);
    colonnes.push(`name = $${valeurs.length}`);
  }
  if (e.dailyCap !== undefined) {
    valeurs.push(e.dailyCap);
    colonnes.push(`daily_cap = $${valeurs.length}`);
  }

  const res = await ctx.ex.query(
    `update campaigns /* jr:reglages_ecrire */ set ${colonnes.join(', ')} where id = $1 and organization_id = $2`,
    valeurs,
  );
  // Défense en profondeur : la lecture ci-dessus a déjà vérifié l'organisation,
  // mais une écriture qui ne vérifie pas `rowCount` réussirait en silence si la
  // campagne disparaissait entre les deux (ou changeait d'organisation) — même
  // garde que les autres écritures de ce fichier (`lancer`, `mettreEnPause`).
  if (res.rowCount !== 1) throw new ErreurIntrouvable('Campagne');
}

/**
 * Ce qui manque à une campagne pour pouvoir envoyer quoi que ce soit —
 * ex-`cequiManquePourEnvoyer` (`apps/web/app/actions/campaigns.ts`), déplacée
 * ici pour être appelable sans écran (assistant de création, MCP).
 *
 * Le canal `call` est écarté partout : il ne consomme aucun expéditeur, ne
 * passe par aucun provider et n'envoie rien.
 */
export async function manquesPourLancer(ctx: Contexte, entree: unknown): Promise<string[]> {
  exiger(ctx, 'viewer');
  const { campagneId } = valider(schemaCampagneId, entree);
  const manques: string[] = [];

  const etapesRes = await ctx.ex.query<{ position: number; channel: string; template_parent_id: string | null }>(
    `select position, channel, template_parent_id from sequence_steps /* jr:manques_etapes */ where campaign_id = $1 order by position`,
    [campagneId],
  );
  const etapes = etapesRes.rows;
  if (etapes.length === 0) {
    return ['la séquence ne comporte aucune étape'];
  }

  const sansMessage = etapes.filter((e) => e.channel !== 'call' && !e.template_parent_id);
  if (sansMessage.length > 0) {
    const numeros = sansMessage.map((e) => e.position + 1).join(', ');
    manques.push(
      sansMessage.length === 1 ? `l’étape ${numeros} n’a pas de message relié` : `les étapes ${numeros} n’ont pas de message relié`,
    );
  }

  const canaux = new Set(etapes.map((e) => e.channel).filter((c) => c !== 'call'));
  const besoinEmail = canaux.has('email');
  const besoinLinkedIn = [...canaux].some((c) => c.startsWith('linkedin'));

  const expediteursRes = await ctx.ex.query<{ kind: string }>(
    `select kind from senders /* jr:manques_genres */ where organization_id = $1 and is_active`,
    [ctx.organisationId],
  );
  const genres = new Set(expediteursRes.rows.map((s) => s.kind));
  if (besoinEmail && !genres.has('email')) manques.push('aucun expéditeur email actif');
  if (besoinLinkedIn && !genres.has('linkedin')) manques.push('aucun expéditeur LinkedIn actif');

  if (besoinEmail) {
    const [cleRes, boitesRes] = await Promise.all([
      ctx.ex.query<{ status: string }>(
        `select status from credentials_public /* jr:manques_cle */ where organization_id = $1 and provider_id = 'salesblink'`,
        [ctx.organisationId],
      ),
      ctx.ex.query<{ provider_ref: string | null; provider_state: { sending_enabled?: boolean } | null }>(
        `select provider_ref, provider_state from senders /* jr:manques_boites */ where organization_id = $1 and kind = 'email' and is_active`,
        [ctx.organisationId],
      ),
    ]);
    const transportManques = manquesTransportEmail({
      cleStatus: cleRes.rows[0]?.status ?? null,
      boites: boitesRes.rows,
    });
    // Libellés repris tels quels de `packages/i18n/src/messages/fr.json` (`campaign.guard.*`) :
    // ce module ne dépend pas de next-intl, les messages sont donc en dur ici.
    const LIBELLES: Record<(typeof transportManques)[number], string> = {
      noSalesBlinkKey: 'aucune clé SalesBlink configurée',
      noBoundEmailSender: 'aucun expéditeur email relié à une boîte SalesBlink',
      emailSenderDisconnected: 'l’expéditeur email relié à SalesBlink n’a pas l’envoi actif',
    };
    for (const m of transportManques) manques.push(LIBELLES[m]);
  }

  return manques;
}

export async function lancer(ctx: Contexte, entree: unknown): Promise<{ ok: true } | { ok: false; manques: string[] }> {
  exiger(ctx, 'operator');
  const { campagneId } = valider(schemaCampagneId, entree);

  const campagneRes = await ctx.ex.query<{ entry_rules: { personas?: string[] } | null }>(
    `select entry_rules from campaigns /* jr:lancer_lire */ where id = $1 and organization_id = $2`,
    [campagneId, ctx.organisationId],
  );
  const campagne = campagneRes.rows[0];
  if (!campagne) throw new ErreurIntrouvable('Campagne');

  const collision = await collisionDePersona(ctx, campagneId, campagne.entry_rules?.personas ?? []);
  if (collision) return { ok: false, manques: [collision] };

  const manques = await manquesPourLancer(ctx, { campagneId });
  if (manques.length > 0) return { ok: false, manques };

  // R72 : le premier passage promis par l'écran (« dès le lancement ») est
  // posé dans la MÊME transaction que l'activation — sans ça, le producteur
  // du worker (qui n'exécute que les sources d'une campagne déjà active,
  // R72) pourrait ne rien enfiler avant le prochain cycle planifié.
  await dansUneTransaction(ctx.ex, async (tx) => {
    await tx.query(
      `update campaigns /* jr:lancer_activer */ set status = 'active' where id = $1 and organization_id = $2`,
      [campagneId, ctx.organisationId],
    );
    await tx.query(
      `update sources /* jr:lancer_premier_passage */ set run_requested_at = now()
        where is_active = true and id in (select source_id from campaign_sources where campaign_id = $1)`,
      [campagneId],
    );
  });
  await ecrireEvenementCampagne(ctx, 'campaign_activated', campagneId, 'Campagne lancée');
  return { ok: true };
}

export async function mettreEnPause(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { campagneId } = valider(schemaCampagneId, entree);

  const res = await ctx.ex.query(
    `update campaigns /* jr:mettre_en_pause */ set status = 'paused' where id = $1 and organization_id = $2 returning id`,
    [campagneId, ctx.organisationId],
  );
  if (res.rowCount === 0) throw new ErreurIntrouvable('Campagne');

  await ecrireEvenementCampagne(ctx, 'campaign_paused', campagneId, 'Campagne mise en pause');
}

export async function archiver(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'admin');
  const { campagneId } = valider(schemaCampagneId, entree);

  const res = await ctx.ex.query(
    `update campaigns /* jr:archiver */ set status = 'archived' where id = $1 and organization_id = $2 returning id`,
    [campagneId, ctx.organisationId],
  );
  if (res.rowCount === 0) throw new ErreurIntrouvable('Campagne');
}

// Ré-export : `campaignStatusSchema` sert à la façade pour valider un statut brut reçu du client (transition manuelle non couverte par `lancer`/`mettreEnPause`/`archiver`, ex. retour en brouillon).
export { campaignStatusSchema };
