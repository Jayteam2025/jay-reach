/**
 * Chaque `t('clé')` du code doit exister dans le namespace déclaré juste
 * au-dessus.
 *
 * Ce contrôle manquait, et rien d'autre ne l'attrape : le typage ne relie pas
 * une chaîne à un fichier de messages, et une clé absente ne casse pas le rendu
 * — next-intl affiche le chemin brut. En production, l'écran de création de
 * campagne a ainsi affiché « campaignNew.minScoreLink » à la place du libellé,
 * parce que la clé avait été posée dans le mauvais bloc.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = fileURLToPath(new URL('.', import.meta.url));
const racine = join(ici, '../../..');
const messages = JSON.parse(readFileSync(join(ici, 'messages/fr.json'), 'utf8')) as Record<string, unknown>;

function existe(chemin: string): boolean {
  let node: unknown = messages;
  for (const part of chemin.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return true;
}

function fichiersTsx(dossier: string): string[] {
  const out: string[] = [];
  for (const entree of readdirSync(dossier)) {
    if (entree === 'node_modules' || entree === '.next' || entree === 'dist') continue;
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) out.push(...fichiersTsx(chemin));
    else if (chemin.endsWith('.tsx')) out.push(chemin);
  }
  return out;
}

const DECLARATION = /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([^']*)')?\s*\)/g;

describe('clés de traduction', () => {
  it('toutes celles utilisées dans les écrans existent dans leur namespace', () => {
    const manquantes: string[] = [];

    for (const fichier of fichiersTsx(join(racine, 'apps/web'))) {
      const src = readFileSync(fichier, 'utf8');
      const namespaces = new Map<string, string>();
      for (const m of src.matchAll(DECLARATION)) {
        namespaces.set(m[1]!, m[2] ?? '');
      }
      for (const [variable, prefixe] of namespaces) {
        const usage = new RegExp(`\\b${variable}\\(\\s*'([^']+)'`, 'g');
        for (const m of src.matchAll(usage)) {
          const cle = m[1]!;
          // Les clés construites (`channel.${x}`) ne sont pas vérifiables ici.
          if (cle.includes('${') || cle.includes('{')) continue;
          const complet = prefixe ? `${prefixe}.${cle}` : cle;
          if (!existe(complet)) {
            manquantes.push(`${relative(racine, fichier)} : ${variable}('${cle}') → ${complet}`);
          }
        }
      }
    }

    expect(manquantes).toEqual([]);
  });
});
