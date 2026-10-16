import { useCallback, useState } from "react";
import type { Tx } from "@/components/tx/TransactionList";

/** Selection state shared by every screen that offers bulk actions on entries. */
export function useBulkSelect() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string, v: boolean) => setSelected((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; }), []);
  const start = useCallback((id?: string) => { setActive(true); setSelected(id ? new Set([id]) : new Set()); }, []);
  const exit = useCallback(() => { setActive(false); setSelected(new Set()); }, []);
  const selectAll = useCallback((txs: Tx[]) => setSelected(new Set(txs.map((t) => t._id))), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  return { active, selected, toggle, start, exit, selectAll, clear };
}
export type BulkSelect = ReturnType<typeof useBulkSelect>;
