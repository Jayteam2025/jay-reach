import { useEffect, useState } from 'react';

/**
 * Retourne `value` apres `delay` ms sans changement. Pour debounce les
 * inputs de recherche (eviter de tirer une RPC a chaque keystroke).
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
