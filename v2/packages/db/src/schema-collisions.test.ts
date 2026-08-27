/**
 * Collisions de noms entre le schéma du socle actuel (`supabase/migrations/`, à
 * la racine du dépôt) et celui du v2 (`v2/supabase/migrations/`).
 *
 * Pourquoi ce test existe : jusqu'à la bascule, les migrations du v2 s'appliquent
 * sur la MÊME base Postgres que le socle actuel. Un objet `public` créé des deux
 * côtés ne provoque pas d'erreur franche — `create table if not exists` devient un
 * no-op silencieux, et c'est la suite de la migration (index, RLS, contrainte sur
 * une colonne qui n'existe pas) qui casse, en laissant la base à mi-chemin, avec
 * de vraies données dedans.
 *
 * Toute collision doit donc être CONNUE et justifiée dans `COLLISIONS_TRAITEES`.
 * Le test échoue sur ce qui n'y figure pas : le signal arrive avant le `db push`,
 * pas pendant.
 *
 * Le test se met en sommeil si le dossier legacy n'existe pas — le jour de la
 * bascule, `v2/` remonte à la racine et l'ancien socle disparaît.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const V2_MIGRATIONS = join(ICI, '..', '..', '..', 'supabase', 'migrations');
const LEGACY_MIGRATIONS = join(ICI, '..', '..', '..', '..', 'supabase', 'migrations');

/**
 * Collisions assumées, avec la raison pour laquelle elles ne cassent rien. Une
 * entrée ici est une décision, pas une exception de confort : elle dit comment la
 * migration du v2 compose avec l'objet déjà en place.
 */
const COLLISIONS_TRAITEES: Readonly<Record<string, string>> = {
  recruitment_agencies_blacklist:
    "20260825120000 ajoute `organization_id` en `add column if not exists` et retire l'unicité " +
    'globale héritée du modèle mono-organisation. Les lignes du socle actuel gardent un ' +
    'organization_id nul, donc deviennent des entrées globales partagées par les deux socles.',
  normalize_agency_name:
    '`create or replace` volontaire : les deux corps produisent les mêmes clés (la classe de ' +
    "caractères s'écrit différemment mais l'échappement SQL les rend équivalentes), donc les " +
    'entrées déjà normalisées continuent de correspondre.',
};

/**
 * Objets `public` qui SURVIVENT à un jeu de migrations, avec le fichier qui les
 * crée. Les fichiers sont rejoués dans l'ordre et les suppressions comptent : une
 * table créée par le socle puis supprimée plus tard (`20260616230000_drop_dead_tables`
 * en supprime huit) n'entre en collision avec rien.
 *
 * Limite assumée : un `drop ... cascade` peut emporter des objets dépendants que ce
 * parseur ne suit pas. Le risque penche du bon côté — on signalerait une collision
 * qui n'existe plus, jamais l'inverse.
 */
function objetsVivants(dossier: string): Map<string, string> {
  const vivants = new Map<string, string>();
  const fichiers = readdirSync(dossier)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // `create [or replace] | drop` + genre + [if (not) exists] + [<schema>.]<nom>.
  // Le schéma est capturé pour écarter ce qui ne vit pas dans `public` : le schéma
  // `app` du v2 n'existe pas côté socle actuel, il n'entre en collision avec rien.
  // Les genres non listés (policy, constraint, column, index, trigger) sont hors
  // sujet : leur nom est local à leur table, pas partagé.
  const RE =
    /\b(create|drop)\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view|function|type)\s+(?:if\s+(?:not\s+)?exists\s+)?"?([a-z_][a-z0-9_]*)"?(?:\s*\.\s*"?([a-z_][a-z0-9_]*)"?)?/gi;

  for (const fichier of fichiers) {
    const sql = readFileSync(join(dossier, fichier), 'utf8')
      .split('\n')
      .filter((ligne) => !ligne.trimStart().startsWith('--'))
      .join('\n');

    for (const [, action, premier, second] of sql.matchAll(RE)) {
      if (!action || !premier) continue;
      // Deux identifiants = `<schema>.<nom>` ; un seul = un objet de `public`.
      const schema = second ? premier.toLowerCase() : 'public';
      const nom = (second ?? premier).toLowerCase();
      if (schema !== 'public') continue;
      if (action.toLowerCase() === 'drop') vivants.delete(nom);
      else if (!vivants.has(nom)) vivants.set(nom, fichier);
    }
  }
  return vivants;
}

const legacyPresent = existsSync(LEGACY_MIGRATIONS);

describe.skipIf(!legacyPresent)('collisions de schéma entre le socle actuel et le v2', () => {
  const v2 = objetsVivants(V2_MIGRATIONS);
  const legacy = objetsVivants(LEGACY_MIGRATIONS);
  const communs = [...v2.keys()].filter((nom) => legacy.has(nom)).sort();

  it('trouve bien des objets des deux côtés (garde-fou du parseur)', () => {
    // Sans ça, une regex cassée rendrait le test vert en ne trouvant plus rien.
    expect(v2.size).toBeGreaterThan(30);
    expect(legacy.size).toBeGreaterThan(10);
  });

  it('ne laisse aucune collision non traitée', () => {
    const nonTraitees = communs
      .filter((nom) => !(nom in COLLISIONS_TRAITEES))
      .map((nom) => `${nom} (v2: ${v2.get(nom)} / actuel: ${legacy.get(nom)})`);

    expect(
      nonTraitees,
      'Objets `public` créés des deux côtés sans décision écrite. Les migrations du v2 ' +
        "s'appliquent sur la base du socle actuel : décider comment elles composent avec " +
        "l'objet en place, puis documenter le choix dans COLLISIONS_TRAITEES.",
    ).toEqual([]);
  });

  it("ne garde pas d'entrée morte dans la liste des collisions traitées", () => {
    // Une justification qui ne correspond plus à rien induit en erreur le prochain
    // qui lit ce fichier.
    const mortes = Object.keys(COLLISIONS_TRAITEES).filter((nom) => !communs.includes(nom));
    expect(mortes).toEqual([]);
  });
});
