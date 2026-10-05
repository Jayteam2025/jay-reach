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
import { normaliserUrlPost } from '@jay-reach/core';

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

/** Ce que l'enregistrement a besoin de connaître du passage en cours. */
export interface ContexteEngageur {
  readonly pool: Pool;
  readonly organizationId: string;
  /** Source d'engageurs qui porte le signal (sources.id). */
  readonly sourceId: string;
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

/**
 * Forme canonique d'une adresse de profil fournie (hôte `www.linkedin.com`, sans
 * paramètres, ancre ni barre finale), pour que deux écritures de la même adresse
 * soient reconnues par l'index unique. Une adresse qui n'est pas un profil
 * LinkedIn est refusée (null) : elle ne doit pas devenir l'identité d'un contact.
 */
export function normaliserUrlProfil(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const hote = u.hostname.toLowerCase();
    if (hote !== 'linkedin.com' && !hote.endsWith('.linkedin.com')) return null;
    const m = /^\/in\/([^/]+)/.exec(u.pathname);
    return m?.[1] ? `https://www.linkedin.com/in/${m[1]}` : null;
  } catch {
    return null;
  }
}

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
  engageur: Engageur,
  campagne: { id: string; personaId: string },
  urlPost: string,
): Promise<IssueEngageur> {
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

  // 3) Déjà dans une séquence vivante (par un autre post, ou un signal d'entreprise).
  const inscrit = await pool.query(
    `select 1 as one
       from enrollments e
       join contacts c on c.id = e.contact_id
      where c.organization_id = $1 and c.linkedin_url = $2 and e.status = any($3::enrollment_status[])
      limit 1`,
    [org, url, STATUTS_VIVANTS],
  );
  if (inscrit.rows.length > 0) return 'deja_en_campagne';

  // 4) Nouveau : le signal est créé SANS raw (rien de plus que ce qui sert).
  const signal = await pool.query<{ id: string }>(
    `insert into signals
       (organization_id, source_id, provider_id, external_id, kind, occurred_at, title, url, status)
     values ($1, $2, 'linkedin', $3, 'post_engagement', now(), $4, $5, 'new')
     on conflict (organization_id, external_id) where kind = 'post_engagement' do nothing
     returning id`,
    [org, ctx.sourceId, externalId, engageur.intitule, urlPost],
  );
  const signalId = signal.rows[0]?.id;
  if (!signalId) return 'doublon'; // course : un autre passage vient de l'insérer

  const { prenom, nomFamille } = separerNom(engageur.nom);

  // Un contact peut déjà exister, né d'un signal d'entreprise, avec son email :
  // on le RATTACHE. Il garde son email et son signal d'origine (l'historique de
  // ses messages en dépend) ; il ne reçoit que ce qui lui manque.
  const existant = await pool.query<{ id: string }>(
    `select id from contacts
      where organization_id = $1 and (linkedin_url = $2 or linkedin_provider_id = $3)
      order by (linkedin_url = $2) desc nulls last
      limit 1`,
    [org, url, membre],
  );
  const contactId = existant.rows[0]?.id;
  if (contactId) {
    try {
      await pool.query(
        `update contacts set
            linkedin_url = coalesce(linkedin_url, $3),
            linkedin_provider_id = coalesce(linkedin_provider_id, $4),
            persona_id = coalesce(persona_id, $5),
            first_name = coalesce(first_name, $6),
            last_name = coalesce(last_name, $7),
            job_title = coalesce(job_title, $8)
          where id = $2 and organization_id = $1`,
        [org, contactId, url, membre, campagne.personaId, prenom, nomFamille, engageur.intitule],
      );
    } catch (err) {
      // 23505 : l'adresse est déjà portée par un autre contact. On ne fusionne pas
      // deux fiches ici ; le contact rattaché garde ce qu'il a.
      if ((err as { code?: string }).code !== '23505') throw err;
    }
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
 * Efface un engageur que le scoring a écarté : son signal et le contact né de
 * ce signal. On ne garde pas de données personnelles sur ce qui ne sert pas ;
 * seul l'external_id survit dans `linkedin_engageurs_ecartes`, pour que le
 * collecteur ne le recrée pas au passage suivant.
 *
 * La mémoire d'écart est posée AVANT l'effacement : une interruption entre les
 * deux laisse un signal à rescorer, jamais une personne recréée et repayée.
 * Un contact rattaché (né d'un autre signal, avec son email) n'est pas touché.
 */
export async function ecarterEngageur(pool: Pool, organizationId: string, signalId: string): Promise<void> {
  await pool.query(
    `insert into linkedin_engageurs_ecartes (organization_id, external_id)
     select organization_id, external_id from signals
      where id = $2 and organization_id = $1 and kind = 'post_engagement'
     on conflict do nothing`,
    [organizationId, signalId],
  );
  await pool.query(`delete from contacts where organization_id = $1 and source_signal_id = $2`, [
    organizationId,
    signalId,
  ]);
  const supprime = await pool.query<{ source_id: string | null }>(
    `delete from signals where id = $2 and organization_id = $1 and kind = 'post_engagement' returning source_id`,
    [organizationId, signalId],
  );
  const sourceId = supprime.rows[0]?.source_id;
  if (sourceId) {
    // Le passage qui a collecté cette personne est le dernier de sa source : le
    // scoring tourne après la collecte, pas pendant.
    await pool.query(
      `update source_runs set ecartes = ecartes + 1
        where id = (select r.id from source_runs r
                      join sources so on so.id = r.source_id and so.organization_id = $2
                     where r.source_id = $1 order by r.started_at desc limit 1)`,
      [sourceId, organizationId],
    );
  }
}
