import { useCallback } from "react";
import { useNavigate } from "react-router";

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
