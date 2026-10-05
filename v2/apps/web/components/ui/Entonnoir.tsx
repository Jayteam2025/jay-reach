export type EtapeEntonnoir = {
  valeur: number;
  libelle: string;
  taux?: string;
};

export type EntonnoirProps = {
  etapes: EtapeEntonnoir[];
};

const formatteurNombre = new Intl.NumberFormat('fr-FR');

// Le séparateur › est toujours rendu : composants.css masque celui de la
// dernière étape (.jr-etape-entonnoir:last-child i { display: none }).
export function Entonnoir({ etapes }: EntonnoirProps) {
  return (
    <div className="jr-entonnoir">
      {etapes.map((etape, index) => (
        <div className="jr-etape-entonnoir" key={index}>
          <b>{formatteurNombre.format(etape.valeur)}</b>
          <span>
            {etape.libelle}
            {etape.taux && <em>{etape.taux}</em>}
          </span>
          <i>›</i>
        </div>
      ))}
    </div>
  );
}
