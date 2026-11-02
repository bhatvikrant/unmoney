import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ChevronRight, Sprout } from "lucide-react";
import { toast } from "sonner";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useOp, useView } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { sipFor, sipsOf } from "../../../shared/sips";

/**
 * On a saved expense: which SIP it is filed under (with a way back to the ledger), or "Mark as SIP",
 * which files it under the running SIP it fits or makes a new one named after its note.
 */
export function SipToggle({ tx }: { tx: Doc<"transactions"> }) {
  const view = useView();
  const nav = useNavigate();
  const create = useOp("sips.create");
  const mark = useOp("sips.mark");
  const unmark = useOp("sips.unmark");
  const remove = useOp("sips.remove");
  const sips = sipsOf(view);
  const sip = tx.sipId ? sips.find((s) => s.id === tx.sipId) : undefined;
  const fits = useMemo(() => (tx.sipId ? undefined : sipFor(sips, tx)), [sips, tx]);
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed");

  if (sip) {
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
  async function onMark() {
    try {
      if (fits) {
        await mark({ id: fits.id, transactionIds: [tx._id] });
        toast(`Added to ${fits.name}`, { duration: 8000, action: { label: "Undo", onClick: () => void unmark({ ids: [tx._id] }).catch(fail) } });
      } else {
        const name = tx.note.trim() || "SIP";
        const id = await create({ name, transactionIds: [tx._id] });
        toast(`${name} is a SIP now. Later payments like it stay off the daily list.`, {
          duration: 8000, action: { label: "Undo", onClick: () => void remove({ id }).catch(fail) },
        });
      }
    } catch (e) { fail(e); }
  }
  if (tx.amount <= 0) return null;
  return (
    <button type="button" onClick={() => void onMark()} className="flex w-full items-center gap-2 border-b px-4 py-2.5 text-left text-sm hover:bg-accent/40">
      <Sprout className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">{fits ? `Add to ${fits.name}` : "Mark as SIP"}</span>
      <span className="text-xs text-muted-foreground">An investment, not spending</span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
}
