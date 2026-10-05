import { IconeLinkedin } from './IconeLinkedin';

export type TuileLogoMarque =
  | 'linkedin'
  | 'gmail'
  | 'outlook'
  | 'microsoft'
  | 'francetravail'
  | 'adzuna'
  | 'email'
  | 'lettre'
  | 'csv'
  | 'liste'
  | 'annuaire';
export type TuileLogoTaille = 'normal' | 'grande';

export type TuileLogoProps = {
  marque: TuileLogoMarque;
  lettre?: string;
  taille?: TuileLogoTaille;
};

/**
 * Icônes des sources « Manuel » (tour de correction F6, point 9) : mêmes
 * traits que celles de la barre latérale (`viewBox="0 0 24 24"`, `svg` nu,
 * taille et épaisseur de trait posées par la règle globale `.jr-app svg`) —
 * remplacent les glyphes texte (↑ ≡ ⌂) qui dénotaient à côté des logos des
 * autres sources.
 */
function IconeCsv() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M13 2v6h6" />
    </svg>
  );
}

function IconeListe() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </svg>
  );
}

function IconeAnnuaire() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16" />
      <path d="M13 21v-9h6a1 1 0 0 1 1 1v8" />
      <path d="M4 21h16" />
      <path d="M7.5 8h1M7.5 12h1M7.5 16h1M11 8h1M11 12h1M11 16h1" />
    </svg>
  );
}

export function TuileLogo({ marque, lettre, taille }: TuileLogoProps) {
  const classe = [
    'jr-tuile-logo',
    marque === 'linkedin' ? 'li' : undefined,
    taille === 'grande' ? 'grande' : undefined,
    marque === 'email' || marque === 'lettre' || marque === 'csv' || marque === 'liste' || marque === 'annuaire'
      ? 'em'
      : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  if (marque === 'lettre') {
    return <span className={classe}>{lettre}</span>;
  }
  if (marque === 'email') {
    return <span className={classe}>@</span>;
  }
  if (marque === 'csv') {
    return (
      <span className={classe}>
        <IconeCsv />
      </span>
    );
  }
  if (marque === 'liste') {
    return (
      <span className={classe}>
        <IconeListe />
      </span>
    );
  }
  if (marque === 'annuaire') {
    return (
      <span className={classe}>
        <IconeAnnuaire />
      </span>
    );
  }
  if (marque === 'linkedin') {
    return (
      <span className={classe}>
        <IconeLinkedin />
      </span>
    );
  }
  return (
    <span className={classe}>
      <img src={`/logos/${marque}.svg`} alt="" />
    </span>
  );
}
