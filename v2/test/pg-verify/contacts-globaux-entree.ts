// Point d'entrée bundlé (esbuild) pour `contacts-globaux.mjs` : la nouvelle implémentation
// (une requête Postgres) face à l'oracle (ancienne boucle en mémoire).
import { exporterCsv, listerContacts } from '../../packages/core/src/fonctions/contacts.js';
import { collecterContactsGlobauxAncien } from '../../packages/core/src/fonctions/contacts-globaux.oracle.js';
import type { Contexte } from '../../packages/core/src/fonctions/contexte.js';

export const nouveau = { listerContacts, exporterCsv };

type Filtres = Parameters<typeof collecterContactsGlobauxAncien>[1];

export const ancien = {
  collecter: collecterContactsGlobauxAncien,
  listerContacts: async (ctx: Contexte, entree: Partial<Filtres> & { page?: number }) => {
    const { page = 1, filtre = 'tous', ...autres } = entree;
    const filtres: Filtres = { filtre, ...autres };
    const { lignes, tronque } = await collecterContactsGlobauxAncien(ctx, filtres);
    return { total: lignes.length, lignes: lignes.slice((page - 1) * 50, page * 50), tronque };
  },
};
