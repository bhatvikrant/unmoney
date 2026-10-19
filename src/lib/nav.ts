import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * Back to the previous screen, or to `fallback` when UnMoney was opened straight on this one
 * (the home-screen "Add" shortcut, a link): going back from there would leave the app.
 */
export function useGoBack() {
  const nav = useNavigate();
  return useCallback((fallback = "/") => {
    if ((window.history.state as { idx?: number } | null)?.idx) nav(-1);
    else nav(fallback, { replace: true });
  }, [nav]);
}

/** Params that belong to the entry form rather than to the list it was opened from. */
const ENTRY_PARAMS = ["date", "bookmark", "type"];

/**
 * Open an entry (an id, or "new" with its own params) keeping the list's month, view and filters in
 * the URL, so on a wide screen the ledger beside it stays as it was. Switching from one open entry
 * to another replaces it in history: Back then returns to the list.
 */
export function useOpenEntry() {
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  return useCallback((id: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams(search);
    for (const k of ENTRY_PARAMS) params.delete(k);
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    const query = params.toString();
    nav(`/t/${id}${query ? `?${query}` : ""}`, { replace: pathname.startsWith("/t/") });
  }, [nav, pathname, search]);
}
