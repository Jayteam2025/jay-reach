export type TuileLogoMarque =
  | 'linkedin'
  | 'gmail'
  | 'outlook'
  | 'microsoft'
  | 'francetravail'
  | 'adzuna'
  | 'email'
  | 'lettre';
export type TuileLogoTaille = 'normal' | 'grande';

export type TuileLogoProps = {
  marque: TuileLogoMarque;
  lettre?: string;
  taille?: TuileLogoTaille;
};

export function TuileLogo({ marque, lettre, taille }: TuileLogoProps) {
  const classe = [
    'jr-tuile-logo',
    taille === 'grande' ? 'grande' : undefined,
    marque === 'email' || marque === 'lettre' ? 'em' : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  if (marque === 'lettre') {
    return <span className={classe}>{lettre}</span>;
  }
  if (marque === 'email') {
    return <span className={classe}>@</span>;
  }
  return (
    <span className={classe}>
      <img src={`/logos/${marque}.svg`} alt="" />
    </span>
  );
}
