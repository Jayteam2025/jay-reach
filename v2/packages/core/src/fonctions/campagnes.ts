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
import { comparerInstantsDesc } from '../temps.js';
import { lireConsommationDuJour, lirePlafondEnvois, lireReglages } from './plafonds.js';
import { manquesTransportEmail } from './transport-email.js';
import { construireValeursContact, normalizeListColumnName, renderTemplatePartial, type LigneValeursContact } from '../messages/index.js';
import { campaignCreateSchema, campaignStatusSchema, toEntryRules, type CampaignStatus } from '../campaigns/validation.js';
import { allocateWithinQuota } from '../sequencer/quota.js';
import type { EnvoiPrevu, CanalFil } from './aujourdhui.js';
import { SQL_PROVIDER_ID_AFFICHAGE, exigerPostLibre } from './sources.js';

// ---------------------------------------------------------------------------
// Statut dérivé d'un contact de campagne
// ---------------------------------------------------------------------------

export type StatutContactCampagne =
  | 'a_contacter'
  | 'sans_email'
  | 'en_pause'
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
  'en_pause',
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
export const CASE_STATUT_DERIVE = `case
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
      when e.status in ('paused', 'paused_absence') then 'en_pause'
      when e.status = 'active' then 'en_sequence'
      when c.email is null or c.email_status <> 'valid' then 'sans_email'
      else 'a_contacter'
    end`;

/**
 * Motif de pause affiché (T29, R93) : `stop_reason` s'il est posé (toujours
 * le cas pour un `paused` — `mettreInscriptionEnPause`, `apps/worker/src/handlers/sequence.ts`,
 * pose toujours un motif), sinon `'absence'` pour un `paused_absence` sans
 * motif propre (posé par la Réception sur une réponse d'absence, sans passer
 * par `mettreInscriptionEnPause`). `'inconnu'` est un repli défensif qui ne
 * devrait jamais survenir en pratique. N'appeler qu'après avoir vérifié que
 * le statut dérivé est bien `'en_pause'` — le résultat n'a pas de sens sinon.
 */
export function motifPauseDe(statutInscription: string | null, stopReason: string | null): string {
  return stopReason ?? (statutInscription === 'paused_absence' ? 'absence' : 'inconnu');
}

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
 *
 * `e.list_id` (revue F5, point 1) : la liste précise dont vient CETTE
 * inscription (`enrollments.list_id`, posé par `ajouterDepuisListe`,
 * `sources.ts`) — jamais `campaigns.list_id`, qui ne dit rien de la
 * campagne réelle « Jay coach - RH » (les deux colonnes nulles, l'inscription
 * seule porte la liste). Sert `listerContactsCampagne` à joindre
 * `list_members` sans second aller-retour.
 */
export const FROM_POPULATION_CAMPAGNE = `from (
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
        select e2.id as enrollment_id, e2.status, e2.current_step, e2.started_at, e2.stop_reason, e2.resume_at, e2.next_action_at, e2.list_id
          from enrollments e2
         where e2.contact_id = c.id and e2.campaign_id = $1
         order by e2.started_at desc
         limit 1
      ) e on true
      left join accounts ac on ac.id = coalesce(s.account_id, c.account_id)`;

// ---------------------------------------------------------------------------
// Grandeurs communes d'une campagne (point 1, tour de correction 5) : une
// seule définition par grandeur, portée ici, reprise par `listerCampagnes`,
// `lireEntonnoir` et `aujourdhui.ts` (colonne « Contacts »). Chaque fragment
// prend l'expression SQL qui désigne l'id de la campagne dans la requête
// appelante — `$1` pour une fonction à une seule campagne (`lireEntonnoir`),
// `c.id` pour une ligne corrélée dans une liste (`listerCampagnes`,
// `aujourdhui.ts`) — jamais un second aller-retour pour reformuler la même
// contrainte.
// ---------------------------------------------------------------------------

/**
 * Grandeur « Contacts » (onglet Contacts, R31/R36) : personnes distinctes,
 * même UNION que `FROM_POPULATION_CAMPAGNE` mais réduite à un compte — la
 * colonne « Qualifiés » d'Aujourd'hui (qui comptait toutes les inscriptions,
 * y compris terminées, jamais les mêmes personnes que l'onglet Contacts)
 * disparaît au profit de cette même définition partout (point 1).
 */
export function sqlContactsCampagne(campagneIdExpr: string): string {
  // Pas de `not exists` pour écarter de la branche « inscrit » les contacts déjà comptés par la
  // branche « signal » (revue F5, constat mineur 6) : le `union` (jamais `union all`) déduplique
  // déjà par `contact_id`, et `count(distinct contact_id)` dédoublonne une seconde fois en
  // sortie — la clause ne changeait aucun résultat, seulement une sous-requête corrélée en plus
  // par ligne d'`enrollments`.
  return `(select count(distinct contact_id)::int from (
      select c0.id as contact_id from signals s0
        join campaign_sources cs0 on cs0.source_id = s0.source_id
        join contacts c0 on c0.source_signal_id = s0.id
       where cs0.campaign_id = ${campagneIdExpr} and s0.status <> 'new'
      union
      select e1.contact_id from enrollments e1
       where e1.campaign_id = ${campagneIdExpr}
    ) pop_contacts)`;
}

/** Grandeur « En séquence » (point 1) : inscriptions `active` SEULEMENT — `paused`/`paused_absence` sont comptées à part (`sqlEnPauseCampagne`). */
export function sqlEnSequenceCampagne(campagneIdExpr: string): string {
  return `(select count(*)::int from enrollments e where e.campaign_id = ${campagneIdExpr} and e.status = 'active')`;
}

/** Grandeur « En pause » (point 1) : inscriptions `paused` ou `paused_absence`. */
export function sqlEnPauseCampagne(campagneIdExpr: string): string {
  return `(select count(*)::int from enrollments e where e.campaign_id = ${campagneIdExpr} and e.status in ('paused', 'paused_absence'))`;
}

/**
 * Actions ENGAGÉES (point 1) : remises OU réellement parties, tous canaux
 * confondus (`dispatched` + `delivered`). Répond à « sur tout ce qu'on a
 * engagé, quelle part est réellement partie ? » (F13, décision du 18/09) —
 * dénominateur de `tauxLivres` (entonnoir) : un prospect dont le message dort
 * encore chez SalesBlink compte ici (il EST engagé), mais pas dans
 * `sqlPartisCampagne` ci-dessous. Ne jamais fusionner les deux sous un seul
 * nom, c'est exactement ce qui a produit les défauts de vocabulaire du jour.
 */
export function sqlEngagesCampagne(campagneIdExpr: string): string {
  return `(select count(*)::int from actions a join enrollments e on e.id = a.enrollment_id where e.campaign_id = ${campagneIdExpr} and a.status in ('dispatched', 'delivered'))`;
}

/**
 * Actions réellement PARTIES — dénominateur de `tauxReponses`/`tauxReponse`.
 * Répond à « sur ce qui est réellement parti, quelle part a répondu ? » (F13,
 * décision du 18/09, deux états pas trois) : un email `dispatched` n'est que
 * remis, SalesBlink ne l'a pas encore réellement envoyé — un prospect dont le
 * message dort encore chez SalesBlink ne peut pas avoir répondu, il ne doit
 * pas écraser artificiellement ce taux (contrairement à `sqlEngagesCampagne`,
 * pertinent lui pour `tauxLivres`). Les autres canaux (LinkedIn : posé par
 * l'extension au moment réel de l'action, pas de transporteur asynchrone,
 * F12) sont déjà partis dès `dispatched`. Même distinction que
 * `estReellementParti` un peu plus haut dans ce fichier (pas réutilisable
 * telle quelle : elle prend des colonnes déjà lues en JS, ici il faut un
 * fragment SQL) — même motif que `jr:partis_aujourdhui` (`aujourdhui.ts`).
 */
export function sqlPartisCampagne(campagneIdExpr: string): string {
  return `(select count(*)::int from actions a join enrollments e on e.id = a.enrollment_id
            where e.campaign_id = ${campagneIdExpr}
              and ((a.channel = 'email' and a.status = 'delivered') or (a.channel <> 'email' and a.status in ('dispatched', 'delivered'))))`;
}

/**
 * Résumé de la liste DOMINANTE qui alimente la campagne, en JSON (revue F5,
 * point 1) — `null` pour une campagne à sources. Même règle de détection que
 * `lireListeSourceCampagne` (`enrollments.list_id` UNION `campaigns.list_id`,
 * jamais `campaigns.list_id` seul), condensée en un seul objet pour tenir
 * dans une colonne d'une requête « toutes les campagnes » : `listerCampagnes`
 * et `aujourdhui.ts` (colonne « Sources ») en ont chacun besoin sur une ligne
 * PAR CAMPAGNE, jamais une pour une seule campagne comme `lireVueDEnsemble`.
 * `total` (nombre de listes distinctes, compté par une fenêtre sur le
 * regroupement) donne `autres` une fois la dominante retirée.
 */
export function sqlListeSourceResumeCampagne(campagneIdExpr: string): string {
  return `(select json_build_object('nom', l.name, 'autres', greatest(cd.total - 1, 0))
      from (
        select list_id, sum(n)::int as n, count(*) over ()::int as total
          from (
            select e.list_id, count(*) as n from enrollments e
             where e.campaign_id = ${campagneIdExpr} and e.list_id is not null
             group by e.list_id
            union all
            select list_id, 0 from campaigns where id = ${campagneIdExpr} and list_id is not null
          ) u
         group by list_id
      ) cd
      join lists l on l.id = cd.list_id
     order by cd.n desc
     limit 1)`;
}

/**
 * Taux (arrondi au dixième) sur les emails partis — jamais sur « en séquence »
 * ni sur « contacts » (point 1). `null` (pas `0`) quand rien n'est parti
 * encore : jamais une division par zéro déguisée en 0 % — les trois écrans
 * (`campaigns/[id]/page.tsx`, `campaigns/page.tsx`, `(app)/page.tsx`)
 * affichent alors « 0 » (revue F5, point 7), jamais un tiret.
 */
export function tauxSurPartis(numerateur: number, partis: number): number | null {
  return partis > 0 ? Math.round((numerateur / partis) * 1000) / 10 : null;
}

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

/**
 * Départ RÉEL d'une action (F12, même copie locale qu'`aujourdhui.ts`) — voir
 * `EnvoiPrevu.livre`. Un email n'est réellement parti qu'une fois SalesBlink
 * l'a effectivement envoyé (`delivered_at`) ; les autres canaux (LinkedIn,
 * posé par l'extension au moment réel de l'action) n'ont pas de transporteur
 * asynchrone entre remise et départ — `dispatched_at` EST déjà ce départ réel.
 */
function estReellementParti(channel: string, dispatchedAt: unknown, deliveredAt: unknown): boolean {
  // `!= null` (lâche) plutôt que `!== null` : couvre `undefined` comme `null`, au cas où un
  // appelant (test compris) omet la colonne plutôt que de la poser explicitement à `null`.
  return channel === 'email' ? deliveredAt != null : dispatchedAt != null;
}

function formatterHeure(iso: string, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/**
 * Jour calendaire (AAAA-MM-JJ) d'un instant DANS un fuseau donné, pas dans
 * celui du process qui exécute le rendu (I5, revue finale — copie locale de
 * `cleJourDansFuseau`, `apps/web/lib/dates.ts` : pas de couplage cross-paquet
 * pour un utilitaire d'une ligne, même convention que `motifRecherche`
 * ci-dessous). `fr-CA` rend l'ISO (année-mois-jour) quel que soit
 * l'environnement, un artefact de cette locale plutôt qu'un choix de langue.
 */
function jourDansFuseau(date: Date, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Échappe `%`, `_` et `\` avant de les envelopper en motif `ilike` — un utilisateur qui tape un `%` ne doit pas élargir sa propre recherche. */
function motifRecherche(recherche: string | undefined): string | null {
  if (!recherche) return null;
  return `%${recherche.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Noms de colonne (normalisés) qui désignent un intitulé de poste dans une
 * liste importée (point 2). Couvre les trois langues du produit (revue F5,
 * constat important 4) : français, anglais, néerlandais — plus quelques
 * synonymes anglais courants dans un export CSV (title/position/role).
 */
const CIBLES_COLONNE_INTITULE_POSTE = new Set([
  'intitule_poste',
  'job_title',
  'title',
  'position',
  'role',
  'functietitel',
  'functie',
  'functienaam',
]);

/**
 * Cherche, dans une ligne brute de `list_members.raw_row`, la colonne du CSV
 * importé qui désigne un intitulé de poste (point 2, onglet Contacts d'une
 * campagne à liste) — `liste_intitule_poste`/`liste_job_title` une fois
 * normalisée (`normalizeListColumnName`, même règle que les variables de
 * message). Renvoie la clé BRUTE (casse d'origine du CSV), à utiliser telle
 * quelle dans `raw_row ->> $n` — jamais la clé normalisée, absente de la ligne.
 */
export function trouverColonneIntitulePoste(rawRow: Record<string, unknown>): string | null {
  for (const cle of Object.keys(rawRow)) {
    if (CIBLES_COLONNE_INTITULE_POSTE.has(normalizeListColumnName(cle))) return cle;
  }
  return null;
}

/**
 * Numéro d'étape à afficher (colonne « Étape », tâche 10 réutilisée par la
 * tâche 18) — R81 : `current_step` (0-based, `enrollments`) dépasse le nombre
 * réel d'étapes une fois la séquence épuisée (`composeTick`,
 * `packages/core/src/sequencer/tick.ts` : `nextStep = steps.length` sur la
 * dernière étape), ce qui affichait « Étape 2 » sur une séquence à une seule
 * étape terminée. Bornée au nombre d'étapes de LA campagne : jamais un numéro
 * qui n'existe pas dans `sequence_steps`. Sans inscription (`currentStep`
 * `null`), reste `null` (pas de colonne Étape à afficher — inchangé).
 * `totalEtapes` à 0 (campagne sans étape, ex. brouillon) : pas de bornage,
 * on garde le calcul d'origine plutôt que d'écraser à 0.
 */
export function etapeAffichee(currentStep: number | null, totalEtapes: number): number | null {
  if (currentStep === null) return null;
  const brute = currentStep + 1;
  return totalEtapes > 0 ? Math.min(brute, totalEtapes) : brute;
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
  /** Inscriptions `active` SEULEMENT (point 1) — `paused`/`paused_absence` sont dans `enPause`. */
  readonly enSequence: number;
  /** Inscriptions `paused` ou `paused_absence` (point 1) — distinctes d'`enSequence` depuis le tour de correction 5 (les deux étaient confondues, 167 affiché ici contre 165 sur Aujourd'hui pour la même campagne). */
  readonly enPause: number;
  readonly reponses: number;
  /** Réponses / emails partis (`dispatched`+`delivered`), jamais / en séquence ni / contacts (point 1) — `null` (page : « — ») quand rien n'est encore parti. */
  readonly tauxReponse: number | null;
  /** Livraisons par jour sur les 7 derniers jours (le plus ancien en premier) — sparkline de la liste des campagnes. */
  readonly tendance7j: number[];
  /** Fils dont l'intérêt est marqué, parmi les contacts inscrits dans cette campagne. */
  readonly interesses: number;
  /** Dernier événement du journal touchant cette campagne (`audit_events`), toutes natures confondues — `null` si aucun. */
  readonly derniereActivite: string | null;
  /**
   * Liste qui alimente la campagne (point 2, issue #120 ; revue F5, point 1)
   * — `null` pour une campagne à sources. Forme réduite (juste le nom et le
   * nombre d'autres listes) : cette ligne de tableau n'affiche qu'un
   * sous-titre court, contrairement à `VueDEnsemble.listeSource`.
   */
  readonly listeSource: { readonly nom: string; readonly autresListes: number } | null;
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

/** Marches communes aux deux natures de campagne (point 1 et point 2, tour de correction 5). */
export interface EntonnoirCommun {
  /** Inscriptions `active` SEULEMENT — `paused`/`paused_absence` sont dans `enPause` (point 1). */
  readonly enSequence: number;
  readonly enPause: number;
  /** Actions réellement PARTIES — alimente la marche « Emails partis » (F13, décision du 18/09 :
   *  deux états, pas trois, même population que `sqlPartisCampagne`). Il n'existe PLUS de champ
   *  `livres` séparé : celui-là ne comptait que `a.status = 'delivered'` sans distinction de canal,
   *  et sous-évaluait toute action LinkedIn réellement partie (qui n'atteint jamais `delivered`,
   *  par construction) — bloquant trouvé en relecture, corrigé en fusionnant les deux champs. */
  readonly partis: number;
  /** `partis` / emails ENGAGÉS (remis + partis, tous canaux) — `null` (page : « — ») quand rien
   *  n'est encore engagé (point 1). Le dénominateur n'est pas la marche du dessus (`enSequence`) :
   *  d'où `enAttenteEnvoi` ci-dessous, l'écran l'annote pour dire de quoi ce taux est la part. */
  readonly tauxLivres: number | null;
  /** Engagés mais pas encore réellement partis (`engagés - partis`, F13, décision du 18/09) —
   *  annotation « N en attente d'envoi » sur la marche « Emails partis », jamais affichée quand
   *  elle vaut 0 (tout ce qui est engagé est réellement parti). Ne peut pas devenir négatif :
   *  `sqlEngagesCampagne` compte `dispatched`+`delivered` tous canaux, `sqlPartisCampagne` en est
   *  un sous-ensemble strict pour CHAQUE canal (email : `delivered` ⊆ {`dispatched`,`delivered`} ;
   *  autres canaux : `dispatched` fait partie des deux ensembles à l'identique) — vérifié par le
   *  test dédié (`campagnes.test.ts`, canal LinkedIn compris). */
  readonly enAttenteEnvoi: number;
  readonly reponses: number;
  /** `reponses` / emails partis, jamais / en séquence ni / contacts (point 1) — `null` sans envoi. */
  readonly tauxReponses: number | null;
  readonly interesses: number;
}

/** Entonnoir d'une campagne alimentée par un ou plusieurs thèmes de veille (`campaign_sources`). */
export interface EntonnoirSources extends EntonnoirCommun {
  readonly origine: 'sources';
  readonly trouves: number;
  readonly qualifies: number;
  /** Marche « Contacts identifiés » (R31) : personnes distinctes derrière les signaux qualifiés, pas les signaux eux-mêmes. */
  readonly contacts: number;
}

/**
 * Entonnoir d'une campagne alimentée directement par une liste importée
 * (`campaigns.list_id`, issue #120, point 2) : pas de « trouvés »/« qualifiés »
 * (aucun signal), l'entonnoir part des contacts importés.
 */
export interface EntonnoirListe extends EntonnoirCommun {
  readonly origine: 'liste';
  /** Nombre de membres de la liste (`list_members`) — même valeur que `VueDEnsemble.listeSource.contacts`. */
  readonly contactsImportes: number;
  /** Membres de la liste dont le contact a un email `valid`. */
  readonly emailVerifie: number;
}

/** Discriminée par `origine` (point 2) : la page choisit les marches selon la nature de la campagne. */
export type Entonnoir = EntonnoirSources | EntonnoirListe;

export interface SourceResume {
  readonly id: string;
  /** Nom de la source, tel que dans l'onglet Sources (ex. « Adzuna — maintenance industrielle »). */
  readonly nom: string;
  /** `null` si le fournisseur réel n'a pu être résolu par aucun des trois repères (tour de correction 4, R70) — n'est jamais survenu en pratique mais reste possible sur une config disparue. */
  readonly providerId: string | null;
}

export interface Evenement {
  readonly id: string;
  readonly quand: string;
  readonly type: ActionJournal;
  /**
   * `null` seulement pour un événement « envois groupés » (`donneesEnvois`
   * posé) — revue F5, point 4 : le cœur ne construit plus de texte français
   * pour cet événement synthétique, la page le rend depuis `donneesEnvois`
   * avec une clé ICU. Toujours une vraie chaîne pour les autres événements
   * (`diff.libelle` de `audit_events`, déjà en français par décision
   * antérieure de la tâche 13).
   */
  readonly libelle: string | null;
  readonly detail: string | null;
  /**
   * Donnée structurée d'un événement « envois groupés » (point 3.a, revue F5
   * point 4) — `n` emails envoyés, `etape` (1-based, tel qu'affiché à
   * l'écran ; `null` si l'action n'a plus d'étape rattachée), `boites`
   * distinctes. Absent pour tout autre événement, qui garde son texte tel
   * quel dans `libelle`.
   */
  readonly donneesEnvois?: { readonly n: number; readonly etape: number | null; readonly boites: number };
}

export interface VueDEnsemble {
  readonly campagne: CampagneEnTete;
  readonly entonnoir: Entonnoir;
  readonly fileDuJour: EnvoiPrevu[];
  /**
   * Combien des envois pas encore partis de `fileDuJour` peuvent RÉELLEMENT
   * encore sortir aujourd'hui, compte tenu du plafond journalier restant de
   * leur boîte (revue F5, point 10 ; `projeterEnvoisDuJour`) — `null` seulement
   * si `fileDuJour` porte un autre jour que celui du jour courant (n'arrive pas
   * depuis cette fonction, qui ne demande jamais un jour précis).
   */
  readonly projectionFileDuJour: { possiblesAujourdhui: number; reportesProchainCreneau: number } | null;
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
  /**
   * Liste qui alimente la campagne (point 2, issue #120) — `null` pour une
   * campagne à sources. Résolue via `enrollments.list_id` (revue F5, point 1) :
   * `campaigns.list_id` seul ne suffit pas, une campagne réelle peut n'avoir
   * ni source ni liste posées à son propre niveau, la liste ne vivant que sur
   * chaque inscription (`ajouterDepuisListe`, tiroir « Liste existante »).
   * La liste DOMINANTE (le plus d'inscriptions) fait le texte ; `autresListes`
   * compte les autres listes distinctes qui alimentent aussi la campagne.
   */
  readonly listeSource: ListeSourceResume | null;
}

export interface ListeSourceResume {
  readonly nom: string;
  readonly contacts: number;
  readonly importeeLe: string;
  /** Nombre d'AUTRES listes distinctes qui alimentent aussi la campagne (0 si une seule liste). */
  readonly autresListes: number;
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
  /** Dernière inscription du contact dans cette campagne — `null` sans inscription. */
  readonly inscriptionId: string | null;
  /** Motif de pause (T29, R93) — non `null` seulement quand `statut === 'en_pause'` (`motifPauseDe`). */
  readonly motifPause: string | null;
  /** `enrollments.resume_at` — non `null` seulement pour une pause d'absence datée. */
  readonly repriseLe: string | null;
  /**
   * `enrollments.next_action_at` (F11) — non `null` seulement quand `statut === 'en_sequence'` :
   * une inscription en pause, arrêtée ou terminée n'a pas de « prochain message » à annoncer.
   */
  readonly prochainMessageLe: string | null;
  /**
   * Intitulé de poste de la liste (point 2, campagne à liste) : valeur de la
   * colonne du CSV importé qui normalise vers `intitule_poste` ou `job_title`
   * (`normalizeListColumnName`) — `null` pour une campagne à sources, ou pour
   * un contact dont la ligne importée n'a pas cette colonne renseignée.
   */
  readonly intitulePosteListe: string | null;
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
    // Point 4 (tour de correction 5) : un seul tri, par adresse, dans toute requête qui
    // liste des expéditeurs (« Envoie depuis », cartes Expéditeurs) — sans lui, l'ordre
    // dépendait de l'exécution physique de la requête, différent d'une page à l'autre.
    `select id, identity, inbox_provider from senders /* jr:boites_actives */
      where organization_id = $1 and kind = 'email' and is_active
      order by identity asc`,
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
    `select id, identity, provider_id, inbox_provider from senders /* jr:boites_pour_campagne */
      where organization_id = $1 and kind = 'email' and is_active
      order by identity asc`,
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
  en_pause: number;
  partis: number;
  reponses: number;
  interesses: number;
  derniere_activite: string | null;
  /** `sqlListeSourceResumeCampagne` (revue F5, point 1) — `null` pour une campagne à sources. */
  liste_source: { nom: string; autres: number } | null;
}

/** Une campagne réduite à ce qu'un menu déroulant affiche (`listerCampagnesPourFiltre`). */
export interface CampagneFiltreOption {
  readonly id: string;
  readonly nom: string;
  readonly statut: CampaignStatus;
}

/**
 * Identifiant, nom et statut des campagnes, dans le même ordre que `listerCampagnes`, en UNE
 * requête : pour remplir un `<select>` (filtre de Réception et de Contacts, import CSV), là où
 * `listerCampagnes` lit les réglages, les boîtes et calcule une tendance sur 7 jours dont ces
 * écrans n'affichent rien.
 */
export async function listerCampagnesPourFiltre(ctx: Contexte): Promise<CampagneFiltreOption[]> {
  exiger(ctx, 'viewer');
  const res = await ctx.ex.query<{ id: string; name: string; status: CampaignStatus }>(
    `select c.id, c.name, c.status /* jr:campagnes_options */
       from campaigns c
      where c.organization_id = $1
      order by c.created_at desc`,
    [ctx.organisationId],
  );
  return res.rows.map((r) => ({ id: r.id, nom: r.name, statut: r.status }));
}

export async function listerCampagnes(ctx: Contexte): Promise<CampagneListeResume[]> {
  exiger(ctx, 'viewer');

  const [reglages, campagnesRes, toutesBoites] = await Promise.all([
    lireReglages(ctx),
    ctx.ex.query<LigneCampagneListe>(
      `select c.id, c.name, c.status, c.entry_rules,
              coalesce((select array_agg(distinct ${SQL_PROVIDER_ID_AFFICHAGE}) from campaign_sources cs join sources so on so.id = cs.source_id where cs.campaign_id = c.id), '{}') as sources,
              (select count(*)::int from signals s2 join campaign_sources cs2 on cs2.source_id = s2.source_id
                where cs2.campaign_id = c.id and s2.status in ('qualified', 'enrolled')) as qualifies,
              ${sqlContactsCampagne('c.id')} as contacts,
              ${sqlEnSequenceCampagne('c.id')} as en_sequence,
              ${sqlEnPauseCampagne('c.id')} as en_pause,
              ${sqlPartisCampagne('c.id')} as partis,
              (select count(*)::int from enrollments e where e.campaign_id = c.id and e.status = 'replied') as reponses,
              (select count(distinct c4.id)::int from threads t4 join contacts c4 on c4.id = t4.contact_id join enrollments e4 on e4.contact_id = c4.id
                where e4.campaign_id = c.id and t4.interest = 'interested') as interesses,
              -- Revue F5, point 5 : la seule dernière ligne d'audit_events ratait les campagnes
              -- dont le moteur a tourné (envois, réponses) sans qu'aucun événement n'ait été
              -- rejoué dans le journal (redéploiement, campagne créée avant son ajout) — les
              -- trois sources réelles de « la campagne a bougé », la plus récente des trois.
              greatest(
                (select max(ae.created_at) from audit_events ae
                  where (ae.entity_type = 'campaign' and ae.entity_id = c.id) or (ae.diff ->> 'campagneId' = c.id::text)),
                (select max(a5.dispatched_at) from actions a5 join enrollments e5 on e5.id = a5.enrollment_id where e5.campaign_id = c.id),
                (select max(e6.ended_at) from enrollments e6 where e6.campaign_id = c.id and e6.status = 'replied')
              ) as derniere_activite,
              ${sqlListeSourceResumeCampagne('c.id')} as liste_source
         from campaigns c /* jr:campagnes_liste */
        where c.organization_id = $1
        order by c.created_at desc`,
      [ctx.organisationId],
    ),
    boitesActivesDeLOrganisation(ctx),
  ]);

  const fuseau = String(reglages.fuseau);
  const ids = campagnesRes.rows.map((r) => r.id);
  const tendanceParCampagne = new Map<string, number[]>();
  if (ids.length > 0) {
    // Groupé par jour DANS le fuseau de l'organisation, pas en UTC (I5, revue finale) : un
    // départ après le décalage horaire tombait sinon dans la mauvaise barre du graphe.
    // G6 : cinquième copie divergente de « parti » (après `sqlEngagesCampagne`,
    // `sqlPartisCampagne`, `lireEntonnoir` et le champ `livres`, tous corrigés) — celle-ci
    // ne comptait que `a.status = 'delivered'`, daté sur `delivered_at`, TOUS CANAUX
    // CONFONDUS. Un email suit ce chemin, mais LinkedIn n'a pas d'accusé de réception
    // (F12, extension : `dispatched_at` EST déjà le départ réel, pas de transporteur
    // asynchrone) — il n'atteint jamais `status = 'delivered'`, donc n'apparaissait
    // JAMAIS dans le graphe de tendance, quelle que soit son activité réelle. Même
    // distinction que `sqlPartisCampagne` ci-dessus : email daté/filtré sur
    // `delivered_at`+`status = 'delivered'`, les autres canaux sur `dispatched_at`+
    // `status in ('dispatched', 'delivered')`. Renommé `jr:tendance_partis` : « livraisons »
    // contredisait le vocabulaire retenu (remis/parti, plus de « livré »).
    const tendanceRes = await ctx.ex.query<{ campaign_id: string; jour: string; n: number }>(
      `select e.campaign_id,
              ((case when a.channel = 'email' then a.delivered_at else a.dispatched_at end) at time zone $2)::date::text as jour,
              count(*)::int as n
         from actions a /* jr:tendance_partis */
         join enrollments e on e.id = a.enrollment_id
        where e.campaign_id = any($1::uuid[])
          and ((a.channel = 'email' and a.status = 'delivered') or (a.channel <> 'email' and a.status in ('dispatched', 'delivered')))
          and (case when a.channel = 'email' then a.delivered_at else a.dispatched_at end) >= now() - interval '${NB_JOURS_TENDANCE} days'
        group by 1, 2`,
      [ids, fuseau],
    );
    const parJourEtCampagne = new Map<string, number>();
    for (const r of tendanceRes.rows) parJourEtCampagne.set(`${r.campaign_id}|${r.jour}`, r.n);
    // Ancré sur le jour calendaire du fuseau de l'organisation (pas `new Date()` nu, en UTC) :
    // l'arithmétique en jours entiers qui suit reste ensuite en UTC pur, sans nouveau risque de
    // décalage puisque l'ancre porte déjà le bon jour.
    const ancre = new Date(`${jourDansFuseau(new Date(), fuseau)}T00:00:00Z`);
    for (const id of ids) {
      const valeurs: number[] = [];
      for (let i = NB_JOURS_TENDANCE - 1; i >= 0; i--) {
        const jour = new Date(ancre);
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
    enPause: r.en_pause,
    reponses: r.reponses,
    tauxReponse: tauxSurPartis(r.reponses, r.partis),
    tendance7j: tendanceParCampagne.get(r.id) ?? new Array(NB_JOURS_TENDANCE).fill(0),
    interesses: r.interesses,
    derniereActivite: r.derniere_activite,
    listeSource: r.liste_source ? { nom: r.liste_source.nom, autresListes: r.liste_source.autres } : null,
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

/**
 * Listes qui alimentent la campagne (point 2, issue #120 ; revue F5, point 1) :
 * `enrollments.list_id` (posé par `ajouterDepuisListe`, tiroir « Liste
 * existante ») UNION `campaigns.list_id` s'il est posé — jamais
 * `campaigns.list_id` SEUL, qui reste nul sur une campagne réelle (« Jay coach
 * - RH ») dont la liste ne vit que sur chaque inscription. Une campagne peut
 * puiser dans plusieurs listes distinctes au fil du temps : `listIds` les
 * renvoie TOUTES, triées par nombre d'inscriptions décroissant (la dominante
 * en tête), pour que `lireEntonnoir` (appelé juste après, dans le même
 * `lireVueDEnsemble`) compte les membres de la ou des listes sans second
 * aller-retour. `listeSource` ne décrit que la liste dominante ;
 * `autresListes` porte le nombre de listes supplémentaires.
 *
 * Exportée : `lireSequence` (`sequence.ts`) réutilise cette même fonction
 * pour le nœud Sources de l'onglet Séquence (revue F5, constat bloquant 1) —
 * aucune copie, aucun cycle (`sequence.ts` importe déjà `schemaCampagneId`
 * depuis ce fichier, jamais l'inverse).
 */
export async function lireListeSourceCampagne(
  ctx: Contexte,
  campagneId: string,
): Promise<{ listIds: string[]; listeSource: ListeSourceResume | null }> {
  const res = await ctx.ex.query<{ list_id: string; nom: string; importee_le: string; contacts: number }>(
    `with camp as (
        select id, list_id from campaigns c where c.id = $1 and c.organization_id = $2
      ),
      candidats as (
        select list_id, sum(n)::int as n
          from (
            select e.list_id, count(*) as n
              from enrollments e
              join camp on camp.id = e.campaign_id
             where e.list_id is not null
             group by e.list_id
            union all
            select camp.list_id, 0
              from camp
             where camp.list_id is not null
          ) u
         group by list_id
      )
      select l.id as list_id, l.name as nom, l.created_at as importee_le,
             (select count(*)::int from list_members lm where lm.list_id = l.id) as contacts
        from candidats cd
        join lists l on l.id = cd.list_id /* jr:campagne_liste_source */
       order by cd.n desc, l.created_at desc`,
    [campagneId, ctx.organisationId],
  );
  if (res.rows.length === 0) return { listIds: [], listeSource: null };
  const dominante = res.rows[0]!;
  return {
    listIds: res.rows.map((r) => r.list_id),
    listeSource: {
      nom: dominante.nom,
      contacts: dominante.contacts,
      importeeLe: dominante.importee_le,
      autresListes: res.rows.length - 1,
    },
  };
}

/**
 * Vue d'ensemble (point 2, issue #120) : la nature de la campagne (`listIds`
 * non vide ou non, résolu par `lireListeSourceCampagne` avant l'appel — pas de
 * second aller-retour pour la même information) décide de la forme de
 * l'entonnoir : une campagne à liste n'a ni signal ni thème de veille, un
 * entonnoir qui commence par « 0 offres et profils trouvés » n'y a aucun
 * sens. Les marches COMMUNES (en séquence/en pause/partis/réponses/
 * intéressés, point 1) sont lues une seule fois, dans une requête à part,
 * jamais dupliquées entre les deux branches.
 */
async function lireEntonnoir(ctx: Contexte, campagneId: string, listIds: readonly string[]): Promise<Entonnoir> {
  const communRes = await ctx.ex.query<{
    en_sequence: number;
    en_pause: number;
    engages: number;
    partis: number;
    reponses: number;
    interesses: number;
  }>(
    `select
        ${sqlEnSequenceCampagne('$1')} as en_sequence,
        ${sqlEnPauseCampagne('$1')} as en_pause,
        ${sqlEngagesCampagne('$1')} as engages,
        ${sqlPartisCampagne('$1')} as partis,
        (select count(*)::int from enrollments e where e.campaign_id = $1 and e.status = 'replied') as reponses,
        (select count(distinct c.id)::int from threads t join contacts c on c.id = t.contact_id join enrollments e on e.contact_id = c.id
          where e.campaign_id = $1 and t.interest = 'interested') as interesses
      /* jr:entonnoir_commun */`,
    [campagneId],
  );
  const c = communRes.rows[0] ?? { en_sequence: 0, en_pause: 0, engages: 0, partis: 0, reponses: 0, interesses: 0 };
  const commun: EntonnoirCommun = {
    enSequence: c.en_sequence,
    enPause: c.en_pause,
    partis: c.partis,
    // « Sur tout ce qu'on a engagé, quelle part est réellement partie ? » (F13, décision du
    // 18/09) : dénominateur `engages` (remis + partis), jamais `partis` seul — un email encore
    // chez SalesBlink reste engagé, ce taux dit justement combien en attendent encore.
    tauxLivres: tauxSurPartis(c.partis, c.engages),
    // Complément du taux ci-dessus, jamais négatif : `partis` est un sous-ensemble strict
    // d'`engages` pour chaque canal (email : `delivered` ⊆ {`dispatched`,`delivered`} ; les
    // autres canaux partagent exactement la même condition dans les deux fragments).
    enAttenteEnvoi: c.engages - c.partis,
    reponses: c.reponses,
    // « Sur ce qui est réellement parti, quelle part a répondu ? » : dénominateur `partis` au
    // sens strict — un message encore chez SalesBlink ne peut pas avoir généré de réponse.
    tauxReponses: tauxSurPartis(c.reponses, c.partis),
    interesses: c.interesses,
  };

  if (listIds.length > 0) {
    // « Contacts importés »/« Email vérifié » (point 2) : membres de LA OU DES listes qui
    // alimentent la campagne (revue F5, point 1) — `distinct` un contact membre de plusieurs
    // de ces listes ne compte qu'une fois.
    const listeRes = await ctx.ex.query<{ contacts_importes: number; email_verifie: number }>(
      `select
          count(distinct lm.contact_id)::int as contacts_importes,
          count(distinct case when co.email_status = 'valid' then lm.contact_id end)::int as email_verifie
        from list_members lm /* jr:entonnoir_liste */
        join contacts co on co.id = lm.contact_id
       where lm.list_id = any($1::uuid[])`,
      [listIds],
    );
    const l = listeRes.rows[0] ?? { contacts_importes: 0, email_verifie: 0 };
    return { origine: 'liste', contactsImportes: l.contacts_importes, emailVerifie: l.email_verifie, ...commun };
  }

  const sourcesRes = await ctx.ex.query<{ trouves: number; qualifies: number; contacts: number }>(
    `select
        (select count(*)::int from signals s join campaign_sources cs on cs.source_id = s.source_id where cs.campaign_id = $1) as trouves,
        (select count(*)::int from signals s join campaign_sources cs on cs.source_id = s.source_id where cs.campaign_id = $1 and s.status in ('qualified', 'enrolled')) as qualifies,
        ${sqlContactsCampagne('$1')} as contacts
      /* jr:entonnoir_sources */`,
    [campagneId],
  );
  const s = sourcesRes.rows[0] ?? { trouves: 0, qualifies: 0, contacts: 0 };
  return { origine: 'sources', trouves: s.trouves, qualifies: s.qualifies, contacts: s.contacts, ...commun };
}

interface LigneEnvoi {
  id: string;
  status: string;
  dispatched_at: string | null;
  /** `actions.delivered_at` (F12) — `null` tant que non réellement parti (ou canal non email). */
  delivered_at: string | null;
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
  /**
   * Objet du gabarit de l'étape (`message_templates.subject`), pour un envoi
   * pas encore parti — `objet` (`a.payload ->> 'subject'`) ne se pose qu'à
   * l'envoi réussi (`email-salesblink.ts`), donc reste `null` pour tout ce qui
   * est `scheduled`/`pending_approval`/`approved`/`blocked` (point 5, tour de
   * correction 5). `null` pour une étape LinkedIn (pas d'objet) ou sans
   * gabarit actif.
   */
  etape_sujet: string | null;
  /** `contacts.job_title` — déjà sur la table jointe, sans coût de plus (revue F5, point 2). */
  job_title: string | null;
  /**
   * `list_members.raw_row`, jointe par INSCRIPTION (`e.list_id`/`e.contact_id`,
   * revue F5, point 2) : alimente les variables `{{liste_<colonne>}}` d'un
   * gabarit encore non parti (« votre recrutement de {{liste_intitule_poste}} »
   * resté brut faute de cette jointure). `null` sans liste pour cette
   * inscription.
   */
  raw_row: Record<string, unknown> | null;
}

/**
 * Objet affiché en « Étape et objet » : celui déjà stocké sur l'action pour un
 * envoi parti, sinon celui du gabarit de l'étape — rendu avec les valeurs déjà
 * en main dans CETTE requête (`construireValeursContact`, revue F5, point 2 :
 * la même fonction qu'à l'envoi réel, pas une version appauvrie — seuls
 * prénom/nom/poste/colonnes de liste sont résolus ici, le compte/la persona/le
 * signal n'étant pas joints dans une requête qui liste beaucoup de lignes à
 * la fois ; jamais une requête de plus par ligne, point 5). Une variable qui
 * reste hors de ce sous-ensemble (`{{entreprise}}`, `{{ville}}`…) reste donc
 * visible telle quelle plutôt que blanchie — `renderTemplatePartial`, pas
 * `renderTemplate` : c'est la vérité de l'envoi à venir, pas un aperçu final.
 */
function objetAffiche(r: LigneEnvoi, extraits: ReadonlyMap<string, string>): string | null {
  if (r.objet !== null) return r.objet;
  if (!r.etape_sujet) return null;
  const ligne: LigneValeursContact = {
    first_name: r.first_name,
    last_name: r.last_name,
    job_title: r.job_title,
    company_name: null,
    city: null,
    headcount: null,
    persona_angle: null,
    signal_title: null,
    signal_location: null,
    signal_url: null,
    context_note: null,
    domain: null,
    postal_code: null,
    country: null,
    signal_occurred_at: null,
    raw_row: r.raw_row,
  };
  return renderTemplatePartial(r.etape_sujet, construireValeursContact(ligne, extraits));
}

function versEnvoiPrevu(r: LigneEnvoi, fuseau: string, extraits: ReadonlyMap<string, string>): EnvoiPrevu {
  const quand = r.dispatched_at ?? r.scheduled_for ?? r.dispatch_after;
  return {
    id: r.id,
    heure: quand ? formatterHeure(quand, fuseau) : null,
    envoye: r.dispatched_at !== null,
    livre: estReellementParti(r.channel, r.dispatched_at, r.delivered_at),
    contactNom: nomComplet(r.first_name, r.last_name),
    // `sequence_steps.position` part de 0 — +1 pour l'affichage (même conversion qu'`aujourdhui.ts`).
    etape: r.etape !== null ? r.etape + 1 : null,
    campagneNom: r.campagne_nom,
    expediteur: r.expediteur,
    canal: canalDe(r.channel),
    etatDetaille: r.status as EnvoiPrevu['etatDetaille'],
    objet: objetAffiche(r, extraits),
    contactId: r.contact_id,
    expediteurId: r.sender_id,
    signalId: r.signal_id,
    raisonEchec: r.block_reason ?? r.error,
  };
}

export interface ContrainteSenderJour {
  /** `senders.daily_quota` — `null` = aucun plafond réglé pour cette boîte, jamais reportée par ce calcul. */
  readonly dailyQuota: number | null;
  readonly usedToday: number;
}

/**
 * Charge, pour chaque boîte email active, son plafond journalier et ce
 * qu'elle a déjà envoyé aujourd'hui (dans le fuseau de l'organisation, pas
 * celui du serveur) — revue F5, point 10 : sert de base à `projeterEnvoisDuJour`.
 */
export async function lireContraintesSendersDuJour(
  ctx: Contexte,
  jour: string,
  fuseau: string,
): Promise<Map<string, ContrainteSenderJour>> {
  const res = await ctx.ex.query<{ sender_id: string; daily_quota: number | null; used_today: number }>(
    `select s.id as sender_id, s.daily_quota,
            (select count(*)::int from actions act
               where act.sender_id = s.id
                 and act.status in ('dispatched', 'delivered')
                 -- Le cast ::date::timestamp avant AT TIME ZONE est nécessaire : sans lui (un
                 -- ::date suivi directement de AT TIME ZONE), Postgres résout le mauvais
                 -- opérateur (celui de timestamptz) et repart du fuseau de LA SESSION, mesuré
                 -- sur la base OSS le 18/09, un comptage du jour qui ratait la quasi-totalité
                 -- des lignes.
                 and act.dispatched_at >= ($1::date::timestamp at time zone $2)
                 and act.dispatched_at < (($1::date + 1)::timestamp at time zone $2)) as used_today
       from senders s /* jr:contraintes_senders_jour */
      where s.organization_id = $3 and s.kind = 'email' and s.is_active`,
    [jour, fuseau, ctx.organisationId],
  );
  return new Map(res.rows.map((r) => [r.sender_id, { dailyQuota: r.daily_quota, usedToday: r.used_today }]));
}

/**
 * Projection de la file du jour (revue F5, point 10) : combien des envois pas
 * encore partis peuvent RÉELLEMENT encore sortir aujourd'hui, compte tenu du
 * plafond journalier restant de LEUR boîte, et combien sont en réalité
 * reportés au prochain créneau (demain matin, le plus souvent) — jusqu'ici le
 * total affiché à l'écran ne distinguait pas les deux, alors que le tick peut
 * créer plus d'actions « prévues aujourd'hui » qu'une boîte n'a de places
 * restantes, la vraie limite n'étant appliquée qu'au moment de l'envoi.
 *
 * Réutilise `allocateWithinQuota` (`packages/core/src/sequencer/quota.js`,
 * déjà écrite pour le moteur mais jusqu'ici jamais appelée) — SANS son volet
 * horaire : le quota horaire se libère chaque heure qui passe, il ne dit rien
 * sur ce qui peut encore sortir d'ici la fin de la journée, seul le quota
 * JOURNALIER borne réellement une projection à cet horizon.
 */
export function projeterEnvoisDuJour(
  prevus: readonly EnvoiPrevu[],
  contraintesParSender: ReadonlyMap<string, ContrainteSenderJour>,
): { readonly possiblesAujourdhui: number; readonly reportesProchainCreneau: number } {
  const parSender = new Map<string, EnvoiPrevu[]>();
  let possibles = 0;
  for (const p of prevus) {
    const c = p.expediteurId ? contraintesParSender.get(p.expediteurId) : undefined;
    if (!c || c.dailyQuota === null) {
      // Pas de plafond suivi pour cette boîte (ou canal sans expéditeur email, ex. LinkedIn/courrier) :
      // jamais reporté par CE calcul.
      possibles++;
      continue;
    }
    const liste = parSender.get(p.expediteurId!) ?? [];
    liste.push(p);
    parSender.set(p.expediteurId!, liste);
  }
  for (const [senderId, liste] of parSender) {
    const c = contraintesParSender.get(senderId)!;
    const { dispatch } = allocateWithinQuota(liste, { dailyQuota: c.dailyQuota!, usedToday: c.usedToday });
    possibles += dispatch.length;
  }
  return { possiblesAujourdhui: possibles, reportesProchainCreneau: prevus.length - possibles };
}

async function lireEnvoisDuJour(
  ctx: Contexte,
  params: { campagneId?: string; jour?: string },
): Promise<{
  envois: EnvoiPrevu[];
  fuseau: string;
  /** Revue F5, point 10 — `null` seulement le temps d'un jour explicitement passé dans le passé/futur (`params.jour`), la projection n'a de sens que pour aujourd'hui. */
  projection: { possiblesAujourdhui: number; reportesProchainCreneau: number } | null;
}> {
  const reglages = await lireReglages(ctx);
  const fuseau = String(reglages.fuseau);
  // Jour calendaire À PARIS (ou le fuseau réglé), pas celui du serveur UTC qui exécute le
  // rendu (I5, revue finale) : entre minuit et l'heure du décalage, l'écran « aujourd'hui »
  // montrait sinon la veille.
  const jourRef = params.jour ?? jourDansFuseau(new Date(), fuseau);
  const estAujourdhui = jourRef === jourDansFuseau(new Date(), fuseau);

  const valeurs: unknown[] = [ctx.organisationId, jourRef, fuseau];
  let filtreCampagne = '';
  if (params.campagneId) {
    valeurs.push(params.campagneId);
    filtreCampagne = ` and e.campaign_id = $${valeurs.length}`;
  }

  const [res, extraitsRes, contraintesParSender] = await Promise.all([
    ctx.ex.query<LigneEnvoi>(
      `select a.id, a.status, a.dispatched_at, a.delivered_at, a.scheduled_for, a.dispatch_after, a.channel,
              a.block_reason, a.error, a.payload ->> 'subject' as objet, a.sender_id,
              c.first_name, c.last_name, c.job_title, c.source_signal_id as signal_id,
              camp.name as campagne_nom, st.position as etape, s.identity as expediteur,
              e.contact_id, mt.subject as etape_sujet, lm.raw_row
         from actions a /* jr:file_du_jour_campagne */
         join enrollments e on e.id = a.enrollment_id
         join campaigns camp on camp.id = e.campaign_id
         left join contacts c on c.id = e.contact_id
         left join sequence_steps st on st.id = a.step_id
         left join senders s on s.id = a.sender_id
         -- Gabarit de l'étape, pour l'objet d'un envoi pas encore parti
         -- (objetAffiche) : une seule jointure ensembliste pour toute la
         -- page, pas une requête par ligne (point 5). mt.is_active suffit à
         -- désigner LA version en vigueur (au plus une par lignée+langue,
         -- uq_message_templates_active_per_family_locale) ; la langue n'est
         -- pas filtrée ici, comme la résolution déjà en place pour l'onglet
         -- Séquence (lireSequence, même limite assumée).
         left join message_templates mt on mt.is_active and coalesce(mt.parent_id, mt.id) = st.template_parent_id
         -- Colonnes du CSV importé (variables liste_<colonne>, revue F5, point 2) : jointe par
         -- INSCRIPTION (e.list_id/e.contact_id), même règle que lireValeursContact — jamais
         -- contacts.source_list_id, une réinscription peut venir d'une autre liste.
         left join list_members lm on lm.list_id = e.list_id and lm.contact_id = e.contact_id
        where camp.organization_id = $1
          and a.status <> 'cancelled'
          -- Cast ::date::timestamp avant AT TIME ZONE nécessaire, même piège que
          -- lireContraintesSendersDuJour ci-dessus (sans lui, mauvaise surcharge AT TIME ZONE,
          -- fuseau de la session au lieu de $3).
          and coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) >= ($2::date::timestamp at time zone $3)
          and coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) < (($2::date + 1)::timestamp at time zone $3)
          ${filtreCampagne}
        order by coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) asc`,
      valeurs,
    ),
    ctx.ex.query<{ name: string; body: string }>(
      `select name, body from message_snippets /* jr:file_du_jour_extraits */ where organization_id = $1`,
      [ctx.organisationId],
    ),
    // Inutile pour un jour passé/futur explicitement demandé (`params.jour`) : la projection
    // « peut encore sortir aujourd'hui » n'a de sens qu'au jour courant.
    estAujourdhui ? lireContraintesSendersDuJour(ctx, jourRef, fuseau) : Promise.resolve(null),
  ]);
  const extraits = new Map(extraitsRes.rows.map((r) => [r.name, r.body]));
  const envois = res.rows.map((r) => versEnvoiPrevu(r, fuseau, extraits));
  const projection = contraintesParSender ? projeterEnvoisDuJour(envois.filter((e) => !e.envoye), contraintesParSender) : null;
  return { envois, fuseau, projection };
}

/**
 * Carte « Sources » de la vue d'ensemble (point 2, constat (x)) : disait
 * « 1 active · Adzuna » alors que la source active était France Travail —
 * `distinct provider_id` collapsait toutes les sources de la campagne
 * (actives ou non) sur un seul fournisseur, au lieu de lister les sources
 * ACTIVES par leur propre nom, comme l'onglet Sources. Une ligne par source
 * active (jamais un fournisseur dédoublonné), triée par nom.
 */
async function listerSourcesCampagneResume(ctx: Contexte, campagneId: string): Promise<SourceResume[]> {
  const res = await ctx.ex.query<{ id: string; nom: string; provider_id: string | null }>(
    `select so.id, so.name as nom, ${SQL_PROVIDER_ID_AFFICHAGE} as provider_id /* jr:sources_campagne_resume */
       from campaign_sources cs
       join sources so on so.id = cs.source_id
      where cs.campaign_id = $1 and so.is_active
      order by so.name asc`,
    [campagneId],
  );
  return res.rows.map((r) => ({ id: r.id, nom: r.nom, providerId: r.provider_id }));
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

  // Résolu avant le reste (pas dans le même `Promise.all`) : `lireEntonnoir` a
  // besoin de `listIds` pour choisir sa forme (point 2) — un aller-retour de
  // plus, mais pas un second aller-retour, `listeSource` ET `listIds` viennent
  // de cette seule requête.
  const { listIds, listeSource } = await lireListeSourceCampagne(ctx, campagneId);

  const [campagne, entonnoir, { envois, projection: projectionFileDuJour }, sources, nombreSources, { evenements }] = await Promise.all([
    lireCampagneEnTete(ctx, campagneId),
    lireEntonnoir(ctx, campagneId, listIds),
    lireEnvoisDuJour(ctx, { campagneId }),
    listerSourcesCampagneResume(ctx, campagneId),
    compterSourcesCampagne(ctx, campagneId),
    listerActivite(ctx, { campagneId, filtre: 'tout', page: 1 }),
  ]);
  const plafonds = await lireConsommationDuJour(ctx);

  return {
    campagne,
    entonnoir,
    projectionFileDuJour,
    fileDuJour: envois,
    plafonds,
    sources,
    nombreSources,
    activite: evenements.slice(0, NOMBRE_EVENEMENTS_APERCU),
    listeSource,
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
  enrollment_id: string | null;
  e_status: string | null;
  stop_reason: string | null;
  resume_at: string | null;
  next_action_at: string | null;
  intitule_poste_liste: string | null;
}

export async function listerContactsCampagne(
  ctx: Contexte,
  entree: unknown,
): Promise<{
  total: number;
  compteurs: Record<StatutContactCampagne | 'tous', number>;
  lignes: ContactCampagne[];
  /** `true` pour une campagne à liste (point 2, issue #120, `campaigns.list_id` posé) — `false` pour une campagne à sources. */
  campagneAListe: boolean;
  /**
   * `true` seulement pour une campagne à liste (`campagneAListe`) DONT la
   * colonne d'intitulé de poste a été trouvée dans le CSV importé
   * (`trouverColonneIntitulePoste`) — la page remplace alors « Pourquoi lui »
   * et « Score » (colonnes toujours vides sans signal) par cet intitulé.
   * `false` pour une campagne à sources ET pour une campagne à liste sans
   * cette colonne (colonnes simplement masquées, sans remplacement —
   * décision page, pas ce module).
   */
  colonnePosteListe: boolean;
}> {
  exiger(ctx, 'viewer');
  const { campagneId, filtre, recherche, page } = valider(schemaListerContacts, entree);

  // I1 (Important, revue finale du 14/09) : ce pool n'a pas de RLS (rôle
  // service, `apps/web/lib/contexte.ts`) — sans ce garde, une campagne d'une
  // autre organisation aurait rendu les noms, postes, entreprises, adresses,
  // scores et statuts de SA population aux trois requêtes ci-dessous, qui ne
  // filtrent que sur `campaign_id`. Vérifié AVANT toute autre requête, jamais
  // contourné par un futur appel MCP direct.
  // Une campagne est « à liste » si une de ses inscriptions porte un
  // `list_id` (`enrollments.list_id`, posé par `ajouterDepuisListe`) — jamais
  // `campaigns.list_id` seul (revue F5, point 1) : une campagne réelle peut
  // n'avoir ni source ni liste à son propre niveau, la liste ne vivant que
  // sur chaque inscription. `list_id_echantillon` sert seulement à choisir
  // UNE ligne de `list_members` pour repérer la colonne d'intitulé de poste
  // (les imports d'une même liste partagent tous les mêmes en-têtes) — la
  // jointure de la requête principale, elle, se corrèle par inscription
  // (`e.list_id`), pas par cette seule liste échantillon.
  const campRes = await ctx.ex.query<{ id: string; list_id_echantillon: string | null }>(
    `select c.id,
            coalesce(
              (select e.list_id from enrollments e where e.campaign_id = c.id and e.list_id is not null limit 1),
              c.list_id
            ) as list_id_echantillon
       from campaigns c /* jr:contacts_campagne_verif */
      where c.id = $1 and c.organization_id = $2`,
    [campagneId, ctx.organisationId],
  );
  if (campRes.rowCount === 0) throw new ErreurIntrouvable('Campagne');
  const listIdEchantillon = campRes.rows[0]?.list_id_echantillon ?? null;
  const campagneAListe = listIdEchantillon !== null;

  // Point 2 (issue #120) : le nom BRUT de la colonne CSV qui désigne un
  // intitulé de poste, cherché une seule fois sur un échantillon de la liste
  // — jamais par ligne, `raw_row ->> $n` ci-dessous réutilise cette même clé
  // pour toutes les lignes de la page.
  let colonnePosteListe: string | null = null;
  if (listIdEchantillon) {
    const echantillonRes = await ctx.ex.query<{ raw_row: Record<string, unknown> | null }>(
      `select raw_row from list_members /* jr:contacts_liste_echantillon */ where list_id = $1 and raw_row is not null limit 1`,
      [listIdEchantillon],
    );
    const brut = echantillonRes.rows[0]?.raw_row;
    if (brut) colonnePosteListe = trouverColonneIntitulePoste(brut);
  }

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
    `select signal_id, contact_id, first_name, last_name, job_title, email, entreprise, current_step, statut, score, pourquoi,
            enrollment_id, e_status, stop_reason, resume_at, next_action_at, intitule_poste_liste
       from (
         select
           s.id as signal_id,
           c.id as contact_id,
           c.first_name, c.last_name, c.job_title, c.email,
           coalesce(ac.name, s.company_hint) as entreprise,
           e.current_step,
           s.score,
           s.title as pourquoi,
           e.enrollment_id, e.status as e_status, e.stop_reason, e.resume_at, e.next_action_at,
           ${CASE_STATUT_DERIVE} as statut,
           -- Point 2 (issue #120) : intitulé de poste de la liste importée, une seule
           -- colonne (repérée une fois plus haut) réutilisée pour toutes les lignes.
           -- Jointure corrélée par INSCRIPTION (e.list_id, revue F5, point 1), jamais
           -- par une seule liste échantillon : deux contacts de la même campagne peuvent
           -- venir de deux listes différentes. Inoffensive quand e.list_id/$6 sont nuls
           -- (campagne à sources) : ne filtre rien, ne produit qu'une colonne vide.
           lm.raw_row ->> $6 as intitule_poste_liste
         ${FROM_POPULATION_CAMPAGNE}
         left join list_members lm on lm.list_id = e.list_id and lm.contact_id = c.id
       ) x /* jr:lignes_contacts_campagne */
      where ($2 = 'tous' or statut = $2)
        and ($3::text is null or first_name ilike $3 or last_name ilike $3 or entreprise ilike $3)
      order by signal_id desc nulls last, contact_id desc
      limit $4 offset $5`,
    [campagneId, filtre, motif, TAILLE_PAGE_CONTACTS, (page - 1) * TAILLE_PAGE_CONTACTS, colonnePosteListe],
  );

  // Requête séparée (pas une sous-requête corrélée par ligne) : une seule campagne pour tout
  // l'appel, le compte d'étapes ne varie pas d'une ligne à l'autre. Placée APRÈS les deux
  // requêtes ci-dessus (et non en tête) : ne change pas ce que `mock.calls[0]` désigne dans
  // les tests déjà écrits contre `compteursRes` en premier appel.
  const totalEtapesRes = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n from sequence_steps /* jr:total_etapes_campagne */ where campaign_id = $1`,
    [campagneId],
  );
  const totalEtapes = totalEtapesRes.rows[0]?.n ?? 0;

  const lignes: ContactCampagne[] = lignesRes.rows.map((r) => ({
    signalId: r.signal_id,
    contactId: r.contact_id,
    nom: nomComplet(r.first_name, r.last_name),
    poste: r.job_title,
    entreprise: r.entreprise,
    email: r.email,
    statut: r.statut,
    etape: etapeAffichee(r.current_step, totalEtapes),
    score: r.score,
    pourquoi: r.pourquoi,
    inscriptionId: r.enrollment_id,
    motifPause: r.statut === 'en_pause' ? motifPauseDe(r.e_status, r.stop_reason) : null,
    repriseLe: r.statut === 'en_pause' ? r.resume_at : null,
    prochainMessageLe: r.statut === 'en_sequence' ? r.next_action_at : null,
    intitulePosteListe: r.intitule_poste_liste,
  }));

  return { total, compteurs, lignes, campagneAListe, colonnePosteListe: colonnePosteListe !== null };
}

// ---------------------------------------------------------------------------
// listerFileDuJour
// ---------------------------------------------------------------------------

export const schemaFileDuJour = z.object({
  campagneId: z.string().uuid().optional(),
  jour: z.string().date().optional(),
});

export async function listerFileDuJour(
  ctx: Contexte,
  entree: unknown,
): Promise<{
  prevus: EnvoiPrevu[];
  partis: EnvoiPrevu[];
  /**
   * Plafond applicable à la file affichée : celui de la campagne (`daily_cap`)
   * si elle en a un, sinon celui de l'organisation. `null` = aucune limite
   * réglée, jamais zéro (voir `lirePlafondEnvois`) : la deuxième copie de ce
   * calcul vivait ici et confondait les deux, alors que son commentaire
   * annonçait « une seule définition ».
   */
  plafondDuJour: number | null;
  /** Revue F5, point 10 — voir `VueDEnsemble.projectionFileDuJour` (même calcul, même sens). */
  projection: { possiblesAujourdhui: number; reportesProchainCreneau: number } | null;
}> {
  exiger(ctx, 'viewer');
  const { campagneId, jour } = valider(schemaFileDuJour, entree);

  const [{ envois, projection }, plafondDuJour] = await Promise.all([
    lireEnvoisDuJour(ctx, { campagneId, jour }),
    (async () => {
      if (!campagneId) return lirePlafondEnvois(ctx);
      const capRes = await ctx.ex.query<{ daily_cap: number | null }>(
        `select daily_cap from campaigns /* jr:file_du_jour_cap */ where id = $1 and organization_id = $2`,
        [campagneId, ctx.organisationId],
      );
      if (capRes.rowCount === 0) throw new ErreurIntrouvable('Campagne');
      return capRes.rows[0]!.daily_cap ?? (await lirePlafondEnvois(ctx));
    })(),
  ]);

  return {
    // F12 : le partage se fait sur le départ RÉEL (`livre`), pas sur la simple remise au
    // transporteur (`envoye`) — un email remis à SalesBlink mais pas encore envoyé reste
    // « prévu », il n'est pas encore « parti ».
    prevus: envois.filter((e) => !e.livre),
    partis: envois.filter((e) => e.livre),
    plafondDuJour,
    projection,
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

interface LigneAuditEvenement {
  id: string;
  /** `audit_events.created_at`, `timestamptz` : `pg` le renvoie en objet `Date`, pas une chaîne (F4, `temps.ts`). */
  created_at: string | Date;
  entity_type: string;
  action: ActionJournal;
  diff: { libelle?: string; detail?: string } | null;
}

function versEvenementAudit(r: LigneAuditEvenement): Evenement {
  return {
    id: r.id,
    // Forme publique honnête (`Evenement.quand: string`) : jamais l'objet `Date` tel quel (F4).
    quand: new Date(r.created_at).toISOString(),
    type: r.action,
    libelle: r.diff?.libelle ?? '',
    detail: r.diff?.detail ?? null,
  };
}

interface LigneEnvoiGroupe {
  /** `date_trunc('hour', a.dispatched_at)`, `timestamptz` : `pg` le renvoie en objet `Date`, pas une chaîne (F4, `temps.ts`). */
  heure: string | Date;
  /** `sequence_steps.position`, 0-based — `null` si l'action n'a plus d'étape rattachée (supprimée). */
  etape: number | null;
  n: number;
  /** Boîtes distinctes ayant servi à ce groupe (`count(distinct a.sender_id)`). */
  boites: number;
}

/**
 * Événements « envois » du fil d'activité (point 3.a, tour de correction 5) :
 * une ligne par (heure, étape), jamais une par email — 110 envois dans une
 * journée feraient sinon 110 lignes. Dérivés directement de `actions`, jamais
 * des `audit_events` individuels (`action_sent`/`action_delivered`, qui
 * restent la source des AUTRES filtres, `ACTIONS_PAR_FILTRE`) : le fil « tout »
 * reste juste même quand le journal du moteur prend du retard ou n'a pas
 * encore été redéployé — seule l'écriture réelle dans `actions` compte.
 * Fonction pure, testée sur des lignes simulées (brief).
 */
export function evenementsEnvoisGroupes(lignes: readonly LigneEnvoiGroupe[]): Evenement[] {
  return lignes.map((r) => {
    // Forme publique honnête (`Evenement.quand: string`), même conversion que `versEvenementAudit`.
    const heureIso = new Date(r.heure).toISOString();
    return {
      id: `envois-${heureIso}-${r.etape ?? 'x'}`,
      quand: heureIso,
      type: 'action_sent',
      // Revue F5, point 4 : plus de texte français construit ici — `donneesEnvois` porte la
      // donnée brute, la page la rend avec une clé ICU dans les trois catalogues.
      libelle: null,
      detail: null,
      // `sequence_steps.position` part de 0 — +1 pour l'affichage (même conversion que partout
      // ailleurs dans ce fichier, ex. `versEnvoiPrevu`).
      donneesEnvois: { n: r.n, etape: r.etape !== null ? r.etape + 1 : null, boites: r.boites },
    };
  });
}

/**
 * Bornes du fil « tout » (point 3) : le total et la pagination sont calculés
 * en mémoire sur ces deux fenêtres bornées, pas sur l'historique complet de la
 * campagne — au-delà, une campagne ancienne verrait `total`/`dernierePage`
 * légèrement sous-évalués plutôt qu'une troisième requête `count(*)` par
 * source à maintenir en plus d'une vraie union SQL. Largement suffisant pour
 * les derniers jours d'activité qu'un opérateur consulte réellement.
 */
const BORNE_AUDIT_TOUT = 300;
const BORNE_ENVOIS_GROUPES_TOUT = 200;

/**
 * Fil « tout » (point 3, tour de correction 5) : unit `audit_events` (actions
 * manuelles, campagne activée/mise en pause, lots de scoring/enrichissement,
 * passages de source, erreurs moteur, réponses reçues, pauses/reprises
 * d'inscription) avec les envois groupés par heure et étape
 * (`evenementsEnvoisGroupes`, dérivés de `actions`) — jamais les
 * `action_sent`/`action_delivered` INDIVIDUELS, qui feraient sinon doublon
 * avec le groupe. Tri et pagination faits ici, sur l'union des deux fenêtres
 * bornées.
 */
async function listerActiviteTout(ctx: Contexte, campagneId: string, page: number): Promise<{ total: number; evenements: Evenement[] }> {
  const [auditRes, groupesRes] = await Promise.all([
    ctx.ex.query<LigneAuditEvenement>(
      `select id, created_at, entity_type, action, diff
         from audit_events /* jr:activite_campagne_tout_audit */
        where organization_id = $2
          and (
            (entity_type = 'campaign' and entity_id = $1::uuid)
            or (entity_type = 'contact' and action in ('reply_received', 'absence_detected', 'enrollment_paused', 'enrollment_resumed') and diff ->> 'campagneId' = $1::text)
            or (action in ('scoring_batch', 'enrichment_batch') and diff ->> 'campagneId' = $1::text)
            or (entity_type = 'source' and action = 'source_run' and entity_id in (select source_id from campaign_sources where campaign_id = $1::uuid))
            or (entity_type = 'engine' and action = 'engine_error')
          )
        order by created_at desc
        limit $3`,
      [campagneId, ctx.organisationId, BORNE_AUDIT_TOUT],
    ),
    ctx.ex.query<LigneEnvoiGroupe>(
      `select date_trunc('hour', a.dispatched_at) as heure, st.position as etape,
              count(*)::int as n, count(distinct a.sender_id)::int as boites
         from actions a /* jr:activite_campagne_tout_envois */
         join enrollments e on e.id = a.enrollment_id
         left join sequence_steps st on st.id = a.step_id
        where e.campaign_id = $1
          and a.status in ('dispatched', 'delivered')
          and a.dispatched_at is not null
        group by 1, 2
        order by 1 desc
        limit $2`,
      [campagneId, BORNE_ENVOIS_GROUPES_TOUT],
    ),
  ]);

  // `comparerInstantsDesc` (F4, `temps.ts`), jamais une comparaison de chaînes brute : `quand`
  // est ici déjà une chaîne ISO canonique (conversion faite par `versEvenementAudit`/
  // `evenementsEnvoisGroupes`), mais l'utilitaire reste la référence du projet pour cette
  // comparaison — départage déterministe par `id` à instant égal.
  const tous = [...auditRes.rows.map(versEvenementAudit), ...evenementsEnvoisGroupes(groupesRes.rows)].sort(
    (a, b) => comparerInstantsDesc(a.quand, b.quand) || b.id.localeCompare(a.id),
  );

  const debut = (page - 1) * TAILLE_PAGE_ACTIVITE;
  return { total: tous.length, evenements: tous.slice(debut, debut + TAILLE_PAGE_ACTIVITE) };
}

export async function listerActivite(ctx: Contexte, entree: unknown): Promise<{ total: number; evenements: Evenement[] }> {
  exiger(ctx, 'viewer');
  const { campagneId, filtre, page } = valider(schemaActivite, entree);

  if (filtre === 'tout') return listerActiviteTout(ctx, campagneId, page);

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
  const actionsFiltre = ACTIONS_PAR_FILTRE[filtre];
  if (actionsFiltre) {
    params.push(actionsFiltre);
    where += ` and action = any($${params.length}::text[])`;
  }

  const totalRes = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n from audit_events /* jr:activite_campagne_total */ where ${where}`,
    params,
  );

  const paramsPage = [...params, TAILLE_PAGE_ACTIVITE, (page - 1) * TAILLE_PAGE_ACTIVITE];
  const res = await ctx.ex.query<LigneAuditEvenement>(
    `select id, created_at, entity_type, action, diff
       from audit_events /* jr:activite_campagne */
      where ${where}
      order by created_at desc
      limit $${paramsPage.length - 1} offset $${paramsPage.length}`,
    paramsPage,
  );

  return { total: totalRes.rows[0]?.n ?? 0, evenements: res.rows.map(versEvenementAudit) };
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

  const themes = entryKind === 'source' ? (sourceIds ?? [entryId]) : [];
  if (themes.length > 0) {
    // Un post d'engageurs déjà relié à une campagne ne se rattache pas à une seconde (règle posée aussi dans `creerSource`).
    const postsRes = await ctx.ex.query<{ id: string; url: string | null }>(
      `select id, config->>'urlPost' as url from sources /* jr:creer_campagne_posts */
        where organization_id = $1 and id = any($2::uuid[]) and config->>'sourceType' = 'linkedin_post_engagers'`,
      [ctx.organisationId, themes],
    );
    for (const p of postsRes.rows) {
      if (p.url) await exigerPostLibre(ctx, p.url, { campagneId: null, sourceId: null });
    }
  }

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
        // `credentials_public` filtre sur `app.user_orgs()` (donc `auth.uid()`),
        // vide côté serveur : `ctx.ex` est un pool de service sans session
        // Supabase Auth. On lit la table directement, avec le même filtre par
        // organisation que la vue, sans jamais sélectionner `secret`.
        `select status from credentials /* jr:manques_cle */ where organization_id = $1 and provider_id = 'salesblink'`,
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
