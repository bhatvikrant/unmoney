import { useState } from "react";
import { Mail, Merge } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import { useOp, useView } from "@/lib/store";
import type { EntrySnapshot, MergeRecord } from "../../../shared/ops";
import { useConfirm } from "@/components/ConfirmDialog";
import { EntryMoney } from "@/components/shell/Money";
import { TransactionRow, type Tx } from "@/components/tx/TransactionList";
import { Button } from "@/components/ui/button";

/**
 * On a merged entry: what it was made of (the entries, or the entry and the Gmail draft, as they
 * were), and Undo merge, which puts them back however long ago it was (transactions.unmerge).
 */
export function MergedFrom({ tx }: { tx: Tx }) {
  const view = useView();
  const unmerge = useOp("transactions.unmerge");
  const ask = useConfirm();
  const [busy, setBusy] = useState(false);
  const m = tx.merged as MergeRecord | undefined;
  if (!m) return null;
  const draft = m.draftId ? view.drafts.find((d) => d._id === m.draftId) : undefined;
  // a row needs an id and a creation time; these never leave this list
  const asTx = (s: EntrySnapshot, key: string) => ({ ...s, _id: `${tx._id}:${key}`, _creationTime: 0, userId: tx.userId }) as Tx;
  const when = new Date(m.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  async function undo() {
    const ok = await ask({
      title: "Undo this merge?",
      description: m!.removed
        ? "This entry goes back to how it was before the merge, and the other entry comes back. Changes made to it since are lost."
        : "This entry goes back to how it was before the merge and is no longer linked to the email, which waits to be saved again. Changes made to it since are lost.",
      action: "Undo merge",
      destructive: false,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await unmerge({ id: tx._id as Id<"transactions"> });
      toast(m!.removed ? "Merge undone: both entries are back" : "Merge undone: the email is back to review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not undo the merge");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-y bg-card">
      <div className="flex items-center gap-2 px-4 py-2.5 text-sm">
        <Merge className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div>{m.removed ? "Merged from 2 entries" : "Merged with an email"}</div>
          <div className="text-xs text-muted-foreground">{when}</div>
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy} onClick={() => void undo()}>Undo merge</Button>
      </div>
      <div className="border-t">
        <TransactionRow tx={asTx(m.kept, "kept")} showDate className="opacity-80" />
        {m.removed ? <TransactionRow tx={asTx(m.removed, "removed")} showDate className="opacity-80" /> : (
          <div className="flex items-center gap-3 px-4 py-2.5 text-sm opacity-80">
            <div className="w-20 shrink-0 text-xs text-muted-foreground">Email</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 truncate"><Mail className="size-3 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate">{draft?.proposal.note || draft?.subject || "From Gmail"}</span></div>
              {draft ? <div className="truncate text-xs text-muted-foreground">{draft.subject}</div> : null}
            </div>
            {draft ? <div className="shrink-0 text-right"><EntryMoney type={draft.proposal.type} amount={draft.proposal.amount} /></div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
