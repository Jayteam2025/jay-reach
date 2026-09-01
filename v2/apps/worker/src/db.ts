/**
 * Accès base du worker (pg direct, côté serveur/service — filtrage explicite
 * par organisation dans chaque requête). Écriture de la résolution d'entreprise.
 */
import { Pool } from 'pg';
import type { ScrapedSignal } from '@jay-reach/providers/signals';
import { normalizeLocation, signalFingerprint } from '@jay-reach/core';

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

/**
 * Déchiffre le secret d'un provider via le coffre (`app.get_credential`,
 * pgcrypto). La clé de chiffrement vit hors base — passée ici depuis
 * l'environnement du worker. Le secret déchiffré ne transite jamais par
 * PostgREST : seul le worker (connexion pg directe, service) y accède.
 */
export async function getCredentialSecret(
  pool: Pool,
  organizationId: string,
  providerId: string,
  encryptionKey: string,
): Promise<string | null> {
  const res = await pool.query<{ secret: string | null }>('select app.get_credential($1, $2, $3) as secret', [
    organizationId,
    providerId,
    encryptionKey,
  ]);
  return res.rows[0]?.secret ?? null;
}

/** Champs non-secrets d'un provider (jsonb `config`), ou null si non configuré. */
export async function getCredentialConfig(
  pool: Pool,
  organizationId: string,
  providerId: string,
): Promise<Record<string, string> | null> {
  const res = await pool.query<{ config: Record<string, string> | null }>(
    'select config from credentials where organization_id = $1 and provider_id = $2',
    [organizationId, providerId],
  );
  return res.rows[0]?.config ?? null;
}

export interface InsertedSignal {
  readonly signalId: string;
  readonly organizationId: string;
  readonly companyName: string | null;
}

/**
 * Écrit les signaux détectés (déduplication par (source, url) via l'index
 * unique). Ne garde que les `job_posting`. Retourne les NOUVEAUX signaux
 * (ceux réellement insérés) pour permettre le chaînage vers la qualification.
 */
/**
 * Code postal français lu dans un libellé de lieu, quand il s'y trouve.
 *
 * Les sources ne le donnent pas séparément : Adzuna renvoie un libellé libre,
 * France Travail un « 75 - PARIS 01 » qui n'en contient pas. Il ne sert donc
 * que de repli quand le libellé de lieu est absent.
 */
function codePostalDe(location: string | null): string | undefined {
  return location?.match(/\b(\d{5})\b/)?.[1];
}

/**
 * Signaux insérés par requête.
 *
 * Une requête par signal coûtait un aller-retour réseau chacune — mesuré à
 * 36 ms depuis un poste, davantage depuis une fonction serverless. Sur une
 * collecte de 978 offres, cela dépassait la minute et faisait tuer la fonction
 * avant la fin : la collecte entière était perdue.
 *
 * Cent par requête ramène ça à une dizaine d'allers-retours. Au-delà, la
 * requête devient longue à préparer sans rien gagner.
 */
const TAILLE_LOT_INSERTION = 100;

export async function insertSignals(
  pool: Pool,
  organizationId: string,
  sourceId: string,
  providerId: string,
  signals: readonly ScrapedSignal[],
): Promise<InsertedSignal[]> {
  // Empreintes déjà posées pendant ce lot : une même offre remontée deux fois
  // par le même appel n'a pas encore été écrite en base, donc la vérification
  // SQL ne la verrait pas.
  const vuesDansLeLot = new Set<string>();
  const aInserer: {
    externalId: string;
    occurredAt: string | null;
    raw: string;
    title: string | null;
    companyName: string | null;
    location: string | null;
    fingerprint: string | null;
  }[] = [];

  for (const signal of signals) {
    if (signal.signal_type !== 'job_posting') {
      continue;
    }
    const data = signal.extracted_data;
    const companyName = (data.company_name as string | null | undefined) ?? null;
    const title = (data.job_title as string | null | undefined) ?? null;
    const location = (data.location as string | null | undefined) ?? null;

    // L'empreinte exige les trois composantes : entreprise, intitulé ET lieu.
    //
    // Elle s'est longtemps contentée des deux premières quand le lieu manquait,
    // et c'était un piège : un employeur qui recrute le même profil dans douze
    // communes produisait douze fois la même empreinte, et onze de ses offres
    // étaient rejetées à l'insertion. Sans composante géographique on préfère
    // donc ne pas dédupliquer du tout — un doublon se voit et se nettoie, une
    // offre jamais insérée ne laisse aucune trace.
    const codePostal = codePostalDe(location);
    const lieu = normalizeLocation(location) || codePostal || '';
    const fingerprint =
      companyName && title && lieu
        ? signalFingerprint({ company: companyName, title, location, postalCode: codePostal })
        : null;

    if (fingerprint && vuesDansLeLot.has(fingerprint)) {
      continue;
    }
    if (fingerprint) {
      vuesDansLeLot.add(fingerprint);
    }

    aInserer.push({
      externalId: signal.source_url,
      occurredAt: (data.posted_date as string | null | undefined) ?? null,
      raw: JSON.stringify(data),
      title,
      companyName,
      location,
      fingerprint,
    });
  }

  const inserted: InsertedSignal[] = [];
  for (let i = 0; i < aInserer.length; i += TAILLE_LOT_INSERTION) {
    const lot = aInserer.slice(i, i + TAILLE_LOT_INSERTION);
    const valeurs: unknown[] = [organizationId, sourceId, providerId];
    const lignes = lot.map((l, n) => {
      const d = 3 + n * 7;
      valeurs.push(l.externalId, l.occurredAt, l.raw, l.title, l.companyName, l.location, l.fingerprint);
      return `($${d + 1}::text, $${d + 2}::timestamptz, $${d + 3}::jsonb, $${d + 4}::text, $${d + 5}::text, $${d + 6}::text, $${d + 7}::text)`;
    });

    const res = await pool.query<{ id: string; company_hint: string | null }>(
      `insert into signals
         (organization_id, source_id, provider_id, external_id, kind, occurred_at,
          raw, title, url, company_hint, location, status, fingerprint)
       select $1, $2, $3, v.external_id, 'job_posting', coalesce(v.occurred_at, now()),
              v.raw, v.title, v.external_id, v.company_hint, v.location, 'new', v.fingerprint
         from (values ${lignes.join(', ')})
              as v(external_id, occurred_at, raw, title, company_hint, location, fingerprint)
        where v.fingerprint is null
           or not exists (
             select 1 from signals s
              where s.organization_id = $1
                and s.fingerprint = v.fingerprint
                and s.occurred_at > now() - interval '30 days'
           )
       on conflict (source_id, external_id) do nothing
       returning id, company_hint`,
      valeurs,
    );

    for (const ligne of res.rows) {
      inserted.push({ signalId: ligne.id, organizationId, companyName: ligne.company_hint });
    }
  }

  return inserted;
}

/** Ouvre un enregistrement d'exécution de source (`source_runs`, statut `running`). */
export async function startSourceRun(
  pool: Pool,
  sourceId: string,
  sourceProviderId?: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `insert into source_runs (source_id, source_provider_id, status) values ($1, $2, 'running') returning id`,
    [sourceId, sourceProviderId ?? null],
  );
  const id = res.rows[0]?.id;
  if (!id) {
    throw new Error('source_runs: insertion sans id');
  }
  return id;
}

export interface SourceRunResult {
  readonly found: number;
  readonly added: number;
  readonly status: 'success' | 'error';
  readonly error?: string | null;
}

/** Clôt un enregistrement d'exécution de source (compteurs + statut final). */
export async function finishSourceRun(pool: Pool, runId: string, result: SourceRunResult): Promise<void> {
  await pool.query(
    `update source_runs
        set finished_at = now(), status = $2, items_found = $3, items_new = $4, error = $5
      where id = $1`,
    [runId, result.status, result.found, result.added, result.error ?? null],
  );
}

/**
 * Delai au-dela duquel une execution encore marquee `running` est tenue pour
 * interrompue. Une collecte dure quelques secondes ; une demi-heure laisse une
 * marge confortable meme sur une source lente.
 */
export const SOURCE_RUN_TIMEOUT_MIN = 30;

/**
 * Referme les executions restees `running` alors que plus rien ne tourne.
 *
 * Un worker qui s'arrete en plein travail — crash, redemarrage, machine
 * eteinte — laisse sa ligne ouverte pour toujours : `finishSourceRun` n'est
 * jamais atteint. L'ecran Sources affiche alors « en cours » indefiniment, sur
 * une collecte qui n'existe plus. C'est le bug #7 du socle precedent, que le
 * nouveau reproduisait a l'identique.
 *
 * On se base sur l'anciennete plutot que sur le demarrage du worker : plusieurs
 * workers peuvent tourner en parallele, et l'un qui demarre n'a aucun droit de
 * declarer mortes les executions d'un autre.
 */
export async function closeStaleSourceRuns(
  pool: Pool,
  timeoutMinutes: number = SOURCE_RUN_TIMEOUT_MIN,
): Promise<number> {
  const res = await pool.query(
    `update source_runs
        set status = 'error',
            finished_at = now(),
            error = coalesce(error, 'Collecte interrompue : le worker s''est arrêté avant la fin.')
      where status = 'running'
        and started_at < now() - make_interval(mins => $1)`,
    [timeoutMinutes],
  );
  return res.rowCount ?? 0;
}

export interface LinkedInActionJob {
  readonly organizationId: string;
  readonly kind: 'invite' | 'message';
  readonly linkedinUrl: string;
  readonly contactId?: string | null;
  readonly signalId?: string | null;
  readonly messageBody?: string | null;
  readonly method?: 'extension_auto' | 'manual';
  /** Action du sequenceur a l'origine : sert a la marquer partie une fois envoyee. */
  readonly actionId?: string | null;
}

/**
 * Enfile une action LinkedIn (invitation ou message) dans
 * `linkedin_action_queue`, consommée par l'extension Chrome (envoi via Voyager,
 * session de l'utilisateur ; pacing appliqué côté serveur). Dédup : pas de
 * doublon actif (pending/processing/sent) pour le même (contact, kind).
 * Retourne l'id créé, ou null si déjà en file. Aucun envoi ici.
 */
export async function enqueueLinkedInAction(pool: Pool, job: LinkedInActionJob): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    `insert into linkedin_action_queue
       (organization_id, contact_id, signal_id, linkedin_url, kind, message_body, method, action_id)
     select $1, $2, $3, $4, $5, $6, $7, $8
     where not exists (
       select 1 from linkedin_action_queue q
       where q.contact_id = $2 and q.kind = $5
         and q.status in ('pending', 'processing', 'sent')
         and $2 is not null
     )
     returning id`,
    [
      job.organizationId,
      job.contactId ?? null,
      job.signalId ?? null,
      job.linkedinUrl,
      job.kind,
      job.messageBody ?? null,
      job.method ?? 'extension_auto',
      job.actionId ?? null,
    ],
  );
  return res.rows[0]?.id ?? null;
}

export interface ResolvedAccount {
  readonly organizationId: string;
  readonly name: string;
  readonly siren: string | null;
  readonly nafCode: string | null;
  /** Rapprochement fiable ? (sinon on ne pose pas la firmographie — cf. legacy). */
  readonly trusted: boolean;
  /** Opposition au démarchage (statut de diffusion Sirene). */
  readonly opposition?: boolean;
}

/**
 * Enregistre le compte résolu. Sur un rapprochement fiable : SIREN + NAF et
 * statut `resolved`, plus `prospecting_opposition` (filtre non désactivable).
 * Sinon : compte `unresolved` (file d'arbitrage humain).
 */
export async function upsertResolvedAccount(pool: Pool, acc: ResolvedAccount): Promise<string | null> {
  if (acc.trusted && acc.siren) {
    const res = await pool.query<{ id: string }>(
      `insert into accounts (organization_id, name, siren, naf_code, prospecting_opposition, resolution_status)
       values ($1, $2, $3, $4, $5, 'resolved')
       on conflict (organization_id, siren) where siren is not null
       do update set naf_code = excluded.naf_code, name = excluded.name,
                     prospecting_opposition = excluded.prospecting_opposition
       returning id`,
      [acc.organizationId, acc.name, acc.siren, acc.nafCode, acc.opposition ?? false],
    );
    return res.rows[0]?.id ?? null;
  }
  // Un compte non résolu se REJOINT s'il existe déjà sous le même nom.
  //
  // Cette branche insérait sans rien chercher. Chaque offre d'un employeur sans
  // SIREN créait donc son propre compte : au 01/09/2026, cinquante-deux comptes
  // « Groupe PIMENT », trente-huit « AB Stratégies Equilibre », 387 comptes en
  // trop sur 1 558. Le coût n'est pas cosmétique — le producteur d'enrichissement
  // ne retient que les comptes jamais enrichis, si bien qu'un employeur en
  // douze exemplaires vaut douze appels FullEnrich facturés pour la même
  // entreprise. Quarante-cinq de ces appels redondants étaient en attente.
  //
  // La branche du dessus, elle, avait son garde-fou depuis toujours : un
  // `on conflict` sur le SIREN. C'est seulement quand l'annuaire légal ne
  // répond pas qu'on créait à l'aveugle.
  //
  // On ne peut pas s'appuyer ici sur une contrainte d'unicité : les doublons
  // déjà en base l'empêcheraient d'être posée. La recherche est donc explicite,
  // et se contente du nom — c'est la seule chose qu'on connaisse d'un compte
  // non résolu.
  const res = await pool.query<{ id: string }>(
    `with existant as (
       select id from accounts
        where organization_id = $1
          and lower(name) = lower($2)
          and siren is null
        order by created_at, id
        limit 1
     ), cree as (
       insert into accounts (organization_id, name, resolution_status)
       select $1, $2, 'unresolved'
        where not exists (select 1 from existant)
       returning id
     )
     select id from existant
     union all
     select id from cree`,
    [acc.organizationId, acc.name],
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Rattache au compte résolu les signaux de cette entreprise qui n'en ont pas.
 *
 * Ce lien n'est pas cosmétique : le scoring lit `accounts.naf_code` et
 * `accounts.prospecting_opposition` À TRAVERS `signals.account_id`. Sans lui, le
 * pré-filtre des cabinets par code NAF et le filtre d'opposition au démarchage
 * existent dans le code mais ne s'appliquent jamais — la jointure ne ramène rien.
 *
 * On rattache par nom d'entreprise plutôt que signal par signal : une entreprise
 * qui publie dix offres n'a pas à être résolue dix fois auprès de l'annuaire, et
 * les signaux déjà collectés se rattrapent au passage.
 *
 * Retourne le nombre de signaux rattachés.
 */
export async function attachSignalsToAccount(
  pool: Pool,
  organizationId: string,
  companyName: string,
  accountId: string,
): Promise<number> {
  const res = await pool.query(
    `update public.signals
        set account_id = $1
      where organization_id = $2 and account_id is null and company_hint = $3`,
    [accountId, organizationId, companyName],
  );
  return res.rowCount ?? 0;
}
