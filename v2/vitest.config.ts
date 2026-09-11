import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // v2/ ne déclare pas de config PostCSS : sans cette ligne, Vite remonte
  // l'arborescence et attrape celle du legacy (le jour où v2/ est un sous-dossier
  // de jay-reach), faisant échouer `pnpm test` pour quiconque clone le dépôt.
  css: { postcss: { plugins: [] } },
  // Un paquet workspace importé par son nom (`@jay-reach/core`, jamais un
  // chemin relatif) résout par défaut vers son `dist/` (package.json
  // `exports`) — construit par `pnpm build`, qui tourne APRÈS `pnpm test` en
  // CI (v2-ci.yml) et n'existe donc pas sur un clone neuf. Ce plugin fait
  // résoudre ces imports vers la source via les `paths` de `tsconfig.base.json`
  // (déjà la vérité pour `tsc`), sans toucher aux `exports` des paquets — qui
  // restent `dist/` pour le build de production.
  plugins: [tsconfigPaths({ projects: ['tsconfig.base.json'] })],
  test: {
    // Chaque package fournit ses tests *.test.ts ; on les ramasse à la racine.
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
