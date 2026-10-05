export type BarreProgressionTon = 'normal' | 'attention' | 'erreur';

export type BarreProgressionProps = {
  valeur: number;
  ton?: BarreProgressionTon;
  /**
   * Second segment, en pourcentage lui aussi, dessiné à la suite du premier dans une teinte
   * atténuée. Sert à la carte « Envois du jour » : le segment plein compte ce qui est
   * réellement parti, celui-ci ce qui est remis au transporteur et attend sa fenêtre d'envoi.
   * Absent (défaut) : barre à un seul segment, comme partout ailleurs.
   */
  secondaire?: number;
};

export function BarreProgression({ valeur, ton, secondaire }: BarreProgressionProps) {
  const classe = ['jr-barre-prog', ton && ton !== 'normal' ? ton : undefined].filter(Boolean).join(' ');
  const borne = (n: number) => Math.min(100, Math.max(0, n));
  const pourcentage = borne(valeur);
  // Le second segment ne peut pas déborder de ce que le premier laisse : les deux partagent
  // une barre de 100 %, et un total supérieur n'aurait aucun sens à l'écran.
  const pourcentageSecondaire = secondaire === undefined ? 0 : Math.min(borne(secondaire), 100 - pourcentage);
  return (
    <div className={classe}>
      <i style={{ width: `${pourcentage}%` }} />
      {pourcentageSecondaire > 0 ? <i className="en-file" style={{ width: `${pourcentageSecondaire}%` }} /> : null}
    </div>
  );
}
