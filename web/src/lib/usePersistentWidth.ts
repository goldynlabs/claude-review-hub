import { useCallback, useEffect, useState } from "react";

interface Options {
  min?: number;
  max?: number;
}

/**
 * A panel width the user can drag, remembered per browser. Reading or writing
 * localStorage can throw (private windows, blocked site data), so a failure
 * only costs the preference, never the layout.
 */
export function usePersistentWidth(key: string, initial: number, { min = 200, max = 720 }: Options = {}) {
  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, Math.round(value))), [min, max]);

  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(key));
      return stored ? clamp(stored) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, String(width));
    } catch {
      // Preference not persisted; the session still works.
    }
  }, [key, width]);

  const resizeBy = useCallback((delta: number) => setWidth((current) => clamp(current + delta)), [clamp]);
  const reset = useCallback(() => setWidth(initial), [initial]);

  return { width, resizeBy, reset };
}
