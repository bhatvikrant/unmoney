import { useLocation } from "react-router";
import { useMediaQuery, WIDE } from "@/lib/media";
import { cn } from "@/lib/utils";
import TransactionsPage from "./TransactionsPage";
import TransactionEditor from "./TransactionEditor";

/**
 * The ledger (/) and an entry (/t/new, /t/:id). On a phone they are separate screens; on a wide
 * screen the entry opens in a panel beside the ledger. Both routes render this one component, so
 * the ledger stays mounted while entries open and close: it keeps its scroll, and its month and
 * filters ride along in the URL.
 */
export default function LedgerRoute() {
  const wide = useMediaQuery(WIDE);
  const { pathname } = useLocation();
  const entry = pathname.startsWith("/t/");
  if (!wide) return entry ? <TransactionEditor /> : <TransactionsPage />;
  return (
    <div className={cn("grid", entry && "grid-cols-[minmax(0,1fr)_440px]")}>
      <div className="min-w-0"><TransactionsPage /></div>
      {entry ? (
        <aside className="sticky top-0 h-dvh overflow-y-auto border-l bg-background" aria-label="Entry">
          {/* a fresh form for each entry opened from the list */}
          <TransactionEditor key={pathname} panel />
        </aside>
      ) : null}
    </div>
  );
}
