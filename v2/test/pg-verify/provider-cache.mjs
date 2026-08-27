// Vérif du cache de providers (T10) contre la base locale : c'est lui qui évite
// de repayer deux fois le même appel FullEnrich. On éprouve l'adaptateur tel que
// le moteur d'enrichissement l'utilise — mêmes appels, même table.
import pg from 'pg';
import { providerCache, purgeExpiredCache } from './_cache.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ORG = process.env.TEST_ORG;

let failures = 0;
function check(label, cond, extra) {
  if (!cond) failures++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
}

const q = (sql, params) => pool.query(sql, params);
const dansUnJour = () => new Date(Date.now() + 86400_000).toISOString();

/** Lecture telle que le moteur la fait : select().eq(type).eq(clé).maybeSingle(). */
const lire = (cache, type, cle) =>
  cache.from('enrichment_cache').select('data, expires_at').eq('cache_type', type).eq('cache_key', cle).maybeSingle();

/** Écriture telle que le moteur la fait. */
const ecrire = (cache, type, cle, data, expiresAt) =>
  cache
    .from('enrichment_cache')
    .upsert(
      { cache_type: type, cache_key: cle, data, expires_at: expiresAt },
      { onConflict: 'cache_type,cache_key' },
    );

async function main() {
  console.log('[cache] préparation…');
  await q(`delete from provider_cache where organization_id = $1`, [ORG]);

  // Une deuxième organisation, pour éprouver le cloisonnement.
  const autre = (
    await q(
      `insert into organizations (name, slug, default_locale) values ('Org Cache','org-cache','fr')
       on conflict (slug) do update set name = excluded.name returning id`,
    )
  ).rows[0].id;
  await q(`delete from provider_cache where organization_id = $1`, [autre]);

  const cache = providerCache(pool, ORG);
  const cacheAutre = providerCache(pool, autre);

  console.log('\n[cache] 1. Miss puis hit');
  const avant = await lire(cache, 'fullenrich_company', 'acme');
  check('entrée absente → miss', avant.data === null);

  await ecrire(cache, 'fullenrich_company', 'acme', { id: 'fe-1', name: 'Acme' }, dansUnJour());
  const apres = await lire(cache, 'fullenrich_company', 'acme');
  check('après écriture → hit', apres.data !== null);
  check('la donnée revient intacte', apres.data?.data?.id === 'fe-1', JSON.stringify(apres.data?.data));

  console.log('\n[cache] 2. Cloisonnement entre organisations');
  const chezAutre = await lire(cacheAutre, 'fullenrich_company', 'acme');
  check('une autre organisation ne voit pas l’entrée', chezAutre.data === null);
  // …et peut mettre en cache la MÊME clé de son côté (l'unicité du socle actuel,
  // globale sur (cache_type, cache_key), l'en aurait empêchée).
  await ecrire(cacheAutre, 'fullenrich_company', 'acme', { id: 'fe-2', name: 'Acme bis' }, dansUnJour());
  const relu = await lire(cache, 'fullenrich_company', 'acme');
  check('la même clé coexiste sans écraser', relu.data?.data?.id === 'fe-1', JSON.stringify(relu.data?.data));

  console.log('\n[cache] 3. Types de cache distincts');
  await ecrire(cache, 'fullenrich_ai_variants', 'acme', ['Acme SA', 'Acme France'], dansUnJour());
  const variants = await lire(cache, 'fullenrich_ai_variants', 'acme');
  const company = await lire(cache, 'fullenrich_company', 'acme');
  check('deux types ne se marchent pas dessus', Array.isArray(variants.data?.data) && company.data?.data?.id === 'fe-1');

  console.log('\n[cache] 4. Écrasement par une valeur plus fraîche');
  await ecrire(cache, 'fullenrich_company', 'acme', { id: 'fe-1', name: 'Acme SA' }, dansUnJour());
  const maj = await lire(cache, 'fullenrich_company', 'acme');
  check('upsert met à jour au lieu de dupliquer', maj.data?.data?.name === 'Acme SA', JSON.stringify(maj.data?.data));
  const n = (await q(`select count(*)::int as n from provider_cache where organization_id=$1 and cache_key='acme'`, [ORG]))
    .rows[0].n;
  check('une seule ligne par (org, type, clé)', n === 2, `${n} lignes (company + ai_variants)`);

  console.log('\n[cache] 5. Expiration et purge');
  const hier = new Date(Date.now() - 86400_000).toISOString();
  await ecrire(cache, 'fullenrich_company', 'perime', { id: 'vieux' }, hier);
  const perime = await lire(cache, 'fullenrich_company', 'perime');
  // Le moteur écarte lui-même une entrée dont `expires_at` est passé : l'adaptateur
  // la retourne, c'est au moteur de la juger. On vérifie donc la date, pas l'absence.
  check('l’entrée périmée est rendue avec sa date passée', new Date(perime.data?.expires_at) < new Date());
  const supprimees = await purgeExpiredCache(pool);
  check('la purge retire les périmées', supprimees >= 1, `${supprimees} ligne(s)`);
  const apresPurge = await lire(cache, 'fullenrich_company', 'perime');
  check('l’entrée périmée a disparu', apresPurge.data === null);
  const vivante = await lire(cache, 'fullenrich_company', 'acme');
  check('la purge épargne les entrées valides', vivante.data !== null);

  console.log('\n[cache] 6. Une panne de cache ne casse pas l’enrichissement');
  const cassé = providerCache(
    { query: async () => { throw new Error('base indisponible'); } },
    ORG,
  );
  const surPanne = await lire(cassé, 'fullenrich_company', 'acme');
  check('lecture en panne → miss, pas d’exception', surPanne.data === null && surPanne.error === null);
  const ecritureEnPanne = await ecrire(cassé, 'fullenrich_company', 'acme', {}, dansUnJour());
  check('écriture en panne → pas d’exception', ecritureEnPanne.error === null);

  await q(`delete from provider_cache where organization_id = any($1::uuid[])`, [[ORG, autre]]);
  await q(`delete from organizations where id = $1`, [autre]);

  console.log(`\n[cache] ${failures === 0 ? '✅ TOUT VERT' : `❌ ${failures} échec(s)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[cache] ERREUR', e);
  process.exit(2);
});
