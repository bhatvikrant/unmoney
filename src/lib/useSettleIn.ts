import { useLayoutEffect, type RefObject } from "react";

/** The rise itself (index.css, `.settle-row`), and the longest stagger, however many rows show. */
const RISE_MS = 340;
const SPREAD_MS = 300;

/**
 * When `key` changes (a list first shows, or shows a new month), the rows of the list in `ref` that
 * are on screen rise into place, a beat apart: a phone gets its 10 or so, a desktop its 25 or 30,
 * and rows below the fold just show. The stagger shrinks with the count, so the whole rise takes
 * the same time on any screen.
 *
 * It works on the DOM directly, before the first paint: one read of the rows' positions, then a
 * class and a delay on each, removed once they have landed. No React state, so no re-render of
 * the list. `rows` selects the row elements inside `ref`. Off with reduced motion.
 */
export function useSettleIn(
  ref: RefObject<HTMLElement | null>,
  rows: string,
  key: unknown,
) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || key === undefined || key === false) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const bottom = window.innerHeight;
    const shown: HTMLElement[] = [];
    for (const el of root.querySelectorAll<HTMLElement>(rows)) {
      const r = el.getBoundingClientRect();
      if (r.top >= bottom) break;
      if (r.bottom > 0) shown.push(el);
    }
    if (shown.length === 0) return;
    const step = Math.min(30, SPREAD_MS / shown.length);
    shown.forEach((el, i) => {
      el.style.setProperty("--settle-delay", `${Math.round(i * step)}ms`);
      el.classList.add("settle-row");
    });
    const land = () => {
      for (const el of shown) {
        el.classList.remove("settle-row");
        el.style.removeProperty("--settle-delay");
      }
    };
    const t = window.setTimeout(land, RISE_MS + SPREAD_MS + 100);
    return () => {
      window.clearTimeout(t);
      land();
    };
    // `rows` is a constant selector at each call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
