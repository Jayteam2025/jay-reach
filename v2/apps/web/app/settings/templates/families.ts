/**
 * Types et regroupement des lignées de modèles.
 *
 * Ce module n'a PAS de directive : il est appelé aussi bien par la page, qui est
 * un composant serveur, que par le tableau, qui est un composant client. Tant
 * que `groupFamilies` vivait dans le fichier marqué `'use client'`, l'appeler
 * depuis la page faisait échouer le rendu en 500 — React refuse d'invoquer une
 * fonction client depuis le serveur, et l'écran Messages était donc mort.
 *
 * Le typage ne voyait rien : la frontière serveur/client ne s'exprime pas dans
 * les types, seulement dans les directives.
 */

export interface TemplateRow {
  id: string;
  parent_id: string | null;
  name: string;
  channel: string;
  locale: string;
  version: number;
  subject: string | null;
  body: string;
  sent_count: number;
  is_active: boolean;
}

export interface TemplateFamily {
  familyId: string;
  name: string;
  channel: string;
  versions: TemplateRow[];
}

/** Regroupe les lignes par lignée (parent_id, sinon id de la racine). */
export function groupFamilies(rows: TemplateRow[]): TemplateFamily[] {
  const byFamily = new Map<string, TemplateRow[]>();
  for (const r of rows) {
    const key = r.parent_id ?? r.id;
    const arr = byFamily.get(key);
    if (arr) arr.push(r);
    else byFamily.set(key, [r]);
  }
  return [...byFamily.entries()].map(([familyId, versions]) => {
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    const head = sorted.find((v) => v.is_active) ?? sorted[0]!;
    return { familyId, name: head.name, channel: head.channel, versions: sorted };
  });
}
