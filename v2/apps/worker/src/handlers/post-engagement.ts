/**
 * Le chemin « personne » : un engageur d'un post LinkedIn devient un signal de
 * kind `post_engagement` ET un contact, sans passer par l'entreprise.
 *
 * Les autres signaux disent une entreprise : le scoring la juge, puis
 * l'enrichissement cherche les personnes qui y travaillent et crée les
 * contacts. Un engageur est l'inverse, une personne déjà identifiée sans
 * entreprise fiable. On crée donc le contact tout de suite, avec la persona de
 * la campagne et le signal pour origine : c'est ce que `enqueueEnrollments`
 * lit (source_signal_id, persona acceptée, score du signal).
 *
 * Le worker utilise la clé de service (bypass RLS) : chaque requête filtre par
 * organisation.
 */
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  dansUneTransaction,
  identifiantMembre,
  lienProfilDeduit,
  normaliserUrlPost,
  normaliserUrlProfil,
  type Executeur,
} from '@jay-reach/core';

export type Engageur = {
  urn: string;
  nom: string;
  intitule: string;
  entreprise?: string;
  /**
   * Adresse publique du profil (`/in/<nom public>`), quand le collecteur la lit
   * dans la réponse Voyager. Sans elle, `lienProfil` en déduit une de l'URN.
   */
  urlProfil?: string;
};

export type IssueEngageur = 'nouveau' | 'doublon' | 'deja_en_campagne' | 'ecarte' | 'supprime';

/**
 * Validation à l'entrée : un `urn` vide donnerait la même adresse de profil à
 * tout le monde (collisions de contacts, signaux sans contact), un nom vide un
 * contact anonyme. Le collecteur doit écarter ce qui ne passe pas ce schéma.
 */
export const engageurSchema = z.object({
  urn: z
    .string()
    .refine((v) => v.startsWith('urn:li:') && (v.split(':').pop() ?? '').trim().length > 0, {
      message: 'urn LinkedIn attendu (urn:li:<type>:<identifiant>)',
    }),
  nom: z.string().trim().min(1),
  intitule: z.string(),
  entreprise: z.string().optional(),
  urlProfil: z.string().optional(),
}) satisfies z.ZodType<Engageur>;

/** Ce que l'enregistrement a besoin de connaître du passage en cours. */
export interface ContexteEngageur {
  readonly pool: Pool;
  readonly organizationId: string;
  /** Source d'engageurs qui porte le signal (sources.id). */
  readonly sourceId: string;
  /**
   * Passage de collecte en cours, OBLIGATOIRE : c'est lui que l'écart par le
   * scoring incrémentera. Le champ est requis EXPRÈS — s'il était optionnel, un
   * collecteur qui oublierait de le passer rendrait le compteur d'écarts muet,
   * sans aucune erreur. Le collecteur doit donc fournir la valeur.
   */
  readonly sourceRunId: string;
}

// `identifiantMembre` et `lienProfilDeduit` vivent dans le cœur (voir `sources.ts`) :
// l'opposition (`nePlusContacter`) doit fabriquer la même graphie que la collecte.
export { lienProfilDeduit };

// `normaliserUrlProfil` vit dans le cœur : les trois chemins qui écrivent une
// adresse de profil (ce collecteur, l'enrichissement, l'import de fichier)
// doivent s'accorder sur la même forme, sinon la même personne existe deux fois.

/** L'adresse que la réponse Voyager a fournie, quand elle est exploitable. */
function adresseFournie(engageur: Pick<Engageur, 'urlProfil'>): string | null {
  return engageur.urlProfil ? normaliserUrlProfil(engageur.urlProfil) : null;
}

/**
 * Cet engageur sera-t-il enregistré sous l'adresse DÉDUITE de son URN, que ni LinkedIn ni
 * FullEnrich ne résolvent ? Même règle que `lienProfil`, qui s'appuie sur elle : le chiffre
 * que la collecte compte (`source_runs.adresses_deduites`, la part d'intitulés exploitables
 * de la spec) ne peut pas diverger de ce qui est réellement écrit.
 */
export function adresseDeduite(engageur: Pick<Engageur, 'urlProfil'>): boolean {
  return adresseFournie(engageur) === null;
}

/** L'adresse fournie quand elle est exploitable, le repli déduit sinon. */
export function lienProfil(engageur: Pick<Engageur, 'urn' | 'urlProfil'>): string {
  return adresseFournie(engageur) ?? lienProfilDeduit(engageur.urn);
}

function separerNom(nom: string): { prenom: string | null; nomFamille: string | null } {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  const [prenom, ...reste] = mots;
  return { prenom: prenom ?? null, nomFamille: reste.length > 0 ? reste.join(' ') : null };
}

const STATUTS_VIVANTS = ['active', 'paused', 'paused_absence'];

export async function enregistrerEngageur(
  ctx: ContexteEngageur,
  entree: Engageur,
  campagne: { id: string; personaId: string },
  urlPost: string,
): Promise<IssueEngageur> {
  const engageur = engageurSchema.parse(entree);
  const { pool, organizationId: org } = ctx;
  // Normalisée ICI : l'unicité d'un engageur ne doit pas dépendre de la forme
  // sous laquelle l'appelant écrit l'adresse du post.
  const externalId = `${normaliserUrlPost(urlPost)}:${engageur.urn}`;
  const url = lienProfil(engageur);
  const membre = identifiantMembre(engageur.urn);

  // 0) Sur la liste de suppression : refusé DÈS LA COLLECTE, sur l'adresse de profil.
  //    Ne pas attendre l'envoi : la personne a demandé à ne plus être contactée,
  //    la garder (nom, intitulé, adresse), la scorer et l'enrichir (un achat) serait
  //    encore la traiter. Les deux formes de l'adresse (fournie, déduite de l'URN)
  //    sont testées, et la casse ne compte pas.
  // Les deux formes partent BRUTES : c'est le SQL qui normalise les deux côtés, pour qu'une
  // seule implémentation de « c'est la même adresse » décide (migration 20261008170000).
  const formes = [...new Set([url, lienProfilDeduit(engageur.urn)])];
  const supprime = await pool.query(
    `select 1 as one from suppressions
      where organization_id = $1 and scope = 'linkedin'
        and (expires_at is null or expires_at > now())
        and app.url_linkedin_normalisee(value)
            = any(select app.url_linkedin_normalisee(f) from unnest($2::text[]) as f)
      limit 1`,
    [org, formes],
  );
  if (supprime.rows.length > 0) return 'supprime';

  // 1) Déjà écarté par le scoring : ni recréé, ni rescoré, donc jamais repayé.
  const ecarte = await pool.query(
    `select 1 as one from linkedin_engageurs_ecartes where organization_id = $1 and external_id = $2`,
    [org, empreinteEngageur(externalId)],
  );
  if (ecarte.rows.length > 0) return 'ecarte';

  // 2) Même personne, même post : déjà vue.
  const connu = await pool.query(
    `select id from signals where organization_id = $1 and external_id = $2 and kind = 'post_engagement'`,
    [org, externalId],
  );
  if (connu.rows.length > 0) return 'doublon';

  // 3) Déjà dans une séquence vivante (par un autre post, ou un signal d'entreprise),
  //    reconnue par son adresse OU par son identifiant de membre.
  const inscrit = await pool.query(
    `select 1 as one
       from enrollments e
       join contacts c on c.id = e.contact_id
      where c.organization_id = $1 and (c.linkedin_url = $2 or c.linkedin_provider_id = $4)
        and e.status = any($3::enrollment_status[])
      limit 1`,
    [org, url, STATUTS_VIVANTS, membre],
  );
  if (inscrit.rows.length > 0) return 'deja_en_campagne';

  const { prenom, nomFamille } = separerNom(engageur.nom);

  // Un contact peut déjà exister, né d'un signal d'entreprise, avec son email :
  // on le RATTACHE. Il garde son email et son signal d'origine (l'historique de
  // ses messages en dépend) ; il ne reçoit que ce qui lui manque.
  const existant = await pool.query<{ id: string; source_signal_id: string | null }>(
    `select id, source_signal_id from contacts
      where organization_id = $1 and (linkedin_url = $2 or linkedin_provider_id = $3)
      order by (linkedin_url = $2) desc nulls last
      limit 1`,
    [org, url, membre],
  );
  const contact = existant.rows[0];

  const rattacher = async (signalId: string | null): Promise<void> => {
    if (!contact) return;
    try {
      await pool.query(
        `update contacts set
            linkedin_url = coalesce(linkedin_url, $3),
            linkedin_provider_id = coalesce(linkedin_provider_id, $4),
            persona_id = coalesce(persona_id, $5),
            first_name = coalesce(first_name, $6),
            last_name = coalesce(last_name, $7),
            job_title = coalesce(job_title, $8),
            -- L'origine existante est préservée ; un VIDE (import manuel, signal
            -- d'origine effacé) est comblé, sinon le contact ne serait jamais
            -- inscriptible (enqueueEnrollments joint sur source_signal_id).
            source_signal_id = coalesce(source_signal_id, $9)
          where id = $2 and organization_id = $1`,
        [org, contact.id, url, membre, campagne.personaId, prenom, nomFamille, engageur.intitule, signalId],
      );
    } catch (err) {
      // 23505 : l'adresse est déjà portée par un autre contact. On ne fusionne pas
      // deux fiches ici ; le contact rattaché garde ce qu'il a.
      if ((err as { code?: string }).code !== '23505') throw err;
    }
  };

  // Son signal d'origine existe : c'est lui qui porte l'inscription. Un second
  // signal ne porterait rien et serait scoré, donc payé, pour rien. On complète
  // la fiche et on rend `doublon` : la personne est déjà connue.
  if (contact && contact.source_signal_id !== null) {
    await rattacher(null);
    return 'doublon';
  }

  // 4) Nouveau : le signal est créé SANS raw (rien de plus que ce qui sert).
  const signal = await pool.query<{ id: string }>(
    `insert into signals
       (organization_id, source_id, source_run_id, provider_id, external_id, kind, occurred_at, title, url, status)
     values ($1, $2, $6, 'linkedin', $3, 'post_engagement', now(), $4, $5, 'new')
     on conflict (organization_id, external_id) where kind = 'post_engagement' do nothing
     returning id`,
    [org, ctx.sourceId, externalId, engageur.intitule, urlPost, ctx.sourceRunId],
  );
  const signalId = signal.rows[0]?.id;
  if (!signalId) return 'doublon'; // course : un autre passage vient de l'insérer

  if (contact) {
    await rattacher(signalId);
    return 'nouveau';
  }

  await pool.query(
    `insert into contacts
       (organization_id, persona_id, first_name, last_name, job_title,
        linkedin_url, linkedin_provider_id, source_signal_id, enrichment)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     on conflict (organization_id, linkedin_url) where linkedin_url is not null do nothing`,
    [
      org,
      campagne.personaId,
      prenom,
      nomFamille,
      engageur.intitule,
      url,
      membre,
      signalId,
      // L'entreprise lue dans l'intitulé reste un texte libre, sans identifiant.
      JSON.stringify({ entreprise: engageur.entreprise ?? null }),
    ],
  );
  return 'nouveau';
}

/**
 * Un morceau de SQL qui vient du code et jamais d'une donnée : le type nominal
 * interdit de passer une chaîne quelconque à `sqlPersonneContactee`, qui la
 * concatène. On ne le fabrique qu'avec un littéral écrit dans le code.
 */
export type FragmentSql = string & { readonly __fragmentSql: true };
export const PARAM_ORG = '$1' as FragmentSql;
export const PARAM_SIGNAL = '$2' as FragmentSql;

/**
 * « L'adresse LinkedIn de ce contact est celle d'une personne qu'on peut chercher » : le contact
 * n'est pas né d'un URN (`linkedin_provider_id` vide), ou son adresse n'est pas celle que
 * `lienProfilDeduit` fabrique pour son identifiant. Une adresse déduite se dédoublonne mais ne se
 * résout pas : FullEnrich la refuse, donc l'enrichissement n'achète pas (`raisonDeNePasAcheter`).
 *
 * UNE définition, partagée par l'enrichissement (`enqueueEnrichmentContactsConnus`) et par le
 * scoring (`conditionSourceScorable`) : le scoring paie des jetons, et les payer pour une personne
 * que l'enrichissement refusera en SQL est la définition d'un coût payé pour rien. Deux copies
 * auraient fini par diverger.
 *
 * @param contact    alias SQL du contact (`c`)
 * @param prefixeDeduit paramètre SQL qui porte `lienProfilDeduit('')`, le préfixe nu des adresses déduites
 */
export function sqlAdresseResolvable(contact: FragmentSql, prefixeDeduit: FragmentSql): string {
  return `(${contact}.linkedin_provider_id is null or ${contact}.linkedin_url <> ${prefixeDeduit} || ${contact}.linkedin_provider_id)`;
}

/**
 * « Cette campagne a une séquence CONNUE, et cette séquence n'envoie aucun email. »
 *
 * Trois étages décident quelque chose à partir de l'adresse email d'un engageur, et les trois
 * se trompaient de la même façon : ils posaient leur règle sans regarder par quel canal la
 * campagne écrit. Pour un engageur, l'adresse ne vient JAMAIS — ni LinkedIn ni FullEnrich ne la
 * résolvent quand le profil n'a livré qu'un URN. Une campagne 100 % LinkedIn était donc stérile
 * pour toujours, alors que l'URN suffit à lui écrire.
 *
 *  - le SCORING ne payait pas de jetons pour une adresse déduite (`conditionSourceScorable`) ;
 *  - l'INSCRIPTION n'inscrivait pas un contact sans email (`enqueueEnrollments`) ;
 *  - l'ENRICHISSEMENT achetait une adresse dont personne n'avait besoin
 *    (`enqueueEnrichmentContactsConnus`).
 *
 * La séquence doit EXISTER : une campagne sans aucune étape ne dit pas par quel canal elle
 * écrira, et la traiter comme « 100 % LinkedIn » ferait scorer, inscrire et contacter à
 * l'aveugle. Une définition unique plutôt que trois copies — elles auraient divergé, et les
 * trois étages doivent isoler exactement le même ensemble de personnes.
 *
 * @param campagne alias ou expression SQL qui donne l'id de la campagne (`c.id`)
 */
export function sqlCampagneSansEmail(campagne: FragmentSql): string {
  return `(exists (select 1 from public.sequence_steps st where st.campaign_id = ${campagne})
            and not exists (select 1 from public.sequence_steps st
                             where st.campaign_id = ${campagne} and st.channel = 'email'))`;
}

/**
 * La même question, posée à l'échelle d'une SOURCE : toutes les campagnes qui l'utilisent ont
 * une séquence connue, et aucune n'envoie d'email. Le scoring et l'enrichissement partent d'un
 * signal, qui connaît sa source mais pas sa campagne ; une source partagée par deux campagnes
 * dont l'une écrit des emails garde donc le comportement d'origine — il faudra une adresse.
 *
 * @param source alias ou expression SQL qui donne l'id de la source (`s.source_id`)
 */
export function sqlSourceSansEmail(source: FragmentSql): string {
  const jointure = `from public.campaign_sources cs
                      join public.sequence_steps st on st.campaign_id = cs.campaign_id
                     where cs.source_id = ${source}`;
  return `(exists (select 1 ${jointure})
            and not exists (select 1 ${jointure} and st.channel = 'email'))`;
}

/** Empreinte (sha256 hexadécimal) d'un `external_id` : ce que `linkedin_engageurs_ecartes` stocke. */
export function empreinteEngageur(externalId: string): string {
  return createHash('sha256').update(externalId, 'utf8').digest('hex');
}

/**
 * « Cette personne a été contactée à cause de cet engageur », en SQL : une
 * expression booléenne, partagée par la purge (qui l'exclut de sa sélection) et par
 * `ecarterEngageur` (qui refuse de détruire). Une seule définition : deux copies
 * auraient fini par diverger, et la divergence se paie par une personne effacée.
 *
 * Contactée = une inscription portée par le signal, ou une inscription / un fil de
 * messages sur le contact NÉ de cet engageur. Un contact ANTÉRIEUR au signal (liste
 * importée, migration v1) n'en est pas né : il a été contacté pour une autre
 * raison, sa fiche est protégée plus bas (le détachement), le signal peut partir.
 *
 * @param org      expression SQL de l'organisation (`$1`, `s.organization_id`)
 * @param signal   expression SQL de l'id du signal
 * @param occurred expression SQL de la date du signal
 */
export function sqlPersonneContactee(org: FragmentSql, signal: FragmentSql, occurred: FragmentSql): string {
  return `(
         exists (select 1 from enrollments en where en.organization_id = ${org} and en.signal_id = ${signal})
         or exists (select 1 from contacts c join enrollments en on en.contact_id = c.id
                     where c.organization_id = ${org} and c.source_signal_id = ${signal} and c.created_at >= ${occurred})
         or exists (select 1 from contacts c join threads t on t.contact_id = c.id
                     where c.organization_id = ${org} and c.source_signal_id = ${signal} and c.created_at >= ${occurred})
       )`;
}

/** `absent` : le signal n'existe plus (ou n'est pas de cette organisation), rien n'a été touché. */
export type IssueEffacement = 'efface' | 'conserve' | 'absent';

/**
 * Efface un engageur : son signal et le contact né de ce signal. On ne garde pas
 * de données personnelles sur ce qui ne sert pas.
 *
 * Deux effets indépendants, à ne pas confondre :
 *  - `juge` (défaut `true`) commande la MÉMOIRE : l'external_id est écrit dans
 *    `linkedin_engageurs_ecartes` pour que le collecteur ne recrée pas, ne
 *    rescore pas, donc ne repaie pas ce qu'on a déjà jugé. `juge: false` =
 *    effacé AVANT jugement (péremption) : rien n'a été évalué, la personne peut
 *    être recollectée plus tard.
 *  - `compter` (défaut : la valeur de `juge`) commande le COMPTEUR
 *    `source_runs.ecartes` du passage qui a collecté la personne. Il ne vaut que
 *    pour un écart constaté PENDANT la vie de ce passage — le scoring. Un
 *    engageur effacé des semaines plus tard par la purge d'ancienneté a été jugé
 *    (il mérite la mémoire) mais son passage est clos depuis longtemps :
 *    l'incrémenter ferait bouger rétroactivement le chiffre d'un passage
 *    terminé, et le rendement comparé des sources se lirait sur un nombre faux.
 *
 * Les écritures se font dans UNE transaction : une coupure ne laisse ni un
 * engageur effacé sans mémoire d'écart (recréé et repayé), ni l'inverse.
 *
 * Trois issues, dites par la valeur rendue :
 *  - `'efface'` : le signal (et, s'il en est né, le contact) a été détruit ;
 *  - `'conserve'` : la personne est CONTACTÉE (inscription ou fil de messages), rien n'est
 *    détruit (voir la garde et les verrous en tête de la transaction) ;
 *  - `'absent'` : le signal n'existe plus ou n'est pas de cette organisation, rien n'a été touché.
 *
 * L'effacement du contact est GARDÉ (voir le `delete` ci-dessous) : seule une
 * fiche que cet engageur a réellement créée part. Une fiche qui préexistait, qui
 * appartient à une liste importée, ou à qui on a déjà écrit, est conservée et
 * simplement détachée de son signal.
 */
export async function ecarterEngageur(
  pool: Pool,
  organizationId: string,
  signalId: string,
  opts: { juge?: boolean; compter?: boolean } = {},
): Promise<IssueEffacement> {
  const juge = opts.juge ?? true;
  const compter = opts.compter ?? juge;
  return dansUneTransaction(pool as unknown as Executeur, async (tx): Promise<IssueEffacement> => {
    // VERROUS d'abord : les contacts nés du signal, PUIS le signal. Une inscription ou
    // un fil qui se crée en même temps prend un verrou partagé sur la ligne du contact
    // (clé étrangère) : il attend la fin de cette transaction au lieu de passer entre
    // la lecture de la garde et la suppression. Les `delete` ci-dessous portent en
    // plus leurs propres conditions, mais ce sont ces verrous qui tiennent (voir le
    // harnais : sans eux, une inscription validée pendant l'effacement est détruite).
    //
    // L'ORDRE est contact puis signal, et il n'est pas libre : l'insertion d'une
    // inscription qui porte `contact_id` ET `signal_id` verrouille ses deux clés
    // étrangères dans cet ordre (mesuré par le harnais). Verrouiller le signal d'abord
    // croiserait les deux transactions : interblocage, dont Postgres sacrifie l'une
    // ou l'autre, la purge comprise.
    await tx.query(
      `select id from contacts where organization_id = $1 and source_signal_id = $2 order by id for update`,
      [organizationId, signalId],
    );
    const verrouille = await tx.query<{ external_id: string }>(
      `select external_id from signals
        where id = $2 and organization_id = $1 and kind = 'post_engagement' for update`,
      [organizationId, signalId],
    );
    const externalId = verrouille.rows[0]?.external_id;
    if (externalId === undefined) return 'absent'; // déjà parti, ou d'une autre organisation : rien n'a été fait

    // Mémoire d'écart : une EMPREINTE de l'identifiant, jamais l'URN lisible. Cette
    // table n'est qu'un cache d'économie (ne pas rescorer, donc ne pas repayer) :
    // un seul lecteur, par égalité exacte. Elle est bornée par la purge de rétention.
    const poserMemoire = async (): Promise<void> => {
      if (!juge) return;
      await tx.query(
        `insert into linkedin_engageurs_ecartes (organization_id, external_id) values ($1, $2)
         on conflict do nothing`,
        [organizationId, empreinteEngageur(externalId)],
      );
    };
    // La personne est contactée : on ne détruit rien. Le signal est seulement marqué
    // écarté s'il attendait encore son jugement, pour que le scoring ne le reprenne
    // pas (et ne le repaie pas) à chaque cycle ; le contact n'est pas touché.
    const conserver = async (): Promise<'conserve'> => {
      await poserMemoire();
      await tx.query(
        `update signals set status = 'discarded', discard_reason = 'contacted', scored_at = coalesce(scored_at, now())
          where id = $2 and organization_id = $1 and kind = 'post_engagement' and status = 'new'`,
        [organizationId, signalId],
      );
      return 'conserve';
    };

    // GARDE DE SÛRETÉ, ICI et non chez l'appelant : une personne à qui on a écrit
    // (inscription, ou fil de messages) n'est jamais effacée. Garder une ligne
    // trop longtemps se répare, l'effacer non. Cette lecture est un raccourci : le
    // `delete from signals` plus bas porte la MÊME condition, c'est lui qui décide.
    const contacte = await tx.query<{ contacte: boolean }>(
      `select ${sqlPersonneContactee(PARAM_ORG, PARAM_SIGNAL, '(select occurred_at from signals where id = $2)' as FragmentSql)} as contacte`,
      [organizationId, signalId],
    );
    if (contacte.rows[0]?.contacte === true) return conserver();
    await poserMemoire();
    // N'efface que ce que CET engageur a créé. La garde vit ICI, et non chez
    // l'appelant : `qualifiesPersonnes` la portait, donc elle ne protégeait que
    // la purge — le scoring (`persistScore(..., 'discarded')`) et la purge des
    // `new` effaçaient sans condition. Trois états ordinaires suffisaient à
    // détruire la ligne d'un opérateur : un contact importé ou migré, dont
    // l'inscription est TERMINÉE (`completed`/`replied`/… ne sont pas dans
    // STATUTS_VIVANTS, donc l'étape 3 ne rend pas `deja_en_campagne`) et dont
    // l'origine vide a été comblée par le rattachement. Le `delete` emportait
    // alors `list_members` et `enrollments` en cascade.
    await tx.query(
      `delete from contacts c
        where c.organization_id = $1 and c.source_signal_id = $2
          -- jamais une personne à qui on a écrit, même séquence terminée
          and not exists (select 1 from enrollments e where e.contact_id = c.id)
          and not exists (select 1 from threads t where t.contact_id = c.id)
          -- jamais une ligne d'une liste importée par l'opérateur
          and c.source_list_id is null
          -- jamais une fiche ANTÉRIEURE au signal : elle préexistait à l'engageur,
          -- le rattachement n'a fait que combler son origine vide.
          and c.created_at >= (select s.occurred_at from signals s where s.id = $2)`,
      [organizationId, signalId],
    );
    // Suppression du signal, ATOMIQUE : la condition « personne contactée » est dans
    // l'instruction elle-même, évaluée avant le détachement des survivants (qui
    // vide `source_signal_id`, donc la moitié de la condition).
    const supprime = await tx.query<{ source_run_id: string | null }>(
      `delete from signals where id = $2 and organization_id = $1 and kind = 'post_engagement'
          and not ${sqlPersonneContactee(PARAM_ORG, PARAM_SIGNAL, 'signals.occurred_at' as FragmentSql)}
        returning source_run_id`,
      [organizationId, signalId],
    );
    if (supprime.rows.length === 0) return conserver(); // contactée entre la lecture et ici
    // Les survivants sont DÉTACHÉS, l'inverse exact du rattachement : sans ça ils
    // garderaient l'origine d'un signal supprimé. La contrainte est aujourd'hui
    // `on delete set null`, qui produirait le même état ; on ne s'en remet pas à
    // elle, pour que le détachement ne dépende pas du mode de la clé étrangère.
    await tx.query(
      `update contacts set source_signal_id = null where organization_id = $1 and source_signal_id = $2`,
      [organizationId, signalId],
    );
    const runId = supprime.rows[0]?.source_run_id;
    if (compter && runId) {
      // Le passage qui a COLLECTÉ la personne, pas le dernier de la source : avec
      // un scoring plafonné, le jugement arrive souvent des passages plus tard.
      await tx.query(
        `update source_runs set ecartes = ecartes + 1
          where id = $1 and source_id in (select id from sources where organization_id = $2)`,
        [runId, organizationId],
      );
    }
    return 'efface';
  });
}
