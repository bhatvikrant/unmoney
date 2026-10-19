import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import { useOp, useView } from "@/lib/store";
import { expenseUrl, parseReturn } from "@/lib/unsplit";

/**
 * Where UnSplit sends the browser back once the expense made from UnMoney's entries is saved
 * (src/lib/unsplit.ts): the entries get their link to it, and the first of them opens.
 */
export default function UnsplitReturn() {
  const { hash } = useLocation();
  const nav = useNavigate();
  const view = useView();
  const setSplit = useOp("transactions.setSplit");
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const r = parseReturn(hash);
    if (!r) {
      toast.error("Couldn't read the split UnSplit sent back");
      nav("/", { replace: true });
      return;
    }
    const known = r.refs.filter((id) => view.transactions.some((t) => t._id === id));
    if (known.length) {
      void setSplit({ ids: known as Id<"transactions">[], split: { app: "unsplit", expenseId: r.expenseId } }).then(
        () => toast.success(`${known.length === 1 ? "Entry" : `${known.length} entries`} linked to the split on UnSplit`, { action: { label: "Open", onClick: () => window.open(expenseUrl(r.expenseId), "_blank", "noopener") } }),
        (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't link the entries"),
      );
    } else toast.error("The entries this split was made from are no longer here");
    nav(known.length ? `/t/${known[0]}` : "/", { replace: true });
    // once, from the hash the page was opened with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="p-8 text-center text-sm text-muted-foreground">Linking to UnSplit…</div>;
}
