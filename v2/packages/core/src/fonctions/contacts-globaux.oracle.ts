/**
 * Référence « ancienne implémentation » de la population globale des contacts (lot 2, P4) :
 * le calcul tel qu'il était avant d'être confié à Postgres — une requête de population et un
 * comptage d'étapes par campagne, en série, puis fusion, tri, dédoublonnage et plafonnement en
 * mémoire. Conservé comme ORACLE du test `contacts-globaux.pg.test.ts`, qui le compare à la
 * requête unique sur une vraie base. Ne sert à aucun chemin de production.
 */
import { comparerInstantsDesc } from '../temps.js';
import type { Contexte } from './contexte.js';
import { CASE_STATUT_DERIVE, etapeAffichee, FROM_POPULATION_CAMPAGNE, motifPauseDe, type StatutContactCampagne } from './campagnes.js';
import type { ContactGlobal } from './contacts.js';

function nomComplet(prenom: string | null, nom: string | null): string {
  return `${prenom ?? ''} ${nom ?? ''}`.trim() || '—';
}

function motifRecherche(recherche: string | undefined): string | null {
  if (!recherche) return null;
  return `%${recherche.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const LIMITE_CONTACTS_GLOBAL = 5000;
const LIMITE_COLLECTE_GLOBALE = LIMITE_CONTACTS_GLOBAL + 1;

interface LigneContactGlobalBrut {
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
  provider_id: string | null;
  /** `coalesce(s.occurred_at, e.started_at)`, `timestamptz` : `pg` le renvoie en objet `Date`, pas une chaîne. */
  quand: string | Date | null;
  enrollment_id: string | null;
  e_status: string | null;
  stop_reason: string | null;
  resume_at: string | null;
  next_action_at: string | null;
}

/** Campagnes ciblées par `listerContacts`/`exporterCsv` : une seule (filtre `campagneId`) ou toutes celles de l'organisation. */
async function campagnesCiblees(ctx: Contexte, campagneId: string | undefined): Promise<{ id: string; nom: string }[]> {
  if (campagneId) {
    const r = await ctx.ex.query<{ id: string; nom: string }>(
      `select id, name as nom from campaigns /* jr:contacts_globale_campagne_unique */ where id = $1 and organization_id = $2`,
      [campagneId, ctx.organisationId],
    );
    return r.rows;
  }
  const r = await ctx.ex.query<{ id: string; nom: string }>(
    `select id, name as nom from campaigns /* jr:contacts_globale_campagnes */ where organization_id = $1 order by name asc`,
    [ctx.organisationId],
  );
  return r.rows;
}

export interface FiltresContactsGlobal { filtre: string; campagneId?: string | undefined; source?: string | undefined; email?: string | undefined; recherche?: string | undefined }

/**
 * Population « toutes campagnes » : rejoue `CASE_STATUT_DERIVE`/
 * `FROM_POPULATION_CAMPAGNE` (exportés par `campagnes.ts`, tâche 10) UNE FOIS
 * PAR CAMPAGNE de l'organisation (`$1` = son id, exactement comme
 * `listerContactsCampagne`), puis fusionne et trie en mémoire — plutôt que de
 * généraliser ces requêtes à un `$1` = organisation : `FROM_POPULATION_CAMPAGNE`
 * suppose une seule campagne (la lecture d'inscription en LATERAL la
 * présuppose), la réécrire aurait dupliqué sa logique de statut au lieu de la
 * réutiliser telle quelle. Coût : une requête de lignes + une de comptage
 * d'étapes par campagne — acceptable à l'échelle d'une organisation
 * autohébergée (quelques campagnes), plafonné par `LIMITE_CONTACTS_GLOBAL`.
 */
export interface ResultatContactsGlobaux {
  readonly lignes: ContactGlobal[];
  /** `true` quand la collecte a atteint `LIMITE_CONTACTS_GLOBAL` (5 000) — davantage de contacts existent que ceux renvoyés. */
  readonly tronque: boolean;
}

export async function collecterContactsGlobauxAncien(ctx: Contexte, filtres: FiltresContactsGlobal): Promise<ResultatContactsGlobaux> {
  const { filtre, campagneId, source, email, recherche } = filtres;
  const campagnes = await campagnesCiblees(ctx, campagneId);
  if (campagnes.length === 0) return { lignes: [], tronque: false };

  const motif = motifRecherche(recherche);
  // `nombreCampagnes` n'est connu qu'après dédoublonnage (plus loin) : chaque ligne brute
  // collectée ici vient d'exactement une campagne, elle ne le porte pas encore.
  const toutes: (Omit<ContactGlobal, 'nombreCampagnes'> & { quand: string | Date | null })[] = [];

  for (const campagne of campagnes) {
    if (toutes.length >= LIMITE_COLLECTE_GLOBALE) break;

    const res = await ctx.ex.query<LigneContactGlobalBrut>(
      `select signal_id, contact_id, first_name, last_name, job_title, email, entreprise, current_step, statut, score, pourquoi, provider_id, quand,
              enrollment_id, e_status, stop_reason, resume_at, next_action_at
         from (
           select
             s.id as signal_id,
             c.id as contact_id,
             c.first_name, c.last_name, c.job_title, c.email,
             coalesce(ac.name, s.company_hint) as entreprise,
             e.current_step,
             s.score,
             s.title as pourquoi,
             s.provider_id,
             coalesce(s.occurred_at, e.started_at) as quand,
             e.enrollment_id, e.status as e_status, e.stop_reason, e.resume_at, e.next_action_at,
             ${CASE_STATUT_DERIVE} as statut
           ${FROM_POPULATION_CAMPAGNE}
         ) x /* jr:lignes_contacts_globale */
        where ($2 = 'tous' or statut = $2)
          and ($3::text is null or first_name ilike $3 or last_name ilike $3 or entreprise ilike $3)
          and ($4::text is null or provider_id = $4 or ($4 = 'manuel' and signal_id is null))
          and ($5::text is null or ($5 = 'verifie' and email is not null) or ($5 = 'a_trouver' and email is null))
        order by quand desc nulls last, contact_id desc`,
      [campagne.id, filtre, motif, source ?? null, email ?? null],
    );
    if (res.rows.length === 0) continue;

    const totalEtapesRes = await ctx.ex.query<{ n: number }>(
      `select count(*)::int as n from sequence_steps /* jr:total_etapes_campagne */ where campaign_id = $1`,
      [campagne.id],
    );
    const totalEtapes = totalEtapesRes.rows[0]?.n ?? 0;

    for (const r of res.rows) {
      toutes.push({
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
        // Onglet Contacts GLOBAL (mélange campagnes à sources et à liste, point 2) : la
        // colonne d'intitulé de poste d'une liste n'a de sens que sur la page d'UNE
        // campagne (`listerContactsCampagne`), jamais ici.
        intitulePosteListe: null,
        campagneId: campagne.id,
        campagneNom: campagne.nom,
        quand: r.quand,
      });
      if (toutes.length >= LIMITE_COLLECTE_GLOBALE) break;
    }
  }

  // `quand` (`timestamptz`, cf. `LigneContactGlobalBrut`) : `comparerInstantsDesc`
  // accepte chaîne ou `Date`. Départage par `contactId` (desc), même critère que
  // le `order by quand desc nulls last, contact_id desc` de chaque requête par
  // campagne — nécessaire ici car cette fusion mélange plusieurs campagnes.
  toutes.sort((a, b) => comparerInstantsDesc(a.quand, b.quand) || (b.contactId ?? '').localeCompare(a.contactId ?? ''));

  // Dédoublonnage par contact (tour de correction G4) : un contact candidat ("à
  // contacter") ou inscrit dans plusieurs campagnes à la fois traversait cette boucle une
  // fois par campagne — 938 lignes pour 370 contacts distincts, mesuré le 18/09 sur la base
  // OSS (2 contacts seulement réellement inscrits dans plus d'une campagne, le reste vient
  // de candidats à plusieurs campagnes). `toutes` est déjà triée du plus récent au plus
  // ancien : la première occurrence d'un contact est donc SA ligne la plus récente — elle
  // porte le statut/étape/action affichés, les occurrences suivantes n'alimentent que le
  // compte de campagnes (`nombreCampagnes`). Un `Map` préserve l'ordre d'insertion, donc
  // l'ordre trié survit au dédoublonnage sans second tri.
  const premiereLigneParContact = new Map<string, Omit<ContactGlobal, 'nombreCampagnes'> & { quand: string | Date | null }>();
  const campagnesParContact = new Map<string, Map<string, string>>();
  for (const ligne of toutes) {
    // `contactId` est toujours renseigné par `FROM_POPULATION_CAMPAGNE` (jointure interne
    // sur `contacts`) — le repli ci-dessous ne sert qu'à ne jamais fusionner par erreur des
    // lignes distinctes si cette garantie venait à changer un jour.
    const cle = ligne.contactId ?? `${ligne.campagneId}:${ligne.signalId ?? ''}`;
    let campagnes = campagnesParContact.get(cle);
    if (!campagnes) {
      campagnes = new Map();
      campagnesParContact.set(cle, campagnes);
      premiereLigneParContact.set(cle, ligne);
    }
    campagnes.set(ligne.campagneId, ligne.campagneNom);
  }
  const dedupliquees = [...premiereLigneParContact.entries()].map(([cle, ligne]) => ({
    ...ligne,
    nombreCampagnes: campagnesParContact.get(cle)!.size,
  }));

  const tronque = dedupliquees.length > LIMITE_CONTACTS_GLOBAL;
  const bornees = tronque ? dedupliquees.slice(0, LIMITE_CONTACTS_GLOBAL) : dedupliquees;
  return { lignes: bornees.map(({ quand: _quand, ...reste }) => reste), tronque };
}
