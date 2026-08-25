import { getTranslations } from 'next-intl/server';
import { AppTopBar } from '../chrome';
import { createClientOrNull } from '../../lib/supabase/server';
import { SignalsBoard, type SignalRow, type SignalState } from './signals-board';
import { providerLabel } from '../../lib/labels';

interface DbSignal {
  id: string;
  title: string | null;
  url: string | null;
  company_hint: string | null;
  location: string | null;
  score: number | null;
  status: 'new' | 'qualified' | 'discarded' | 'enrolled';
  resolution_status: 'pending' | 'resolved' | 'unresolved' | 'rejected';
  discard_reason: string | null;
  occurred_at: string;
  provider_id: string | null;
  accounts: { name: string | null; siren: string | null } | null;
}

function toState(s: DbSignal): SignalState {
  if (s.resolution_status === 'unresolved') return 'arbitrate';
  if (s.status === 'discarded') return 'discarded';
  if (s.status === 'qualified' || s.status === 'enrolled') return 'validated';
  return 'todo';
}

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export default async function SignalsPage() {
  const t = await getTranslations();
  const supabase = await createClientOrNull();

  const memberships = supabase
    ? (await supabase.from('memberships').select('organization_id').limit(1)).data
    : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  const rows: SignalRow[] =
    supabase && orgId
      ? (
          ((
            await supabase
              .from('signals')
              .select(
                'id,title,url,company_hint,location,score,status,resolution_status,discard_reason,occurred_at,provider_id,accounts(name,siren)',
              )
              .eq('organization_id', orgId)
              .order('occurred_at', { ascending: false })
              .limit(200)
          ).data as DbSignal[] | null) ?? []
        ).map((s) => ({
          id: s.id,
          company: s.accounts?.name ?? s.company_hint ?? '—',
          siren: s.accounts?.siren ?? null,
          title: s.title ?? '—',
          location: s.location ?? '—',
          source: providerLabel(s.provider_id),
          score: s.score ?? 0,
          state: toState(s),
          daysAgo: daysAgo(s.occurred_at),
          discardReason: s.discard_reason,
          url: s.url,
        }))
      : [];

  return (
    <div className="rs-shell">
      <AppTopBar active="signals" />
      <main className="rs-main">
        <p className="rs-eyebrow">{t('signals.eyebrow')}</p>
        <h1>{t('signals.title')}</h1>
        <p className="rs-lead">{t('signals.lead')}</p>
        <SignalsBoard signals={rows} orgId={orgId} />
      </main>
    </div>
  );
}
