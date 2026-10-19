import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches, kept up to date as the window resizes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Wide enough to show the ledger and an entry side by side. */
export const WIDE = "(min-width: 1024px)";
