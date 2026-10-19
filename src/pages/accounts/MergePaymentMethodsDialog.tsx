import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AccountRow } from "@/lib/app";
import { useOp, useStore } from "@/lib/store";
import { applyOp } from "../../../shared/ops";
import { Money } from "@/components/shell/Money";
import { CardThumb } from "@/components/CardFace";
import { cardColorOf } from "../../../shared/defaults";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Merges the ticked payment methods into the one the user keeps. What it will do (or why it
 * cannot) is worked out up front on the local data, the way the import screen previews an import.
 */
export function MergePaymentMethodsDialog({ methods, onOpenChange, onMerged }: {
  methods: AccountRow[] | null; onOpenChange: (open: boolean) => void; onMerged: () => void;
}) {
  const { view, userId } = useStore();
  const merge = useOp("accounts.merge");
  const [picked, setPicked] = useState<string | null>(null);
  const list = useMemo(() => methods ?? [], [methods]);
  // Keep the one with the most entries unless the user picks another.
  const busiest = useMemo(() => {
    const count = (id: string) => view.transactions.filter((t) => t.accountId === id || t.toAccountId === id).length;
    return [...list].sort((a, b) => count(b._id) - count(a._id))[0]?._id;
  }, [list, view.transactions]);
  const keep = picked && list.some((a) => a._id === picked) ? picked : busiest;
  const others = useMemo(() => list.filter((a) => a._id !== keep), [list, keep]);

  const preview = useMemo(() => {
    if (!keep || !others.length) return null;
    try {
      const op = { id: "preview", kind: "accounts.merge" as const, args: { sourceIds: others.map((a) => a._id), targetId: keep as Id<"accounts"> }, at: 0 };
      return applyOp(view, op, { userId: (userId ?? "") as Id<"users"> }).result as { moved: number; droppedTransfers: number };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "These cannot be merged" };
    }
  }, [view, userId, keep, others]);

  const kept = list.find((a) => a._id === keep);
  async function run() {
    try {
      await merge({ sourceIds: others.map((a) => a._id), targetId: keep as Id<"accounts"> });
      setPicked(null);
      onMerged();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not merge them"); }
  }

  return (
    <Dialog open={!!methods} onOpenChange={(o) => { if (!o) setPicked(null); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge {list.length} payment methods</DialogTitle>
          <DialogDescription>Pick the one to keep. Everything on the others moves into it.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Payment method to keep" className="max-h-64 overflow-y-auto rounded-lg border divide-y">
          {list.map((a) => {
            const on = a._id === keep;
            return (
              <button key={a._id} type="button" role="radio" aria-checked={on} onClick={() => setPicked(a._id)}
                className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent/50", on && "bg-primary/10")}>
                <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-primary" : "border-input")}>{on ? <span className="size-2 rounded-full bg-primary" /> : null}</span>
                {a.kind === "card" || a.kind === "debitCard" ? <CardThumb color={cardColorOf(a)} /> : null}
                <span className="min-w-0 flex-1 truncate">{a.name}{on ? <span className="ml-1.5 text-xs text-muted-foreground">keep</span> : null}</span>
                <Money amount={a.balance} kind={a.balance < 0 ? "expense" : "plain"} className="text-xs" />
              </button>
            );
          })}
        </div>
        {preview && "error" in preview ? (
          <p className="text-sm text-destructive" role="alert">{preview.error}</p>
        ) : kept ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{preview?.moved ?? 0} {preview?.moved === 1 ? "entry moves" : "entries move"} to {kept.name}, with any schedules, bookmarks and cards billed to them. Their opening balances add up, so {kept.name} ends with the combined balance.</li>
            {preview?.droppedTransfers ? <li>{preview.droppedTransfers} {preview.droppedTransfers === 1 ? "transfer" : "transfers"} between them {preview.droppedTransfers === 1 ? "is" : "are"} removed; a fee on one stays as a Transfer Fee expense.</li> : null}
            <li>{others.map((a) => a.name).join(", ")} {others.length === 1 ? "is" : "are"} then removed. This can't be undone.</li>
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!preview || "error" in preview} onClick={() => void run()}>Merge into {kept?.name}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
