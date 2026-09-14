import type { ReactNode } from 'react';

export type ColonneTable = {
  cle: string;
  titre: string;
  num?: boolean;
  largeur?: string;
};

export type TableProps = {
  colonnes: ColonneTable[];
  lignes: Record<string, ReactNode>[];
  vide?: ReactNode;
};

export function Table({ colonnes, lignes, vide }: TableProps) {
  return (
    <table className="jr-table">
      <thead>
        <tr>
          {colonnes.map((colonne) => (
            <th
              key={colonne.cle}
              className={colonne.num ? 'num' : undefined}
              style={colonne.largeur ? { width: colonne.largeur } : undefined}
            >
              {colonne.titre}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lignes.length === 0 ? (
          <tr>
            <td colSpan={colonnes.length}>{vide}</td>
          </tr>
        ) : (
          lignes.map((ligne, index) => (
            <tr key={index}>
              {colonnes.map((colonne) => (
                <td key={colonne.cle} className={colonne.num ? 'num' : undefined}>
                  {ligne[colonne.cle]}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
