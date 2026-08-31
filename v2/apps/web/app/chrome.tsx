import { getTranslations } from 'next-intl/server';
import { Icon, type IconName } from './icons';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { createClientOrNull } from '../lib/supabase/server';
import { EN_TETE_UTILISATEUR } from '../lib/supabase/middleware';
import { NotificationsBell, type NotifItem } from './notifications-bell';
import Link from 'next/link';

/**
 * Navigation principale.
 *
 * Deux entrées l'ont quittée (retours 4.1 et 6.1) : les thèmes de veille, qui
 * se règlent là où on construit la campagne qu'ils alimentent, et les webhooks
 * Smartlead, qui se branchent désormais tout seuls. Les écrans existent
 * toujours — le premier depuis Campagnes, le second en réglage avancé depuis
 * Fournisseurs — mais aucun des deux n'est un endroit où l'on va tous les
 * jours.
 */
const NAV: { href: string; key: string; icon: IconName }[] = [
  { href: '/', key: 'dashboard', icon: 'dashboard' },
  { href: '/signals', key: 'signals', icon: 'signals' },
  { href: '/prospects', key: 'prospects', icon: 'prospects' },
  { href: '/annuaire', key: 'annuaire', icon: 'sources' },
  { href: '/campaigns', key: 'campaigns', icon: 'campaigns' },
  { href: '/settings/templates', key: 'templates', icon: 'mail' },
  { href: '/inbox', key: 'inbox', icon: 'inbox' },
  { href: '/settings/linkedin', key: 'linkedin', icon: 'linkedin' },
  { href: '/settings/personas', key: 'personas', icon: 'personas' },
  { href: '/settings/customers', key: 'customers', icon: 'prospects' },
  { href: '/settings/providers', key: 'providers', icon: 'providers' },
  { href: '/settings/senders', key: 'senders', icon: 'senders' },
];

function relWhen(iso: string | null): string {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `il y a ${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

/**
 * Douze dernières notifications de l'utilisateur.
 *
 * L'identité vient du middleware, qui vient de la vérifier : la redemander ici
 * coûtait un aller-retour de plus sur chaque page. Les politiques de sécurité
 * de la base filtrent de toute façon sur le jeton, pas sur cette valeur.
 */
async function loadNotifications(): Promise<NotifItem[]> {
  const userId = (await headers()).get(EN_TETE_UTILISATEUR);
  if (!userId) return [];
  const supabase = await createClientOrNull();
  if (!supabase) return [];
  const rows =
    ((
      await supabase
        .from('notifications')
        .select('id,event,payload,sent_at,read_at')
        .eq('user_id', userId)
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
/**
 * La cloche, chargée à part.
 *
 * `AppTopBar` est appelée par chaque page, donc son attente s'ajoute à celle de
 * la page au lieu de s'y superposer. Isolée derrière une frontière de
 * suspension, la navigation part immédiatement et la cloche se remplit quand sa
 * lecture aboutit.
 */
async function Cloche() {
  const notifications = await loadNotifications();
  return <NotificationsBell items={notifications} />;
}

/** Barre de navigation latérale (rail gauche). Nom conservé pour ne pas toucher les pages. */
export async function AppTopBar({ active }: { active: string }) {
  const t = await getTranslations();
  return (
    <aside className="rs-sidebar">
      <div className="rs-sidetop">
        <Link href="/" className="rs-sidebrand">
          <span className="rs-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <span className="rs-brand">{t('app.name')}</span>
        </Link>
        <Suspense fallback={<NotificationsBell items={[]} />}>
          <Cloche />
        </Suspense>
      </div>
      <nav className="rs-sidenav">
        {NAV.map((item) => (
          <Link key={item.key} href={item.href} data-active={active === item.key}>
            <Icon name={item.icon} className="rs-nav-ico" aria-hidden="true" />
            <span>{t(`nav.${item.key}`)}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
