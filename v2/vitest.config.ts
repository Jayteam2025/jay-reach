import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Chaque package fournit ses tests *.test.ts ; on les ramasse à la racine.
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
