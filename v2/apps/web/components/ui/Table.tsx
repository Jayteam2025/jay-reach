import type { ReactNode } from 'react';

export type ColonneTable = {
  cle: string;
  titre: string;
  num?: boolean;
  largeur?: string;
  /** La colonne ne coupe jamais au milieu d'un mot (tour de correction F6, point 20). */
  nowrap?: boolean;
};

export type TableProps = {
  colonnes: ColonneTable[];
  lignes: Record<string, ReactNode>[];
  vide?: ReactNode;
};

function classeColonne(colonne: ColonneTable): string | undefined {
  return [colonne.num && 'num', colonne.nowrap && 'jr-nowrap'].filter(Boolean).join(' ') || undefined;
}

export function Table({ colonnes, lignes, vide }: TableProps) {
  return (
    <table className="jr-table">
      <thead>
        <tr>
          {colonnes.map((colonne) => (
            <th key={colonne.cle} className={classeColonne(colonne)} style={colonne.largeur ? { width: colonne.largeur } : undefined}>
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
                <td key={colonne.cle} className={classeColonne(colonne)}>
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
