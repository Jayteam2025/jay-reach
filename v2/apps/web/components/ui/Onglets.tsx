'use client';

import Link from 'next/link';

export type OngletItem = {
  href: string;
  libelle: string;
  compteur?: number;
};

export type OngletsProps = {
  onglets: OngletItem[];
  actif: string;
};

export function Onglets({ onglets, actif }: OngletsProps) {
  return (
    <nav className="jr-onglets">
      {onglets.map((onglet) => (
        <Link key={onglet.href} href={onglet.href} className={onglet.href === actif ? 'actif' : undefined}>
          {onglet.libelle}
          {onglet.compteur !== undefined && <span className="jr-compteur">{onglet.compteur}</span>}
        </Link>
      ))}
    </nav>
  );
}
