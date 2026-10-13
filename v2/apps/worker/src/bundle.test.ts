import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * Le worker est livré en bundle esbuild, et vitest ne joue que les sources. Un
 * module importé par le worker qui porte un garde « lancé directement »
 * (`import.meta.url === pathToFileURL(process.argv[1]).href`) le voit devenir vrai
 * une fois inliné dans `dist/index.js` : le CLI LinkedIn démarrait à la place du
 * worker (production arrêtée 25 minutes). On construit donc avec les options de
 * `package.json` et on lit ce qui sortirait.
 */
const MARQUE_CLI = 'Usage : jay-reach linkedin';
const GARDE_DIRECT = 'pathToFileURL(process.argv[1])';

async function construire(entree: string): Promise<string> {
  const res = await build({
    entryPoints: [fileURLToPath(new URL(`../${entree}`, import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    write: false,
    outdir: 'out',
    logLevel: 'silent',
  });
  return res.outputFiles.map((f) => f.text).join('\n');
}

describe('bundle du worker', () => {
  it.each(['src/index.ts', 'src/sante.ts'])(
    "%s n'embarque ni le CLI LinkedIn ni un garde « lancé directement »",
    async (entree) => {
      const sortie = await construire(entree);
      expect(sortie).not.toContain(MARQUE_CLI);
      expect(sortie).not.toContain(GARDE_DIRECT);
    },
  );

  it("le point d'entrée du CLI garde bien son garde (le test ci-dessus saurait voir)", async () => {
    const sortie = await construire('src/cli/linkedin.ts');
    expect(sortie).toContain(MARQUE_CLI);
    expect(sortie).toContain(GARDE_DIRECT);
  });
});
