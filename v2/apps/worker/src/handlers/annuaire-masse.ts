/**
 * Ajout en masse depuis l'annuaire d'entreprises.
 *
 * L'écran dépose une demande, ce traitement la relève. « Tous les résultats »
 * peut représenter quatre cents appels à l'API publique : ça n'a pas sa place
 * dans une requête HTTP, et la progression doit rester visible pendant.
 *
 * L'API `recherche-entreprises.api.gouv.fr` est gratuite et sans clé, mais elle
 * est publique : on la parcourt page par page, sans concurrence, et on s'arrête
 * dès que l'opérateur annule.
 */
import type { Pool } from 'pg';

const BASE = 'https://recherche-entreprises.api.gouv.fr/search';

/** Maximum accepté par l'API : elle refuse au-delà. */
const PER_PAGE = 25;
/** Plafond de résultats imposé par l'API, quels que soient les critères. */
const PLAFOND = 10_000;
const PAGES_MAX = PLAFOND / PER_PAGE;

/** Buckets d'effectifs de l'interface vers les codes de tranche INSEE. */
const EFFECTIF_BUCKETS: Record<string, string> = {
  small: '01,02,03',
  mid: '11,12',
  large: '21,22,31,32',
  xl: '41,42,51,52,53',
};

interface Params {
  readonly q?: string;
  readonly naf?: string;
  readonly department?: string;
  readonly effectif?: string;
  readonly scope?: 'page' | 'all';
  readonly page?: number;
}

interface Ligne {
  readonly id: string;
  readonly organization_id: string;
  readonly params: Params;
}

interface Entreprise {
  siren: string;
  nom_complet?: string;
  activite_principale?: string;
  siege?: { libelle_commune?: string; commune?: string; code_postal?: string };
}

function construireUrl(p: Params, page: number): URL {
  const url = new URL(BASE);
  if (p.q) url.searchParams.set('q', p.q);
  if (p.naf) url.searchParams.set('activite_principale', p.naf);
  // `departement`, pas `code_departement` : l'API ignore silencieusement les
  // paramètres qu'elle ne connaît pas, et le filtre n'aurait aucun effet.
  if (p.department) url.searchParams.set('departement', p.department);
  const bucket = p.effectif ? EFFECTIF_BUCKETS[p.effectif] : undefined;
  if (bucket) url.searchParams.set('tranche_effectif_salarie', bucket);
  url.searchParams.set('etat_administratif', 'A');
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(PER_PAGE));
  return url;
}

/**
 * Insère une page d'entreprises et renvoie combien étaient nouvelles.
 *
 * Le dédoublonnage se fait sur (organisation, SIREN), en base : la faire porter
 * par l'index plutôt que par une lecture préalable évite qu'un import
 * concurrent passe entre les deux.
 */
async function insererPage(pool: Pool, organizationId: string, entreprises: Entreprise[]): Promise<number> {
  if (entreprises.length === 0) {
    return 0;
  }
  const valeurs: unknown[] = [];
  const morceaux: string[] = [];
  entreprises.forEach((e, i) => {
    const d = i * 6;
    morceaux.push(`($${d + 1}, $${d + 2}, $${d + 3}, $${d + 4}, $${d + 5}, $${d + 6}, 'resolved')`);
    valeurs.push(organizationId, e.nom_complet ?? e.siren, e.siren, e.activite_principale ?? null,
      e.siege?.libelle_commune ?? e.siege?.commune ?? null, e.siege?.code_postal ?? null);
  });
  const res = await pool.query(
    `insert into accounts (organization_id, name, siren, naf_code, city, postal_code, resolution_status)
     values ${morceaux.join(', ')}
     on conflict (organization_id, siren) do nothing`,
    valeurs,
  );
  return res.rowCount ?? 0;
}

async function annulationDemandee(pool: Pool, id: string): Promise<boolean> {
  const res = await pool.query<{ demandee: boolean }>(
    `select cancel_requested_at is not null as demandee from directory_bulk_imports where id = $1`,
    [id],
  );
  return res.rows[0]?.demandee ?? false;
}

/** Traite un import : parcourt les pages, insère, tient la progression à jour. */
async function traiterUn(pool: Pool, ligne: Ligne): Promise<void> {
  const p = ligne.params;
  const premierePage = p.scope === 'page' ? Math.max(1, p.page ?? 1) : 1;

  let total = 0;
  let traites = 0;
  let ajoutes = 0;

  try {
    for (let page = premierePage; page <= PAGES_MAX; page += 1) {
      if (await annulationDemandee(pool, ligne.id)) {
        await pool.query(
          `update directory_bulk_imports set status = 'cancelled', finished_at = now(), updated_at = now() where id = $1`,
          [ligne.id],
        );
        console.log(`[annuaire] import ${ligne.id} annulé après ${traites} entreprise(s)`);
        return;
      }

      const res = await fetch(construireUrl(p, page), { headers: { accept: 'application/json' } });
      if (!res.ok) {
        // Une page refusée n'invalide pas ce qui a déjà été ajouté : on
        // s'arrête là et on garde le compte.
        throw new Error(`API annuaire : HTTP ${res.status}`);
      }
      const data = (await res.json()) as { total_results?: number; results?: Entreprise[] };
      const entreprises = data.results ?? [];
      if (page === premierePage) {
        // L'API plafonne son décompte : au-delà, ce n'est plus un nombre
        // d'entreprises mais une borne.
        total = Math.min(data.total_results ?? 0, PLAFOND);
        if (p.scope === 'page') {
          total = entreprises.length;
        }
      }

      ajoutes += await insererPage(pool, ligne.organization_id, entreprises);
      traites += entreprises.length;

      await pool.query(
        `update directory_bulk_imports
            set status = 'running', total = $2, processed = $3, added = $4, existing = $5, updated_at = now()
          where id = $1`,
        [ligne.id, total, traites, ajoutes, traites - ajoutes],
      );

      const derniere = entreprises.length < PER_PAGE || p.scope === 'page' || traites >= total;
      if (derniere) {
        break;
      }
    }

    await pool.query(
      `update directory_bulk_imports set status = 'done', finished_at = now(), updated_at = now() where id = $1`,
      [ligne.id],
    );
    console.log(`[annuaire] import ${ligne.id} terminé : ${ajoutes} ajoutée(s), ${traites - ajoutes} déjà présente(s)`);
  } catch (err) {
    await pool.query(
      `update directory_bulk_imports
          set status = 'error', error = $2, processed = $3, added = $4, existing = $5,
              finished_at = now(), updated_at = now()
        where id = $1`,
      [ligne.id, err instanceof Error ? err.message : String(err), traites, ajoutes, traites - ajoutes],
    );
    console.error(`[annuaire] import ${ligne.id} en échec`, err);
  }
}

/**
 * Relève les demandes en attente et les traite. Renvoie le nombre d'imports
 * traités pendant ce tour.
 */
export async function traiterImportsAnnuaire(pool: Pool, maxImports = 1): Promise<number> {
  const res = await pool.query<Ligne>(
    `update directory_bulk_imports
        set status = 'running', updated_at = now()
      where id in (
        select id from directory_bulk_imports
         where status = 'pending' order by created_at limit $1
      )
      returning id, organization_id, params`,
    [maxImports],
  );

  for (const ligne of res.rows) {
    await traiterUn(pool, ligne);
  }
  return res.rowCount ?? 0;
}
