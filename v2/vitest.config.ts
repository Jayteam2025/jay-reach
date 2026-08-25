import { defineConfig } from 'vitest/config';

export default defineConfig({
  // v2/ ne déclare pas de config PostCSS : sans cette ligne, Vite remonte
  // l'arborescence et attrape celle du legacy (le jour où v2/ est un sous-dossier
  // de jay-reach), faisant échouer `pnpm test` pour quiconque clone le dépôt.
  css: { postcss: { plugins: [] } },
  test: {
    // Chaque package fournit ses tests *.test.ts ; on les ramasse à la racine.
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
