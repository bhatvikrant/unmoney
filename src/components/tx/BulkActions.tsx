import { useMemo, useState } from "react";
import { Bookmark, CalendarDays, StickyNote, Tag, Trash2, WalletCards, X } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import { useOp, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { sumKinds } from "../../../shared/ledger";
import { Money } from "@/components/shell/Money";
import { AccountPicker, CategoryPicker } from "@/components/tx/pickers";
import type { Tx } from "@/components/tx/TransactionList";
import type { BulkSelect } from "@/components/tx/useBulkSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Edit = null | "date" | "note" | "delete";

/** Action bar (plus the pickers and dialogs it opens) for the entries ticked in `bulk`. */
export function BulkBar({ bulk, txs }: { bulk: BulkSelect; txs: Tx[] }) {
  const { ledger } = useApp();
  const view = useView();
  const bulkUpdate = useOp("transactions.bulkUpdate");
  const bulkRemove = useOp("transactions.bulkRemove");
  const addBookmark = useOp("bookmarks.create");
  const removeBookmark = useOp("bookmarks.remove");
  const [edit, setEdit] = useState<Edit>(null);
  const [val, setVal] = useState("");
  const [sheet, setSheet] = useState<null | "category" | "account">(null);
  const [busy, setBusy] = useState(false);

  const chosen = useMemo(() => txs.filter((t) => bulk.selected.has(t._id)), [txs, bulk.selected]);
  const totals = useMemo(() => sumKinds(chosen, ledger), [chosen, ledger]);
  const n = chosen.length;
  // The category picker lists one type at a time; entries of the other type (and transfers) are left alone.
  const catType = chosen.some((t) => t.type === "expense") ? "expense" : "income";
  const ids = () => chosen.map((t) => t._id as Id<"transactions">);

  async function run(fn: () => Promise<string | void>) {
    if (busy) return;
    setBusy(true);
    try {
      // Only a partial result (some entries left alone) is worth saying out loud; the list itself shows the rest.
      const msg = await fn();
      if (msg) toast(msg);
      bulk.exit(); setEdit(null); setVal("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  const applyDialog = () => run(async () => {
    if (edit === "delete") { await bulkRemove({ ids: ids() }); return; }
    if (edit === "date") await bulkUpdate({ ids: ids(), date: val });
    if (edit === "note") await bulkUpdate({ ids: ids(), note: val });
  });

  const pickCategory = (categoryId: Id<"categories">, subcategoryId?: Id<"categories">) => run(async () => {
    const hit = chosen.filter((t) => t.type === catType);
    await bulkUpdate({ ids: hit.map((t) => t._id as Id<"transactions">), categoryId, subcategoryId });
    const skipped = n - hit.length;
    return skipped ? `Category set on ${hit.length}; ${skipped} ${catType === "expense" ? "income/transfer" : "expense/transfer"} skipped` : undefined;
  });

  const pickAccount = (accountId: Id<"accounts">) => run(async () => {
    await bulkUpdate({ ids: ids(), accountId });
    const skipped = chosen.filter((t) => t.type === "transfer" && t.toAccountId === accountId).length;
    return skipped ? `Payment method set on ${n - skipped}; ${skipped} transfer${skipped === 1 ? "" : "s"} to it skipped` : undefined;
  });

  // Bookmark every selected entry; if they are all bookmarked already, this removes those bookmarks instead.
  const bookmarkOf = useMemo(() => new Map(view.bookmarks.flatMap((b) => (b.transactionId ? [[b.transactionId as string, b._id] as const] : []))), [view.bookmarks]);
  const allMarked = n > 0 && chosen.every((t) => bookmarkOf.has(t._id));
  const toggleBookmarks = () => run(async () => {
    if (allMarked) {
      for (const t of chosen) await removeBookmark({ id: bookmarkOf.get(t._id)! });
      return;
    }
    const todo = chosen.filter((t) => !bookmarkOf.has(t._id));
    for (const t of todo) {
      await addBookmark({
        transactionId: t._id,
        template: { type: t.type, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId, subcategoryId: t.subcategoryId, amount: t.amount, note: t.note, description: t.description, tags: t.tags, feeAmount: t.feeAmount },
      });
    }
  });

  if (!bulk.active) return null;
  const off = n === 0 || busy;
  return (
    <>
      <div className="fixed bottom-[var(--tabbar-h)] md:bottom-0 inset-x-0 md:left-56 z-30 bg-background/95 backdrop-blur border-t md:safe-bottom">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2 px-3 pt-2 text-sm">
            <Button variant="outline" size="sm" onClick={() => (n === txs.length ? bulk.clear() : bulk.selectAll(txs))}>{n === txs.length && n > 0 ? "Clear" : "Select all"}</Button>
            <span className="text-muted-foreground">{n} selected</span>
            <span className="flex-1" />
            {n ? <Money amount={totals.income - totals.expense} className="text-xs" /> : null}
            <Button variant="ghost" size="icon" aria-label="Exit selection" onClick={bulk.exit}><X className="size-4" /></Button>
          </div>
          <div className="flex items-center gap-2 p-3 pt-1 overflow-x-auto">
            <Button variant="outline" size="sm" disabled={off} onClick={() => setEdit("date")}><CalendarDays className="size-4" />Date</Button>
            <Button variant="outline" size="sm" disabled={off} onClick={() => setSheet("category")}><Tag className="size-4" />Category</Button>
            <Button variant="outline" size="sm" disabled={off} onClick={() => setSheet("account")}><WalletCards className="size-4" />Payment method</Button>
            <Button variant="outline" size="sm" disabled={off} onClick={() => setEdit("note")}><StickyNote className="size-4" />Note</Button>
            <Button variant="outline" size="sm" disabled={off} onClick={toggleBookmarks}><Bookmark className="size-4" />{allMarked ? "Unbookmark" : "Bookmark"}</Button>
            <Button variant="destructive" size="sm" disabled={off} onClick={() => setEdit("delete")}><Trash2 className="size-4" />Delete</Button>
          </div>
        </div>
      </div>
      <CategoryPicker open={sheet === "category"} onOpenChange={(o) => !o && setSheet(null)} type={catType} onPick={pickCategory} />
      <AccountPicker open={sheet === "account"} onOpenChange={(o) => !o && setSheet(null)} onPick={pickAccount} title="Move to payment method" />
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit === "delete" ? `Delete ${n} ${n === 1 ? "entry" : "entries"}?` : edit === "date" ? `Set a new date for ${n}` : `Set a new note for ${n}`}</DialogTitle>
            {edit === "delete" ? <DialogDescription>This can't be undone.</DialogDescription> : null}
          </DialogHeader>
          {edit === "date" ? <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={val} onChange={(e) => setVal(e.target.value)} /></div> : null}
          {edit === "note" ? <div className="space-y-1.5"><Label>Note</Label><Input value={val} onChange={(e) => setVal(e.target.value)} /></div> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant={edit === "delete" ? "destructive" : "default"} onClick={applyDialog} disabled={busy || (edit === "date" && !val)}>{edit === "delete" ? "Delete" : "Apply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
