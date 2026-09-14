export type BarreProgressionTon = 'normal' | 'attention' | 'erreur';

export type BarreProgressionProps = {
  valeur: number;
  ton?: BarreProgressionTon;
};

export function BarreProgression({ valeur, ton }: BarreProgressionProps) {
  const classe = ['jr-barre-prog', ton && ton !== 'normal' ? ton : undefined].filter(Boolean).join(' ');
  const pourcentage = Math.min(100, Math.max(0, valeur));
  return (
    <div className={classe}>
      <i style={{ width: `${pourcentage}%` }} />
    </div>
  );
}
