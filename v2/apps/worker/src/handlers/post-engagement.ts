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
import { z } from 'zod';
import { dansUneTransaction, normaliserUrlPost, normaliserUrlProfil, type Executeur } from '@jay-reach/core';

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

export type IssueEngageur = 'nouveau' | 'doublon' | 'deja_en_campagne' | 'ecarte';

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

/** La partie stable d'un URN (`urn:li:fsd_profile:ACoAA…` -> `ACoAA…`). */
function identifiantMembre(urn: string): string {
  const morceaux = urn.split(':');
  return morceaux[morceaux.length - 1] ?? urn;
}

/**
 * Adresse de profil déduite de l'URN : REPLI, et HYPOTHÈSE non vérifiée. Le
 * dernier segment d'un URN de profil est un identifiant interne, pas le nom
 * public qui compose d'ordinaire les adresses `/in/` : LinkedIn peut ne pas la
 * résoudre. Elle reste stable d'un passage à l'autre, ce qui suffit à l'index
 * unique des contacts, mais l'enrichissement (tâche 8) ne doit pas compter
 * dessus : le collecteur fournit `urlProfil` dès qu'il le peut.
 */
export function lienProfilDeduit(urn: string): string {
  return `https://www.linkedin.com/in/${identifiantMembre(urn)}`;
}

// `normaliserUrlProfil` vit dans le cœur : les trois chemins qui écrivent une
// adresse de profil (ce collecteur, l'enrichissement, l'import de fichier)
// doivent s'accorder sur la même forme, sinon la même personne existe deux fois.

/** L'adresse fournie quand elle est exploitable, le repli déduit sinon. */
export function lienProfil(engageur: Pick<Engageur, 'urn' | 'urlProfil'>): string {
  return (engageur.urlProfil ? normaliserUrlProfil(engageur.urlProfil) : null) ?? lienProfilDeduit(engageur.urn);
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

  // 1) Déjà écarté par le scoring : ni recréé, ni rescoré, donc jamais repayé.
  const ecarte = await pool.query(
    `select 1 as one from linkedin_engageurs_ecartes where organization_id = $1 and external_id = $2`,
    [org, externalId],
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
): Promise<void> {
  const juge = opts.juge ?? true;
  const compter = opts.compter ?? juge;
  await dansUneTransaction(pool as unknown as Executeur, async (tx) => {
    if (juge) {
      await tx.query(
        `insert into linkedin_engageurs_ecartes (organization_id, external_id)
         select organization_id, external_id from signals
          where id = $2 and organization_id = $1 and kind = 'post_engagement'
         on conflict do nothing`,
        [organizationId, signalId],
      );
    }
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
          -- jamais une ligne d'une liste importée par l'opérateur
          and c.source_list_id is null
          -- jamais une fiche ANTÉRIEURE au signal : elle préexistait à l'engageur,
          -- le rattachement n'a fait que combler son origine vide.
          and c.created_at >= (select s.occurred_at from signals s where s.id = $2)`,
      [organizationId, signalId],
    );
    // Les survivants sont DÉTACHÉS, l'inverse exact du rattachement : sans ça ils
    // garderaient l'origine d'un signal supprimé. La contrainte est aujourd'hui
    // `on delete set null`, qui produirait le même état ; on ne s'en remet pas à
    // elle, pour que le détachement ne dépende pas du mode de la clé étrangère.
    await tx.query(
      `update contacts set source_signal_id = null where organization_id = $1 and source_signal_id = $2`,
      [organizationId, signalId],
    );
    const supprime = await tx.query<{ source_run_id: string | null }>(
      `delete from signals where id = $2 and organization_id = $1 and kind = 'post_engagement' returning source_run_id`,
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
  });
}
