import { createContext, useContext, type ReactNode } from "react";
import { useLocation, useOutlet } from "react-router";
import { useMediaQuery, WIDE } from "@/lib/media";

/** Where a page shows on a wide screen: on its own, as the list beside an open item, or as that item. */
export type Column = "full" | "list" | "detail";
const ColumnContext = createContext<Column>("full");
export const useColumn = () => useContext(ColumnContext);

/** Position of a bottom action bar: fixed to the window on a screen of its own, kept to its column beside another. */
export function useBottomBar(): string {
  return useColumn() === "full" ? "fixed bottom-[var(--tabbar-h)] md:bottom-0 inset-x-0 md:left-56" : "sticky bottom-0";
}

/**
 * A list and the item opened from it (its child routes). On a phone they are separate screens; on a
 * wide screen the item opens in a panel beside the list, as the ledger does with entries. The list
 * stays mounted while items open and close, so it keeps its scroll and state.
 * `keyParams`: query params that make a different item at the same path (a new entry from another bookmark).
 */
export function SplitLayout({ list, label, width = 480, keyParams = [] }: { list: ReactNode; label: string; width?: number; keyParams?: string[] }) {
  const wide = useMediaQuery(WIDE);
  const item = useOutlet();
  const { pathname, search } = useLocation();
  if (!wide) return item ?? list;
  const sp = new URLSearchParams(search);
  const key = [pathname, ...keyParams.map((k) => sp.get(k) ?? "")].join("|");
  return (
    <div className="grid" style={item ? { gridTemplateColumns: `minmax(0, 1fr) ${width}px` } : undefined}>
      <ColumnContext.Provider value={item ? "list" : "full"}>
        <div className="min-w-0">{list}</div>
      </ColumnContext.Provider>
      {item ? (
        <ColumnContext.Provider value="detail">
          {/* a fresh panel (and scroll) for each item */}
          <aside key={key} className="sticky top-0 h-dvh overflow-y-auto border-l bg-background" aria-label={label}>{item}</aside>
        </ColumnContext.Provider>
      ) : null}
    </div>
  );
}
