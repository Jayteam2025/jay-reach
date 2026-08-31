'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon, type IconName } from './icons';

/**
 * Ce qu'on affiche pendant qu'un écran charge ses données.
 *
 * Deux règles tiennent tout le fichier.
 *
 * La navigation n'est pas grisée : elle ne dépend d'aucune donnée, elle
 * s'affiche donc pour de bon. Griser puis remplacer la seule partie déjà connue
 * de l'écran la ferait clignoter pour rien.
 *
 * Et chaque écran a SA forme. Un squelette générique ne sert à rien : au moment
 * du remplacement, la mise en page saute, ce qui est plus désagréable qu'un
 * écran vide. Les squelettes ci-dessous reprennent les grilles réelles —
 * `rs-kpis` sur le tableau de bord, `rs-camp-grid` sur les campagnes,
 * `rs-lk-stats` sur LinkedIn — et les hauteurs du système typographique.
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
        <Link href="/" className="rs-sidebrand">
          <span className="rs-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <span className="rs-brand">{t('app.name')}</span>
        </Link>
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

function Barre({ l, h = 13, mb }: { l: string | number; h?: number; mb?: number }) {
  return <span className="rs-skel" style={{ width: l, height: h, marginBottom: mb }} />;
}

/** Surtitre, titre, chapô : toutes les pages ouvrent pareil. */
function EnTete({ chapo = 2 }: { chapo?: number }) {
  return (
    <>
      <Barre l={90} h={11} mb={10} />
      <Barre l="42%" h={32} mb={14} />
      {Array.from({ length: chapo }, (_, i) => (
        <Barre key={i} l={i === 0 ? '68%' : '44%'} h={15} mb={i === chapo - 1 ? 24 : 6} />
      ))}
    </>
  );
}

function Coque({ active, etroit, children }: { active: string; etroit?: boolean; children: ReactNode }) {
  return (
    <div className="rs-shell">
      <BarreLaterale active={active} />
      <main className="rs-main" style={etroit ? { maxWidth: 720 } : undefined} aria-busy="true">
        {children}
      </main>
    </div>
  );
}

/**
 * Tableau de bord : quatre indicateurs sur la grille `rs-kpis`, deux panneaux
 * côte à côte, puis les deux listes du bas.
 */
export function SqueletteTableauDeBord() {
  return (
    <Coque active="dashboard">
      <EnTete />
      <div className="rs-kpis">
        {Array.from({ length: 4 }, (_, i) => (
          // Hauteurs relevées sur la carte réelle : 17 + 33 + 18, deux
          // espacements de 8, padding de 14 — soit 112 px au total. À 14 px
          // près, tout ce qui suit glissait au remplacement.
          <div key={i} className="rs-kpi" style={{ display: 'grid', gap: 8 }}>
            <Barre l="62%" h={17} />
            <Barre l={64} h={33} />
            <Barre l="48%" h={18} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginTop: 16 }}>
        <section className="rs-card" style={{ display: 'grid', gap: 12 }}>
          <Barre l="30%" h={11} />
          <span className="rs-skel" style={{ height: 210, borderRadius: 6 }} />
        </section>
        <section className="rs-card" style={{ display: 'grid', gap: 12 }}>
          <Barre l="52%" h={11} />
          <span className="rs-skel" style={{ height: 210, borderRadius: 6 }} />
        </section>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginTop: 16 }}>
        <section className="rs-card" style={{ display: 'grid', gap: 14 }}>
          <Barre l="36%" h={11} />
          {['52%', '44%', '58%', '40%', '50%'].map((l, i) => (
            <div key={i} style={{ display: 'grid', gap: 6 }}>
              <Barre l={l} h={14} />
              <Barre l="70%" h={11} />
            </div>
          ))}
        </section>
        <section className="rs-card" style={{ display: 'grid', gap: 10 }}>
          <Barre l="46%" h={11} />
          <Barre l="80%" h={13} />
        </section>
      </div>
    </Coque>
  );
}

/** LinkedIn : trois compteurs, la carte de l'extension, celle des réglages. */
export function SqueletteLinkedIn() {
  return (
    <Coque active="linkedin" etroit>
      <EnTete />
      <section className="rs-lk-stats">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rs-lk-stat" style={{ display: 'grid', gap: 8 }}>
            <Barre l={40} h={26} />
            <Barre l="70%" h={12} />
          </div>
        ))}
      </section>
      <section className="rs-card" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        <Barre l="34%" h={15} />
        <Barre l="46%" h={13} />
        <Barre l={168} h={32} />
      </section>
      <section className="rs-card" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        <Barre l="28%" h={15} />
        <Barre l="76%" h={13} />
        <Barre l="100%" h={6} />
        <div style={{ display: 'flex', gap: 6 }}>
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="rs-skel" style={{ width: 48, height: 28, borderRadius: 6 }} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Barre l="100%" h={34} />
          <Barre l="100%" h={34} />
        </div>
      </section>
    </Coque>
  );
}

/** Campagnes : en-tête à deux boutons, puis la grille de deux colonnes. */
export function SqueletteCampagnes() {
  return (
    <Coque active="campaigns">
      <div className="rs-page-head">
        <div style={{ flex: 1 }}>
          <EnTete chapo={1} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Barre l={132} h={34} />
          <Barre l={148} h={34} />
        </div>
      </div>
      <div className="rs-camp-grid" style={{ marginTop: 18, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rs-camp-card" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Barre l="46%" h={15} />
              <span className="rs-skel" style={{ width: 58, height: 20, borderRadius: 999 }} />
            </div>
            <Barre l="100%" h={6} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', rowGap: 12, columnGap: 12 }}>
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} style={{ display: 'grid', gap: 5 }}>
                  <Barre l={46} h={20} />
                  <Barre l="66%" h={11} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Coque>
  );
}

/** Réception : une liste de conversations, deux lignes et une pastille chacune. */
export function SqueletteReception() {
  const gauche = ['38%', '30%', '44%', '34%', '40%', '28%'];
  const droite = ['72%', '64%', '80%', '58%', '70%', '66%'];
  return (
    <Coque active="inbox">
      <EnTete />
      <div style={{ display: 'grid', gap: 0 }}>
        {gauche.map((l, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 12,
              padding: '14px 0',
              borderTop: '1px solid var(--slate2)',
            }}
          >
            <div style={{ display: 'grid', gap: 7 }}>
              <Barre l={l} h={14} />
              <Barre l={droite[i] ?? '70%'} h={12} />
            </div>
            <span className="rs-skel" style={{ width: 64, height: 20, borderRadius: 999 }} />
          </div>
        ))}
      </div>
    </Coque>
  );
}

/**
 * Thèmes de veille : une carte par thème, ses mots-clés en pastilles, son
 * historique d'exécution en lignes.
 */
export function SqueletteThemes() {
  return (
    <Coque active="sources">
      <div className="rs-page-head">
        <div style={{ flex: 1 }}>
          <EnTete chapo={1} />
        </div>
        <Barre l={152} h={34} />
      </div>
      <div style={{ display: 'grid', gap: 14, marginTop: 4 }}>
        {Array.from({ length: 2 }, (_, i) => (
          <section key={i} className="rs-card" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Barre l="34%" h={15} />
              <span className="rs-skel" style={{ width: 54, height: 20, borderRadius: 999 }} />
              <span style={{ marginLeft: 'auto' }}>
                <Barre l={140} h={14} />
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[120, 96, 140, 88, 110].map((w, j) => (
                <span key={j} className="rs-skel" style={{ width: w, height: 22, borderRadius: 6 }} />
              ))}
            </div>
            <Barre l="26%" h={11} />
            {Array.from({ length: 3 }, (_, j) => (
              <div
                key={j}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr auto',
                  gap: 12,
                  padding: '9px 0',
                  borderTop: '1px solid var(--slate2)',
                }}
              >
                <Barre l={44} h={12} />
                <Barre l="34%" h={12} />
                <Barre l={130} h={12} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </Coque>
  );
}

/** Fiche prospect : identité, signaux liés, séquence, contacts. */
export function SqueletteProspects() {
  return (
    <Coque active="prospects">
      <Barre l={110} h={11} mb={10} />
      <Barre l="52%" h={32} mb={8} />
      <Barre l={190} h={13} mb={24} />
      {[2, 3, 2].map((lignes, i) => (
        <section key={i} className="rs-card" style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
          <Barre l="24%" h={11} />
          {Array.from({ length: lignes }, (_, j) => (
            <div key={j} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <Barre l={['58%', '44%', '52%'][j % 3] ?? '50%'} h={14} />
                <Barre l="36%" h={11} />
              </div>
              <Barre l={52} h={18} />
            </div>
          ))}
        </section>
      ))}
    </Coque>
  );
}

/**
 * Annuaire : le formulaire de recherche d'abord — il est utilisable sans
 * attendre les résultats — puis la liste.
 */
export function SqueletteAnnuaire() {
  return (
    <Coque active="annuaire">
      <EnTete />
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
        {[220, 150, 110, 130].map((w, i) => (
          <div key={i} style={{ display: 'grid', gap: 6 }}>
            <Barre l={Math.round(w * 0.5)} h={11} />
            <Barre l={w} h={36} />
          </div>
        ))}
        <Barre l={112} h={36} />
      </div>
      <Barre l="30%" h={13} mb={14} />
      <div style={{ display: 'grid', gap: 0 }}>
        {['44%', '32%', '52%', '38%', '46%', '30%'].map((l, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 12,
              padding: '14px 0',
              borderTop: '1px solid var(--slate2)',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'grid', gap: 6 }}>
              <Barre l={l} h={14} />
              <Barre l="58%" h={11} />
            </div>
            <Barre l={128} h={30} />
          </div>
        ))}
      </div>
    </Coque>
  );
}

/** Écrans en liste de cartes : personas, modèles, signaux. */
export function SqueletteListe({
  active,
  cartes = 4,
  entete = false,
}: {
  active: string;
  cartes?: number;
  entete?: boolean;
}) {
  return (
    <Coque active={active}>
      {entete ? (
        <div className="rs-page-head">
          <div style={{ flex: 1 }}>
            <EnTete chapo={1} />
          </div>
          <Barre l={148} h={34} />
        </div>
      ) : (
        <EnTete />
      )}
      <div style={{ display: 'grid', gap: 14, marginTop: entete ? 4 : 0 }}>
        {Array.from({ length: cartes }, (_, i) => (
          <section key={i} className="rs-card" style={{ display: 'grid', gap: 10 }}>
            <Barre l={['42%', '34%', '48%', '38%', '44%'][i % 5] ?? '40%'} h={15} />
            <Barre l="86%" h={13} />
            <Barre l="62%" h={13} />
          </section>
        ))}
      </div>
    </Coque>
  );
}
