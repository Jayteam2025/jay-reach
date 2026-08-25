import { getTranslations } from 'next-intl/server';
import { AppTopBar } from '../chrome';
import { createClientOrNull } from '../../lib/supabase/server';
import type { InboxThread, InboxMessage, Classification, Treatment, InboxChannel } from '../../lib/sample-inbox';
import { InboxView } from './inbox-view';

interface DbThread {
  id: string;
  channel: string;
  classification: Classification;
  is_read: boolean;
  resume_at: string | null;
  last_message_at: string | null;
  contacts: { first_name: string | null; last_name: string | null; job_title: string | null; accounts: { name: string | null } | null } | null;
  thread_messages: { direction: 'in' | 'out'; body: string; sent_at: string }[] | null;
}

function relWhen(iso: string | null): string {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `il y a ${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hier' : `il y a ${d} j`;
}
function msgWhen(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
function treatmentOf(t: DbThread): Treatment {
  if (t.resume_at) return 'later';
  if (t.is_read) return 'done';
  return 'todo';
}

export default async function InboxPage() {
  const t = await getTranslations('inbox');
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  const sender =
    supabase && orgId
      ? (((await supabase.from('senders').select('identity').eq('organization_id', orgId).eq('kind', 'email').limit(1).maybeSingle()).data as
          | { identity: string }
          | null)?.identity ?? '—')
      : '—';

  const rows: DbThread[] =
    supabase && orgId
      ? (((
          await supabase
            .from('threads')
            .select(
              'id,channel,classification,is_read,resume_at,last_message_at,contacts(first_name,last_name,job_title,accounts(name)),thread_messages(direction,body,sent_at)',
            )
            .eq('organization_id', orgId)
            .order('last_message_at', { ascending: false })
        ).data as DbThread[] | null) ?? [])
      : [];

  const threads: InboxThread[] = rows.map((th) => {
    const msgs = [...(th.thread_messages ?? [])].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
    const lastIn = [...msgs].reverse().find((m) => m.direction === 'in') ?? msgs[msgs.length - 1];
    const messages: InboxMessage[] = msgs.map((m) => ({ direction: m.direction, when: msgWhen(m.sent_at), body: m.body }));
    return {
      id: th.id,
      contactName: `${th.contacts?.first_name ?? ''} ${th.contacts?.last_name ?? ''}`.trim() || '—',
      company: th.contacts?.accounts?.name ?? '—',
      jobTitle: th.contacts?.job_title ?? '—',
      channel: (th.channel === 'email' ? 'email' : 'linkedin') as InboxChannel,
      classification: th.classification,
      treatment: treatmentOf(th),
      when: relWhen(th.last_message_at),
      excerpt: lastIn?.body ?? '',
      sender,
      buySignal: th.classification === 'auto_left_company',
      messages,
    };
  });

  return (
    <div className="rs-shell">
      <AppTopBar active="inbox" />
      <main className="rs-main">
        <p className="rs-eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p className="rs-lead">{t('lead')}</p>
        {threads.length === 0 ? <p className="rs-empty">{t('lead')}</p> : <InboxView threads={threads} orgId={orgId} />}
      </main>
    </div>
  );
}
