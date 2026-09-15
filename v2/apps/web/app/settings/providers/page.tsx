import { getTranslations, getLocale } from 'next-intl/server';
import { PROVIDER_CATALOG } from '@jay-reach/providers';
import { createClientOrNull } from '../../../lib/supabase/server';
import {
  FOURNISSEURS_AVEC_RELEVE,
  indexerEtatsReleve,
  resumeReleve,
  type LigneEtatReleve,
} from '../../../lib/etat-releve';
import { AppTopBar } from '../../chrome';
import { ProviderForm } from './provider-form';

const CATEGORY_ORDER = ['email', 'enrichment', 'signals', 'ai'] as const;

/**
 * Borne d'affichage au-delà de laquelle un plafond se lit comme « illimité »
 * plutôt que comme un nombre. Le worker consomme un plafond réellement
 * illimité sous la forme d'un entier énorme (`PLAFOND_SALESBLINK_ILLIMITE`,
 * borne supérieure d'un `int` Postgres) : l'afficher tel quel n'aiderait
 * personne.
 */
const PLAFOND_AFFICHAGE_ILLIMITE = 1_000_000;

/** Plafond réglé dans la config non secrète (`daily_cap`, saisi en texte) — même lecture que `plafondConfigure` de `lib/engine-status.ts`. Absent ou non numérique → aucun réglage connu. */
function plafondConfigure(config: Record<string, string> | null): number | null {
  const brut = config?.['daily_cap'];
  if (brut === undefined || brut === null || brut === '') return null;
  const valeur = Number(brut);
  return Number.isFinite(valeur) ? valeur : null;
}

/** « il y a N s / min / h / j », dans la locale courante — même formule que le tableau de bord (`app/page.tsx`). */
function formatAgo(iso: string, locale: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diffSec < 60) return rtf.format(-diffSec, 'second');
  if (diffMin < 60) return rtf.format(-diffMin, 'minute');
  if (diffHour < 24) return rtf.format(-diffHour, 'hour');
  return rtf.format(-diffDay, 'day');
}

export default async function ProvidersPage() {
  const t = await getTranslations();
  const locale = await getLocale();

  const supabase = await createClientOrNull();
  // Le secret n'est jamais lu ici : seule la vue publique (statut + last4).
  const memberships = supabase
    ? (await supabase.from('memberships').select('organization_id').limit(1)).data
    : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  const creds = supabase
    ? (await supabase.from('credentials_public').select('provider_id, status, last4, config').eq('organization_id', orgId)).data
    : null;
  const rows = (creds ?? []) as { provider_id: string; status: string; last4: string | null; config: Record<string, string> | null }[];
  const byProvider = new Map(rows.map((row) => [row.provider_id, row]));

  // Consommation du jour (UTC, comme le worker) — pour chaque fournisseur qui
  // porte un plafond quotidien.
  const debutJourUtc = new Date();
  debutJourUtc.setUTCHours(0, 0, 0, 0);
  const aujourdHui = debutJourUtc.toISOString().slice(0, 10);
  const usages = supabase
    ? (
        await supabase
          .from('provider_daily_usage')
          .select('provider_id, used, daily_cap')
          .eq('organization_id', orgId)
          .eq('usage_date', aujourdHui)
      ).data
    : null;
  const usageByProvider = new Map(
    ((usages ?? []) as { provider_id: string; used: number; daily_cap: number }[]).map((u) => [u.provider_id, u]),
  );

  // Relève des réponses : dernier passage et dernière erreur, pour chacun des
  // deux fournisseurs qui relèvent une boîte (SalesBlink et Microsoft Graph).
  // Sans la ligne Microsoft Graph, un 403 de politique d'accès Exchange ou un
  // secret expiré n'apparaîtrait nulle part.
  const syncStates = supabase
    ? (
        await supabase
          .from('provider_sync_state')
          .select('provider, last_run_at, last_error')
          .eq('organization_id', orgId)
          .in('provider', [...FOURNISSEURS_AVEC_RELEVE])
      ).data
    : null;
  const etatsReleve = indexerEtatsReleve((syncStates ?? []) as LigneEtatReleve[]);

  const categories = CATEGORY_ORDER.map((cat) => ({
    cat,
    providers: PROVIDER_CATALOG.filter((p) => p.category === cat),
  })).filter((g) => g.providers.length > 0);

  return (
    <div className="rs-shell">
      <AppTopBar active="providers" />
      <main className="rs-main" style={{ maxWidth: 720 }}>
        <p className="rs-eyebrow">{t('providers.eyebrow')}</p>
        <h1>{t('providers.title')}</h1>
        <p className="rs-lead">{t('providers.lead')}</p>

        {categories.map(({ cat, providers }) => (
          <section key={cat} className="rs-prov-cat">
            <div className="rs-prov-cat-head">{t(`providers.category.${cat}`)}</div>
            <div className="rs-prov-list">
              {providers.map((provider) => {
                const row = byProvider.get(provider.id);
                const usage = usageByProvider.get(provider.id);
                // Consommation du jour : pour un fournisseur qui porte un
                // plafond quotidien. Une ligne du jour prime (c'est le plafond
                // réellement appliqué) ; à défaut, un fournisseur configuré
                // avec un plafond réglé affiche « 0 / <plafond> » — sinon
                // l'écran resterait muet jusqu'au premier appel de la journée.
                const porteUnPlafond = provider.fields.some((f) => f.name === 'daily_cap');
                const capConfigure = plafondConfigure(row?.config ?? null);
                const todayUsage = !porteUnPlafond
                  ? null
                  : usage
                    ? { used: usage.used, cap: usage.daily_cap >= PLAFOND_AFFICHAGE_ILLIMITE ? '∞' : usage.daily_cap }
                    : row?.status === 'configured' && capConfigure !== null
                      ? { used: 0, cap: capConfigure }
                      : null;
                const releve = resumeReleve(etatsReleve, provider.id);
                const lastSyncAgo = releve ? (releve.lastRunAt ? formatAgo(releve.lastRunAt, locale) : 'never') : null;
                const lastSyncError = releve?.lastError ?? null;
                return (
                  <ProviderForm
                    key={provider.id}
                    orgId={orgId}
                    providerId={provider.id}
                    labelKey={provider.labelKey}
                    fields={provider.fields.map((f) => ({
                      name: f.name,
                      labelKey: f.labelKey,
                      type: f.type,
                      secret: f.secret,
                      required: f.required,
                      ...(f.hintKey ? { hintKey: f.hintKey } : {}),
                      ...(f.placeholderKey ? { placeholderKey: f.placeholderKey } : {}),
                    }))}
                    status={row?.status ?? null}
                    last4={row?.last4 ?? null}
                    config={row?.config ?? null}
                    todayUsage={todayUsage}
                    lastSyncAgo={lastSyncAgo}
                    lastSyncError={lastSyncError}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
