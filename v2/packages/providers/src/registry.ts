/**
 * Registre des providers : chargement + validation des manifests, résolution
 * par id et par catégorie. Le cœur ne dépend jamais d'une implémentation
 * concrète — seulement de ce registre.
 */
import {
  parseManifest,
  type ProviderCategory,
  type ProviderManifest,
} from './manifest.js';

export class ProviderRegistry {
  private readonly manifests = new Map<string, ProviderManifest>();

  /** Valide puis enregistre un manifest. Rejette les doublons d'id. */
  register(input: unknown): ProviderManifest {
    const manifest = parseManifest(input);
    if (this.manifests.has(manifest.id)) {
      throw new Error(`Provider déjà enregistré : ${manifest.id}`);
    }
    this.manifests.set(manifest.id, manifest);
    return manifest;
  }

  get(id: string): ProviderManifest | undefined {
    return this.manifests.get(id);
  }

  has(id: string): boolean {
    return this.manifests.has(id);
  }

  list(): readonly ProviderManifest[] {
    return [...this.manifests.values()];
  }

  listByCategory(category: ProviderCategory): readonly ProviderManifest[] {
    return this.list().filter((m) => m.category === category);
  }
}

/** Construit un registre à partir d'un catalogue (valide tout au chargement). */
export function createRegistry(catalog: readonly unknown[]): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const entry of catalog) {
    registry.register(entry);
  }
  return registry;
}
