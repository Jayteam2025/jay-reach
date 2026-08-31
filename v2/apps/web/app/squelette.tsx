'use client';

import { useTranslations } from 'next-intl';
import { Icon, type IconName } from './icons';

/**
 * Ce qu'on affiche pendant qu'un écran charge ses données.
 *
 * La navigation n'est pas grisée : elle ne dépend d'aucune donnée, elle peut
 * donc s'afficher pour de bon. Seul ce qui attend la base prend une forme
 * d'attente — et à ses dimensions réelles, pour que rien ne saute quand le
 * contenu s'y substitue.
 *
 * Composant client : il doit paraître au premier octet, sans attendre la
 * moindre lecture serveur.
 */

/** Reprise de la navigation de `chrome.tsx`. Statique des deux côtés. */
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

function BarreLaterale({ active }: { active: string }) {
  const t = useTranslations();
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

/** Quelques lignes de longueurs inégales : un bloc de texte, pas un pavé. */
function Lignes({ n, largeurs }: { n: number; largeurs?: string[] }) {
  const defaut = ['92%', '78%', '85%', '64%'];
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="rs-skel rs-skel-line" style={{ width: (largeurs ?? defaut)[i % (largeurs ?? defaut).length] }} />
      ))}
    </>
  );
}

/**
 * Squelette d'un écran.
 *
 * `cartes` : combien de blocs le contenu comptera. `stats` : une rangée de
 * compteurs en tête, comme sur le tableau de bord ou l'écran LinkedIn.
 */
export function SqueletteEcran({
  active,
  cartes = 3,
  stats = 0,
  etroit = false,
}: {
  active: string;
  cartes?: number;
  stats?: number;
  etroit?: boolean;
}) {
  return (
    <div className="rs-shell">
      <BarreLaterale active={active} />
      <main className="rs-main" style={etroit ? { maxWidth: 720 } : undefined} aria-busy="true">
        <span className="rs-skel rs-skel-line" style={{ width: 90, marginBottom: 10 }} />
        <span className="rs-skel rs-skel-h1" />
        <span className="rs-skel rs-skel-lead" />
        <span className="rs-skel rs-skel-lead" />

        {stats > 0 ? (
          <div className="rs-skel-stats" style={{ marginBottom: 18 }}>
            {Array.from({ length: stats }, (_, i) => (
              <div key={i} className="rs-skel-card">
                <span className="rs-skel rs-skel-num" />
                <span className="rs-skel rs-skel-line" style={{ width: '58%' }} />
              </div>
            ))}
          </div>
        ) : null}

        <div className="rs-skel-cards">
          {Array.from({ length: cartes }, (_, i) => (
            <div key={i} className="rs-skel-card">
              <span className="rs-skel rs-skel-line" style={{ width: '38%', height: 15 }} />
              <Lignes n={2} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
