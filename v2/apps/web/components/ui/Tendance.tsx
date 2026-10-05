export type TendanceProps = {
  valeurs: number[];
};

// Les hauteurs du kit sont en pixels absolus ; ici on les proportionne au plus
// grand point de la série pour que le composant reste correct quelles que
// soient les valeurs passées.
export function Tendance({ valeurs }: TendanceProps) {
  const max = Math.max(1, ...valeurs);
  return (
    <div className="jr-tendance">
      {valeurs.map((valeur, index) => (
        <i key={index} style={{ height: `${(Math.max(0, valeur) / max) * 100}%` }} />
      ))}
    </div>
  );
}
