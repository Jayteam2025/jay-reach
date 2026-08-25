import { getTranslations } from 'next-intl/server';
import { Icon, type IconName } from './icons';
import { createClientOrNull } from '../lib/supabase/server';
import { NotificationsBell, type NotifItem } from './notifications-bell';

const NAV: { href: string; key: string; icon: IconName }[] = [
  { href: '/', key: 'dashboard', icon: 'dashboard' },
  { href: '/signals', key: 'signals', icon: 'signals' },
  { href: '/prospects', key: 'prospects', icon: 'prospects' },
  { href: '/annuaire', key: 'annuaire', icon: 'sources' },
  { href: '/campaigns', key: 'campaigns', icon: 'campaigns' },
  { href: '/inbox', key: 'inbox', icon: 'inbox' },
  { href: '/settings/linkedin', key: 'linkedin', icon: 'linkedin' },
  { href: '/settings/sources', key: 'sources', icon: 'sources' },
  { href: '/settings/personas', key: 'personas', icon: 'personas' },
  { href: '/settings/customers', key: 'customers', icon: 'prospects' },
  { href: '/settings/providers', key: 'providers', icon: 'providers' },
  { href: '/settings/branding', key: 'branding', icon: 'branding' },
];

function relWhen(iso: string | null): string {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `il y a ${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

async function loadNotifications(): Promise<NotifItem[]> {
  const supabase = await createClientOrNull();
  if (!supabase) return [];
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  const rows =
    ((
      await supabase
        .from('notifications')
        .select('id,event,payload,sent_at,read_at')
        .eq('user_id', userData.user.id)
        .order('sent_at', { ascending: false })
        .limit(12)
    ).data as { id: string; event: string; payload: { title?: string; body?: string } | null; sent_at: string | null; read_at: string | null }[] | null) ?? [];
  return rows.map((r) => ({
    id: r.id,
    title: r.payload?.title ?? r.event,
    body: r.payload?.body ?? '',
    when: relWhen(r.sent_at),
    read: r.read_at !== null,
  }));
}

/** Barre de navigation latérale (rail gauche). Nom conservé pour ne pas toucher les pages. */
export async function AppTopBar({ active }: { active: string }) {
  const t = await getTranslations();
  const notifications = await loadNotifications();
  return (
    <aside className="rs-sidebar">
      <div className="rs-sidetop">
        <a href="/" className="rs-sidebrand">
          <span className="rs-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <span className="rs-brand">{t('app.name')}</span>
        </a>
        <NotificationsBell items={notifications} />
      </div>
      <nav className="rs-sidenav">
        {NAV.map((item) => (
          <a key={item.key} href={item.href} data-active={active === item.key}>
            <Icon name={item.icon} className="rs-nav-ico" aria-hidden="true" />
            <span>{t(`nav.${item.key}`)}</span>
          </a>
        ))}
      </nav>
    </aside>
  );
}
