import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { useApp } from "@/lib/app";
import { isTmpId } from "../../../shared/ops";
import { buildHandoff, canSplit, handoffUrl } from "@/lib/unsplit";
import type { Tx } from "@/components/tx/TransactionList";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const entries = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

/**
 * What happens next, before leaving for UnSplit: the chosen entries go there as one expense (a line
 * each when there are several), and the browser comes back here once it is saved (src/lib/unsplit.ts).
 */
export function SplitDialog({ open, onOpenChange, txs }: { open: boolean; onOpenChange: (open: boolean) => void; txs: Tx[] }) {
  const { settings, fmt, categoryLabel } = useApp();
  const chosen = useMemo(() => txs.filter(canSplit), [txs]);
  const skipped = txs.length - chosen.length;
  const relinked = chosen.filter((t) => t.split).length;
  // an entry made offline has no id UnSplit could send back yet
  const unsynced = chosen.filter((t) => isTmpId(t._id)).length;
  const total = chosen.reduce((sum, t) => sum + t.amount, 0);
  const n = chosen.length;
  const go = () => {
    const h = buildHandoff(chosen, { currency: settings.mainCurrency, decimals: settings.decimals, categoryLabel });
    if (h) window.location.assign(handoffUrl(h));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Split on UnSplit</DialogTitle>
          <DialogDescription>
            {n === 1 ? `This entry (${fmt(total)}) opens` : `These ${entries(n)} (${fmt(total)} together) open`} in UnSplit as one expense{n > 1 ? ", a line for each, so every line can go to different people" : ""}.
            Pick the group and who paid there. Once it is saved you come back here, and the {n === 1 ? "entry gets" : "entries get"} a link to the split.
          </DialogDescription>
        </DialogHeader>
        {skipped || relinked || unsynced ? (
          <ul className="text-sm text-muted-foreground space-y-1">
            {skipped ? <li>{entries(skipped)} left out: only expenses can be split.</li> : null}
            {relinked ? <li>{relinked === 1 ? "One of them is" : `${relinked} of them are`} already split; the new split replaces that link.</li> : null}
            {unsynced ? <li>{entries(unsynced)} {unsynced === 1 ? "has" : "have"} not synced yet. Try again in a moment.</li> : null}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={go} disabled={n === 0 || unsynced > 0}><ExternalLink className="size-4" />Open UnSplit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
