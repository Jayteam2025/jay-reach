#!/usr/bin/env node
/**
 * Fabrique le paquet distribuable de l'extension LinkedIn : zippe
 * `apps/extension/` vers `apps/web/public/jay-reach-linkedin-extension.zip`,
 * pour que l'écran /settings/linkedin propose un téléchargement direct.
 * L'utilisateur décompresse puis « charge l'extension non empaquetée » dans Chrome.
 *
 * Sans dépendance : utilise la commande `zip` du système.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'apps/extension');
const outDir = resolve(root, 'apps/web/public');
const outFile = resolve(outDir, 'jay-reach-linkedin-extension.zip');

if (!existsSync(srcDir)) {
  console.error(`[package-extension] dossier introuvable : ${srcDir}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
rmSync(outFile, { force: true });

// Zippe le CONTENU de apps/extension (manifest.json à la racine du zip), en
// excluant les fichiers macOS. `-r` récursif, exécuté depuis srcDir.
const res = spawnSync('zip', ['-r', '-q', outFile, '.', '-x', '.DS_Store', '-x', '__MACOSX/*'], {
  cwd: srcDir,
  stdio: 'inherit',
});
if (res.status !== 0) {
  console.error('[package-extension] échec de la commande zip');
  process.exit(res.status ?? 1);
}
console.log(`[package-extension] paquet créé : ${outFile}`);
