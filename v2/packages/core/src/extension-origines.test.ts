/**
 * Une origine autorisée doit l'être dans les QUATRE réglages du manifeste.
 *
 * Elles remplissent des rôles différents et rien ne les relie :
 *  - `content_scripts.matches`  : le script est-il injecté sur la page ;
 *  - `externally_connectable`   : la page peut-elle parler à l'extension ;
 *  - `host_permissions`         : l'extension a-t-elle le droit sur ce domaine ;
 *  - `content_security_policy`  : l'extension peut-elle *appeler* ce domaine.
 *
 * En oublier une donne une panne muette et déroutante. C'est arrivé deux fois
 * le 31/08/2026 : d'abord les trois premières, ce qui empêchait l'écran de
 * dialoguer avec l'extension ; puis la CSP, qui bloquait tous les appels de
 * l'extension vers l'application — donc les envois LinkedIn, pas seulement
 * l'affichage du compte. Aucune des deux ne se voyait ailleurs que dans la
 * console du service worker.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifeste = JSON.parse(
  readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../../../apps/extension/manifest.json'), 'utf8'),
) as {
  host_permissions: string[];
  externally_connectable: { matches: string[] };
  content_scripts: { js?: string[]; matches: string[] }[];
  content_security_policy: { extension_pages: string };
};

/** Origines de l'application que l'extension doit joindre. LinkedIn est à part. */
const ORIGINES = ['http://localhost:3000', 'https://jay-reach.vercel.app', 'https://app.jay-reach.fr'];

describe('manifeste de l’extension', () => {
  it.each(ORIGINES)('%s est autorisée dans les quatre réglages', (origine) => {
    const dansLesHotes = manifeste.host_permissions.some((h) => h.startsWith(origine));
    const dansConnectable = manifeste.externally_connectable.matches.some((m) => m.startsWith(origine));
    const dansLesScripts = manifeste.content_scripts
      .filter((cs) => cs.js?.includes('content-oauth.js'))
      .some((cs) => cs.matches.some((m) => m.startsWith(origine)));
    const dansLaCsp = manifeste.content_security_policy.extension_pages.includes(origine);

    expect({ dansLesHotes, dansConnectable, dansLesScripts, dansLaCsp }).toEqual({
      dansLesHotes: true,
      dansConnectable: true,
      dansLesScripts: true,
      dansLaCsp: true,
    });
  });
});
