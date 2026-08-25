/**
 * Composants Jay Reach (shadcn/ui + thème). Squelette T1 : les composants
 * arrivent avec le premier écran (T13). Pour l'instant, juste un utilitaire.
 */

/** Concatène des classes conditionnelles (variante minimale de `clsx`). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export const UI_VERSION = '0.0.0';
