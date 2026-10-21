import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { useMediaQuery, WIDE } from "@/lib/media";
import { LINK_PARAMS } from "../../shared/quickAdd";

/**
 * The open entry form sets this while it has unsaved changes, so leaving it through the app (Back,
 * Close, Esc, another row) asks first. Resolves true when it is fine to go.
 */
let leaveGuard: (() => Promise<boolean>) | null = null;
export function setLeaveGuard(g: (() => Promise<boolean>) | null) { leaveGuard = g; }
export function clearLeaveGuard(g: () => Promise<boolean>) { if (leaveGuard === g) leaveGuard = null; }
/** Run `go` now, or once the form's owner agrees to drop its changes. Synchronous when nothing is unsaved, so a tap still counts as one (iOS keyboard). */
function leave(go: () => void) {
  if (!leaveGuard) return go();
  void leaveGuard().then((ok) => {
    if (!ok) return;
    leaveGuard = null;
    go();
  });
}

/**
 * Back to the previous screen, or to `fallback` when UnMoney was opened straight on this one
 * (the home-screen "Add" shortcut, a link): going back from there would leave the app.
 */
export function useGoBack() {
  const nav = useNavigate();
  return useCallback((fallback = "/") => leave(() => {
    if ((window.history.state as { idx?: number } | null)?.idx) nav(-1);
    else nav(fallback, { replace: true });
  }), [nav]);
}

/** Lists other than the ledger that show an entry beside them on a wide screen, at <list>/t/<id>. */
const ENTRY_LISTS = ["/search", "/bookmarks", "/gmail"];
const entryListOf = (pathname: string) => ENTRY_LISTS.find((l) => pathname === l || pathname.startsWith(`${l}/t/`));

/** Params that belong to the entry form rather than to the list it was opened from. */
const ENTRY_PARAMS = ["date", "bookmark", "type", "from", "draft", ...LINK_PARAMS];

/** The list's own params (month, view, filters) from a URL's query string. */
function listQuery(search: string): string {
  const params = new URLSearchParams(search);
  for (const k of ENTRY_PARAMS) params.delete(k);
  const q = params.toString();
  return q ? `?${q}` : "";
}

/**
 * Open an entry (an id, or "new" with its own params), keeping the ledger's month, view and filters in
 * the URL when opened from the ledger. On a wide screen an entry opened from the ledger shows beside it, so it takes the
 * ledger's place in history rather than adding a step, and says so with `from=ledger` (in the URL,
 * because changing the ledger's month or filters rewrites the query and drops history state).
 * Elsewhere it is a new screen, and Back returns.
 */
export function useOpenEntry() {
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const wide = useMediaQuery(WIDE);
  return useCallback((id: string, extra: Record<string, string> = {}) => leave(() => {
    const list = wide ? entryListOf(pathname) : undefined;
    if (list) {
      // Beside Search or Bookmarks: the list keeps its own query (the search), the previous entry's bookmark goes,
      // and like the ledger the entry takes the list's place in history.
      const params = new URLSearchParams(search);
      params.delete("bookmark");
      params.delete("draft");
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
      const query = params.toString();
      nav(`${list}/t/${id}${query ? `?${query}` : ""}`, { replace: true });
      return;
    }
    const besideLedger = wide && (pathname === "/" || (pathname.startsWith("/t/") && new URLSearchParams(search).get("from") === "ledger"));
    // Only the ledger's params are worth carrying (an entry from Search or Stats goes back by history, and their
    // filters would only clutter its URL); an entry's own URL holds nothing but the ledger's, so it passes them on.
    const fromLedger = pathname === "/" || pathname.startsWith("/t/");
    const params = new URLSearchParams(fromLedger ? listQuery(search) : "");
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    if (besideLedger) params.set("from", "ledger");
    const query = params.toString();
    nav(`/t/${id}${query ? `?${query}` : ""}`, { replace: besideLedger || pathname.startsWith("/t/") });
  }), [nav, pathname, search, wide]);
}

/**
 * Leave an entry: back to the list as it is now (the ledger's month and filters, or the search, may
 * have changed while the entry was open) when it was shown beside it, else back to wherever it was opened from.
 */
export function useCloseEntry() {
  const nav = useNavigate();
  const goBack = useGoBack();
  const { pathname, search } = useLocation();
  return useCallback(() => leave(() => {
    const list = entryListOf(pathname);
    if (list && pathname !== list) {
      const params = new URLSearchParams(search);
      params.delete("bookmark");
      params.delete("draft");
      const query = params.toString();
      nav(`${list}${query ? `?${query}` : ""}`, { replace: true });
    } else if (new URLSearchParams(search).get("from") === "ledger") nav(`/${listQuery(search)}`, { replace: true });
    else goBack();
  }), [nav, goBack, pathname, search]);
}
