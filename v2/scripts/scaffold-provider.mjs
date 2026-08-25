#!/usr/bin/env node
// Génère le squelette d'un provider. Usage :
//   pnpm reach:scaffold <category> <id> [outDir]
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CATEGORIES = ['signals', 'enrichment', 'email', 'linkedin', 'mail', 'inbox', 'ai', 'crm'];
const [, , category, id, outArg] = process.argv;

if (!category || !id) {
  console.error('Usage: pnpm reach:scaffold <category> <id> [outDir]');
  process.exit(1);
}
if (!CATEGORIES.includes(category)) {
  console.error(`Catégorie inconnue: "${category}". Attendu: ${CATEGORIES.join(', ')}`);
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(id)) {
  console.error(`Id invalide: "${id}" (minuscules, chiffres et tirets uniquement).`);
  process.exit(1);
}

const baseDir = outArg ?? 'packages/providers/src/providers';
const dir = join(baseDir, id);
if (existsSync(dir)) {
  console.error(`Le dossier existe déjà: ${dir}`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

writeFileSync(
  join(dir, 'manifest.ts'),
  `import type { ProviderManifest } from '../../manifest.js';

export const manifest: ProviderManifest = {
  id: '${id}',
  category: '${category}',
  labelKey: 'providers.${id}',
  fields: [
    { name: 'api_key', labelKey: 'providers.field.apiKey', type: 'password', secret: true, required: true },
  ],
};
`,
);

writeFileSync(
  join(dir, 'README.md'),
  `# Provider ${id} (${category})

Squelette généré par \`pnpm reach:scaffold\`. À faire :

1. Implémenter le contrat \`${category}\` (voir \`@jay-reach/core\`).
2. Ajouter des fixtures + tests de la fonction \`normalize\` si c'est un connecteur de signal.
3. Enregistrer \`manifest\` dans le catalogue / le registre.
`,
);

console.log(`✓ Provider "${id}" (${category}) créé dans ${dir}`);
console.log('  Prochaine étape : implémenter le contrat et enregistrer le manifest.');
