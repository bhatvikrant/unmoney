import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronRight, Sprout } from "lucide-react";
import { toast } from "sonner";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useOp, useView } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { fromGmail, sipsOf } from "../../../shared/sips";
import { MarkSipSheet, pickOf } from "@/components/tx/MarkSipSheet";

/**
 * On an expense read from Gmail (a saved entry or a waiting draft): which SIP it is filed under,
 * with a way back to the ledger, or "Mark as SIP", which lists the earlier payments like it to make
 * a SIP of. Entries typed by hand are never SIPs, so they show nothing.
 */
export function SipToggle({ tx, draft, onDone }: { tx?: Doc<"transactions">; draft?: Doc<"drafts">; /** After a SIP is made: a draft's screen closes, as the draft is saved now. */ onDone?: () => void }) {
  const view = useView();
  const nav = useNavigate();
  const mark = useOp("sips.mark");
  const unmark = useOp("sips.unmark");
  const [open, setOpen] = useState(false);
  const sip = tx?.sipId ? sipsOf(view).find((s) => s.id === tx.sipId) : undefined;
  const picked = useMemo(() => (tx ? [pickOf(tx)] : draft ? [pickOf(draft)] : []), [tx, draft]);
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed");

  if (tx && sip) {
    return (
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
        <Sprout className="size-4 shrink-0 text-muted-foreground" />
        <button type="button" onClick={() => nav("/sips")} className="flex min-w-0 flex-1 items-center gap-1 text-left hover:underline underline-offset-4">
          <span className="truncate">SIP · {sip.name}</span>
        </button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void unmark({ ids: [tx._id] }).then(() => toast("Back on the daily list and counted as spending", {
          duration: 8000, action: { label: "Undo", onClick: () => void mark({ id: sip.id, transactionIds: [tx._id] }).catch(fail) },
        })).catch(fail)}>Not a SIP</Button>
      </div>
    );
  }
  const p = tx ?? draft?.proposal;
  const gmail = tx ? fromGmail(tx) : !!draft;
  if (!p || !gmail || p.type !== "expense" || p.amount <= 0) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 border-b px-4 py-2.5 text-left text-sm hover:bg-accent/40">
        <Sprout className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">Mark as SIP</span>
        <span className="text-xs text-muted-foreground">An investment, not spending</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </button>
      {open ? <MarkSipSheet picked={picked} open onOpenChange={setOpen} onDone={onDone} /> : null}
    </>
  );
}
