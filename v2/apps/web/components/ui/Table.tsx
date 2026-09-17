import type { ReactNode } from 'react';

export type ColonneTable = {
  cle: string;
  titre: string;
  num?: boolean;
  largeur?: string;
  /** La colonne ne coupe jamais au milieu d'un mot (tour de correction F6, point 20). */
  nowrap?: boolean;
  /**
   * `max-width` posée en plus de `largeur` (tour de correction F6, point 25 bis) : sur une colonne
   * dont le contenu porte lui-même un `overflow: hidden`/ellipse (ex. l'aperçu d'un modèle de
   * message), `largeur` seule ne suffit pas — en `table-layout: auto`, la largeur minimale d'une
   * colonne suit le contenu qui ne peut pas s'enrouler, jamais la valeur `width` posée dessus.
   * `largeurMax: '0'` supprime cette largeur minimale forcée par le contenu, pour que CETTE colonne
   * soit la seule à se compresser quand les autres (marquées `nowrap`) ont déjà pris ce qu'il leur
   * faut — la largeur réellement rendue reste celle que l'algorithme de mise en page attribue à la
   * colonne, jamais littéralement 0.
   */
  largeurMax?: string;
};

export type TableProps = {
  colonnes: ColonneTable[];
  lignes: Record<string, ReactNode>[];
  vide?: ReactNode;
};

function classeColonne(colonne: ColonneTable): string | undefined {
  return [colonne.num && 'num', colonne.nowrap && 'jr-nowrap'].filter(Boolean).join(' ') || undefined;
}

function styleColonne(colonne: ColonneTable): { width?: string; maxWidth?: string } | undefined {
  if (!colonne.largeur && colonne.largeurMax === undefined) return undefined;
  return { width: colonne.largeur, maxWidth: colonne.largeurMax };
}

export function Table({ colonnes, lignes, vide }: TableProps) {
  return (
    <table className="jr-table">
      <thead>
        <tr>
          {colonnes.map((colonne) => (
            <th key={colonne.cle} className={classeColonne(colonne)} style={styleColonne(colonne)}>
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
                // `largeur`/`largeurMax` posées aussi sur la cellule, pas seulement l'en-tête
                // (tour de correction F6, point 20) : suffisant dans la plupart des navigateurs en
                // `table-layout: auto`, mais plus sûr de le répéter que d'en dépendre.
                <td key={colonne.cle} className={classeColonne(colonne)} style={styleColonne(colonne)}>
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
