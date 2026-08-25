import { getTranslations } from 'next-intl/server';
import { AppTopBar } from '../chrome';
import { createClientOrNull } from '../../lib/supabase/server';
import { ApprovalList, type ApprovalRow } from './approval-list';

interface DbAction {
  id: string;
  channel: string;
  block_reason: string | null;
  enrollments: {
    contacts: { first_name: string | null; last_name: string | null; accounts: { name: string | null } | null } | null;
    campaigns: { name: string | null } | null;
  } | null;
}

export default async function ApprovalsPage() {
  const t = await getTranslations('approvals');
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  const rows: DbAction[] =
    supabase && orgId
      ? (((
          await supabase
            .from('actions')
            .select('id,channel,block_reason,enrollments(contacts(first_name,last_name,accounts(name)),campaigns(name))')
            .eq('organization_id', orgId)
            .eq('status', 'pending_approval')
            .order('created_at', { ascending: true })
        ).data as DbAction[] | null) ?? [])
      : [];

  const items: ApprovalRow[] = rows.map((a) => ({
    id: a.id,
    channel: a.channel,
    contact: `${a.enrollments?.contacts?.first_name ?? ''} ${a.enrollments?.contacts?.last_name ?? ''}`.trim() || '—',
    company: a.enrollments?.contacts?.accounts?.name ?? '—',
    campaign: a.enrollments?.campaigns?.name ?? '—',
    reason: a.block_reason,
  }));

  return (
    <div className="rs-shell">
      <AppTopBar active="approvals" />
      <main className="rs-main" style={{ maxWidth: 780 }}>
        <p className="rs-eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p className="rs-lead">{t('lead')}</p>
        <ApprovalList items={items} orgId={orgId} />
      </main>
    </div>
  );
}
