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

/** Chemins complets de toutes les clés feuilles sous `prefixe` dans `messages`. */
function clesDeclarees(prefixe: string): string[] {
  const racineNode = prefixe.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null || !(part in node)) return undefined;
    return (node as Record<string, unknown>)[part];
  }, messages);

  const feuilles: string[] = [];
  function parcourir(node: unknown, chemin: string) {
    if (typeof node === 'object' && node !== null) {
      for (const [cle, valeur] of Object.entries(node as Record<string, unknown>)) {
        parcourir(valeur, `${chemin}.${cle}`);
      }
    } else {
      feuilles.push(chemin);
    }
  }
  parcourir(racineNode, prefixe);
  return feuilles;
}

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

  // Sens inverse du test ci-dessus : une clé oubliée (jamais nettoyée après
  // une réécriture d'écran) ne casse aucun rendu, donc rien d'autre ne
  // l'attrape. Limité aux espaces ci-dessous (un par tâche qui les possède).
  //
  // Recherche textuelle brute plutôt qu'un suivi précis variable → namespace :
  // les écrans de ces espaces déclarent `t` de façons trop variées (simple
  // `const`, déstructuration d'un `Promise.all`, paramètre de fonction) pour
  // le regex de déclaration ci-dessus, qui sous-compterait les usages réels.
  const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * Comme `fichiersTsx`, mais inclut aussi les `.ts` (hors `.d.ts`) : le
   * contrôle des clés mortes doit voir des fonctions utilitaires comme
   * `apps/web/lib/jours-envoi.ts`, qui reçoivent un traducteur en paramètre
   * et n'ont aucune raison d'être un composant `.tsx`. Le contrôle direct
   * ci-dessus (clé utilisée → existe) reste volontairement limité aux
   * `.tsx`, voir son commentaire — seul le sens inverse en a besoin ici.
   */
  function fichiersTsEtTsx(dossier: string): string[] {
    const out: string[] = [];
    for (const entree of readdirSync(dossier)) {
      if (entree === 'node_modules' || entree === '.next' || entree === 'dist') continue;
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) out.push(...fichiersTsEtTsx(chemin));
      else if (chemin.endsWith('.tsx') || (chemin.endsWith('.ts') && !chemin.endsWith('.d.ts'))) out.push(chemin);
    }
    return out;
  }

  /**
   * Sous-espaces réellement déclarés SOUS `prefixe`
   * (`useTranslations('<prefixe>.<sous>')` / `getTranslations('<prefixe>.<sous>')`,
   * guillemets simples — même convention que `DECLARATION` ci-dessus) : une
   * clé qui y vit est alors référencée SANS le préfixe complet, juste sa
   * partie après `<sous>.`. Généralise le cas `card` (seul sous-espace pris en
   * compte jusqu'ici, `campagne.sources.card` déclaré par `CarteSource.tsx`)
   * à tout sous-espace qu'un composant déclare vraiment, plutôt que de lister
   * les noms un par un — constat tâche 20 : plusieurs sous-espaces sous
   * `reglages.expediteurs.*` (`.drawer`, `.linkedin`, `.linkDrawer`) que le
   * seul cas `card` ne couvrait pas, aurait signalé leurs clés comme mortes.
   */
  function sousEspacesDeclares(texte: string, prefixe: string): string[] {
    const motif = new RegExp(`(?:useTranslations|getTranslations)\\(\\s*(?:await\\s+)?'(${echapper(prefixe)}\\.[^']+)'`, 'g');
    const sousEspaces = new Set<string>();
    for (const m of texte.matchAll(motif)) {
      sousEspaces.add(m[1]!.slice(prefixe.length + 1));
    }
    return [...sousEspaces];
  }

  function clesMortesSous(prefixe: string): string[] {
    const texte = fichiersTsEtTsx(join(racine, 'apps/web'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const prefixeRegExp = new RegExp(`^${echapper(prefixe)}\\.`);
    const sousEspaces = sousEspacesDeclares(texte, prefixe);

    return clesDeclarees(prefixe).filter((complet) => {
      const relatif = complet.replace(prefixeRegExp, '');
      const candidats = [relatif];
      for (const sous of sousEspaces) {
        if (relatif.startsWith(`${sous}.`)) candidats.push(relatif.slice(sous.length + 1));
      }

      return !candidats.some((c) => {
        const litterale = new RegExp(`\\(\\s*['"\`]${echapper(c)}['"\`]`);
        if (litterale.test(texte)) return true;
        // Table (`apps/web/lib/jours-envoi.ts` : `Record<number, string>`
        // dont les valeurs sont les clés, ou `{ valeur, cle: 'mon' }`) ou
        // ternaire (`t(cond ? 'a' : 'b')`, `reglages.expediteurs.*`) : la clé
        // n'est jamais l'argument direct de `t`, juste une valeur littérale
        // qu'une variable transporte jusqu'à l'appel. Repérée par sa position
        // (après `:`, `,`, `[` ou `?`), pas en cherchant la chaîne n'importe
        // où : ça la distingue d'un texte ou d'un identifiant qui contiendrait
        // la même suite de caractères par coïncidence.
        const valeurDeTable = new RegExp(`[:,[?]\\s*['"\`]${echapper(c)}['"\`]`);
        if (valeurDeTable.test(texte)) return true;
        // Accès dynamique (`t(\`csvFields.${champ}\`)`) : la clé complète
        // n'apparaît jamais littéralement, seul le préfixe statique le fait.
        const pointFinal = c.lastIndexOf('.');
        if (pointFinal > 0) {
          const prefixeDynamique = c.slice(0, pointFinal + 1);
          const dynamique = new RegExp(`\`${echapper(prefixeDynamique)}\\$\\{`);
          if (dynamique.test(texte)) return true;
        }
        return false;
      });
    });
  }

  it.each(['campagne.sources', 'campagne.sequence', 'campagne.activite', 'campagne.reglages', 'campagne.nouvelle', 'contacts', 'reglages'])(
    'toutes celles déclarées sous %s sont référencées par un écran',
    (prefixe) => {
      expect(clesMortesSous(prefixe)).toEqual([]);
    },
  );
});
