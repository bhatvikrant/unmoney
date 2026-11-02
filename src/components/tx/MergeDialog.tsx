import { useState } from "react";
import { toast } from "sonner";
import { useOp } from "@/lib/store";
import { offerUndo, useUndoableDelete } from "@/lib/undo";
import { withMail } from "../../../shared/ops";
import { TransactionRow, type Draft, type Tx } from "@/components/tx/TransactionList";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** What is being merged: two entries that are one payment, or an entry and the Gmail draft of the same payment. */
export type MergePair = { kind: "entries"; a: Tx; b: Tx } | { kind: "link"; tx: Tx; draft: Draft };

/** One way to join them: a card showing the entry as it will be, ticked when picked. */
function Choice({ label, tx, on, onPick }: { label: string; tx: Tx; on: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick}
      className={cn("w-full overflow-hidden rounded-lg border text-left transition-colors", on ? "border-primary ring-2 ring-primary/30" : "hover:bg-accent/40")}>
      <div className={cn("px-4 pt-2 text-xs font-medium", on ? "text-primary" : "text-muted-foreground")}>{label}</div>
      <TransactionRow tx={tx} showDate className="pointer-events-none border-b-0" />
    </button>
  );
}

/**
 * Merge two picked rows into one entry. Two entries: the one whose details are kept stays and the
 * other is deleted (transactions.merge). An entry and a Gmail draft: the entry stays and is linked
 * to that mail, as typed or with the mail's details (drafts.link). Either can be undone, from the
 * toast or later from the entry (transactions.unmerge).
 */
export function MergeDialog({ pair, onOpenChange, onDone }: { pair: MergePair | null; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  return (
    <Dialog open={!!pair} onOpenChange={onOpenChange}>
      <DialogContent>{pair ? <MergeBody key={pair.kind === "entries" ? `${pair.a._id}:${pair.b._id}` : `${pair.tx._id}:${pair.draft._id}`} pair={pair} onCancel={() => onOpenChange(false)} onDone={onDone} /> : null}</DialogContent>
    </Dialog>
  );
}

function MergeBody({ pair, onCancel, onDone }: { pair: MergePair; onCancel: () => void; onDone: () => void }) {
  const undoable = useUndoableDelete();
  const link = useOp("drafts.link");
  const unmerge = useOp("transactions.unmerge");
  const [busy, setBusy] = useState(false);
  // two entries: keep the one typed in by hand when only one of them came from mail, as its note and category are the user's own
  const [pick, setPick] = useState<"a" | "b">(() => (pair.kind === "entries" && pair.a.source && !pair.b.source ? "b" : "a"));

  let title: string, description: string, action: string, blocked: string | null = null;
  let choices: { key: "a" | "b"; label: string; tx: Tx }[];
  if (pair.kind === "entries") {
    title = "Merge into one entry";
    description = "Pick the one whose details to keep. The other is deleted: its tags and photos move over, and its note and email fill in what the kept one has none of.";
    action = "Merge";
    choices = [{ key: "a", label: "Keep this one", tx: pair.a }, { key: "b", label: "Keep this one", tx: pair.b }];
    if (new Set([...pair.a.photoIds, ...pair.b.photoIds]).size > 3) blocked = "Together they have more than 3 photos. Remove some from one of them first.";
  } else {
    const { tx, draft } = pair;
    title = "Merge with the email";
    description = "Your entry is linked to this email and the draft goes away. Nothing new is added.";
    action = "Merge";
    choices = [
      { key: "a", label: "Keep your entry's details", tx },
      { key: "b", label: "Use the email's details", tx: { ...tx, ...withMail(tx, draft.proposal) } },
    ];
    if (tx.source && tx.source.messageId !== draft.messageId) blocked = "That entry is already linked to another email.";
  }

  async function go() {
    if (busy || blocked) return;
    setBusy(true);
    try {
      if (pair.kind === "entries") {
        const [keep, gone] = pick === "a" ? [pair.a, pair.b] : [pair.b, pair.a];
        await undoable.merge(keep._id, gone._id); // its own toast offers Undo
      } else {
        const { tx, draft } = pair;
        await link({ id: draft._id, transactionId: tx._id, useMail: pick === "b" });
        offerUndo("Merged with the email", () => unmerge({ id: tx._id }));
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not do that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {/* min-w-0: a long note would otherwise widen the dialog's grid column past its edge */}
      <div role="radiogroup" aria-label={title} className="min-w-0 space-y-2">
        {choices.map((c) => <Choice key={c.key} label={c.label} tx={c.tx} on={pick === c.key} onPick={() => setPick(c.key)} />)}
      </div>
      {blocked ? <p className="text-sm text-destructive">{blocked}</p> : null}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => void go()} disabled={busy || !!blocked}>{action}</Button>
      </DialogFooter>
    </>
  );
}
