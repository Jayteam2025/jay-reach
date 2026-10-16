/**
 * Règle 9 : une réponse ne passe jamais inaperçue. `recordInboundReply` N'APPELLE PAS `notifyReply` : la
 * notification est le fait de l'appelant. Rien n'oblige donc un nouvel appelant à notifier ; ce test de SOURCE
 * est la seule garde contre un appelant qui n'existe pas encore (un test de comportement ne le verrait pas).
 *
 * Tout fichier de production qui appelle `recordInboundReply` doit aussi appeler `notifyReply`. Un appelant
 * légitime qui ne doit PAS notifier se déclare dans EXEMPTES, avec sa raison, plutôt que d'assouplir la règle.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const IGNORES = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);

/** Fichier (chemin relatif à v2/) -> pourquoi il peut appeler `recordInboundReply` sans notifier. */
const EXEMPTES: Record<string, string> = {
  'packages/core/src/inbox/record-reply.ts': 'définit recordInboundReply et notifyReply',
};

function sources(dossier: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    if (IGNORES.has(e.name)) continue;
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) out.push(...sources(chemin));
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(chemin);
  }
  return out;
}

/** Sans les commentaires : une mention en prose n'est pas un appel. */
const sansCommentaires = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const appelants = [...sources(join(RACINE, 'apps')), ...sources(join(RACINE, 'packages'))]
  .map((f) => ({ fichier: relative(RACINE, f), code: sansCommentaires(readFileSync(f, 'utf8')) }))
  .filter(({ code }) => /\brecordInboundReply\s*\(/.test(code));

describe('les appelants de recordInboundReply notifient', () => {
  it('le balayage voit les appelants connus (sinon il ne garde rien)', () => {
    const noms = appelants.map((a) => a.fichier);
    for (const attendu of [
      'apps/web/app/api/extension/linkedin/replies/route.ts',
      'apps/worker/src/handlers/releve-linkedin.ts',
      'packages/core/src/inbox/evenements-email.ts',
    ]) {
      expect(noms, `appelant connu absent du balayage : ${attendu}`).toContain(attendu);
    }
  });

  it('chaque fichier appelant appelle aussi notifyReply', () => {
    const fautifs = appelants
      .filter(({ fichier, code }) => !(fichier in EXEMPTES) && !/\bnotifyReply\s*\(/.test(code))
      .map((a) => a.fichier);
    expect(
      fautifs,
      `appelle recordInboundReply sans notifyReply (l'opérateur ne serait jamais prévenu) : ${fautifs.join(', ')}. ` +
        `Appeler notifyReply, ou déclarer le fichier dans EXEMPTES avec sa raison.`,
    ).toEqual([]);
  });
});
