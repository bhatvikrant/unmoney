import { useEffect, useLayoutEffect, useRef, type TouchEvent } from "react";

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/**
 * Single-key shortcuts for a screen: { n: newEntry, ArrowLeft: prev, … }. Ignored while typing,
 * with a modifier held, or while a dialog or sheet is open (it has the keyboard then).
 */
export function useShortcuts(keys: Record<string, () => void>, enabled = true) {
  const ref = useRef(keys);
  useLayoutEffect(() => { ref.current = keys; });
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const fn = ref.current[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [enabled]);
}

/**
 * Touch handlers for a horizontal swipe: left calls onLeft (next), right calls onRight (previous).
 * A swipe that starts on a swipe-to-delete row is that row's: a left swipe opens it, and a right
 * swipe on an open row closes it. A right swipe on a closed row still counts. `onRowTook` hears
 * about a left swipe that would have been "next" but went to a row.
 */
export function useSwipe(onLeft: () => void, onRight: () => void, enabled = true, onRowTook?: () => void) {
  const start = useRef<{ x: number; y: number; row?: string } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const row = (e.target as HTMLElement).closest?.("[data-swipe-row]")?.getAttribute("data-swipe-row") ?? undefined;
      start.current = enabled && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, row } : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.changedTouches[0].clientX - s.x;
      const dy = e.changedTouches[0].clientY - s.y;
      // clearly sideways and long enough, so scrolling the list never changes the month
      if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
      if (s.row && (dx < 0 || s.row === "open")) {
        if (dx < 0 && s.row !== "open") onRowTook?.();
        return;
      }
      if (dx < 0) onLeft(); else onRight();
    },
  };
}
