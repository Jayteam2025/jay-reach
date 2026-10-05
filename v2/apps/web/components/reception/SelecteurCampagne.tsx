'use client';

import type { ChangeEvent } from 'react';

export interface SelecteurCampagneProps {
  campagnes: { id: string; nom: string }[];
  valeur: string | null;
  filtre: string;
  toutesLabel: string;
}

/**
 * Sélecteur de campagne de la liste des fils (« Toutes les campagnes ▾» de la
 * maquette) : `<form method="get">` natif, soumis automatiquement au
 * changement — même résultat qu'un `useRouter().push`, sans dépendre du
 * contexte du routeur applicatif (`useRouter` exige un `<AppRouterContext>`
 * monté, absent d'un rendu isolé comme `renderToStaticMarkup` en test). Garde
 * `?filtre=` (champ caché), retire `?fil=` (le fil choisi peut ne plus
 * appartenir au périmètre de la nouvelle campagne).
 */
export function SelecteurCampagne({ campagnes, valeur, filtre, toutesLabel }: SelecteurCampagneProps) {
  function onChange(evenement: ChangeEvent<HTMLSelectElement>) {
    evenement.currentTarget.form?.requestSubmit();
  }

  return (
    <form method="get" action="/inbox">
      {filtre !== 'a_traiter' && <input type="hidden" name="filtre" value={filtre} />}
      <select name="campagneId" className="jr-puce" defaultValue={valeur ?? ''} onChange={onChange} aria-label={toutesLabel}>
        <option value="">{toutesLabel}</option>
        {campagnes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nom}
          </option>
        ))}
      </select>
    </form>
  );
}
