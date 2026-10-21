import { useMemo, useState } from "react";
import { useLocation } from "react-router";
import { ArrowDown, ArrowUp, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuickSave } from "@/components/tx/QuickAdd";
import { useToday } from "@/lib/today";
import { fromTemplate, templateUsable } from "../../../shared/quickAdd";
import { useOp, useView } from "@/lib/store";
import { useUndoableDelete } from "@/lib/undo";
import { bookmarksList } from "../../../shared/views";
import { useApp } from "@/lib/app";
import { primeKeyboard } from "@/lib/keyboard";
import { useOpenEntry } from "@/lib/nav";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { Money } from "@/components/shell/Money";
import { EmptyState } from "@/components/shell/misc";
import { SwipeToDelete, useSwipedRow } from "@/components/shell/SwipeToDelete";
import { cn } from "@/lib/utils";

export default function BookmarksPage() {
  const openEntry = useOpenEntry();
  const { pathname, search } = useLocation();
  const openBookmark = pathname.startsWith("/bookmarks/t/") ? new URLSearchParams(search).get("bookmark") : null;
  const { accountName, categoryLabel } = useApp();
  const view = useView();
  const list = useMemo(() => bookmarksList(view), [view]);
  const undoable = useUndoableDelete();
  const confirm = useConfirm();
  const reorder = useOp("bookmarks.reorder");
  const [edit, setEdit] = useState(false);
  const swipe = useSwipedRow();
  const quickSave = useQuickSave();
  const today = useToday();
  // the link a Shortcut or Back Tap opens to add this bookmark for today, no form
  const copyLink = async (id: string) => {
    const url = `${location.origin}/t/new?bookmark=${id}&save=1`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied. Open it from a Shortcut to add this in one tap.");
    } catch {
      toast(url, { description: "Copy this link into a Shortcut's Open URLs action", duration: 15000 });
    }
  };
  const remove = (id: string) => {
    const doc = view.bookmarks.find((x) => x._id === id);
    if (!doc) return;
    void confirm({ title: "Delete this bookmark?", description: "The entry it was made from stays in the ledger." })
      .then((ok) => (ok ? undoable.bookmark(doc) : undefined)).finally(swipe.close);
  };
  const move = (i: number, dir: -1 | 1) => {
    if (!list) return;
    const ids = list.map((b) => b._id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder({ ids });
  };
  return (
    <>
      <PageHeader back="/" title="Bookmarks" right={<Button variant="ghost" size="icon" aria-label="Edit" className={cn(edit && "text-primary")} onClick={() => setEdit(!edit)}><Pencil className="size-4" /></Button>} />
      <Page>
        {list && !list.length ? <EmptyState title="No bookmarks" hint="Open any entry and tap Bookmark to keep it here for one-tap reuse." /> : null}
        <div className="bg-card border-y">
          {list?.map((b, i) => {
            const t = b.template;
            const kind = t.type === "income" ? "income" : t.type === "expense" ? "expense" : "transfer";
            return (
              <SwipeToDelete key={b._id} className="border-b last:border-b-0" disabled={edit} {...swipe.row(b._id)} onDelete={() => remove(b._id)}>
                <div aria-current={b._id === openBookmark || undefined} className="flex items-center gap-3 px-4 py-2.5 text-sm aria-[current]:bg-accent">
                  {edit ? (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="size-7" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                      <Button variant="ghost" size="icon" className="size-7" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                    </div>
                  ) : null}
                  <button type="button" className="flex-1 min-w-0 flex items-center gap-3 text-left" onClick={(e) => { if (edit) return; primeKeyboard(e.currentTarget); openEntry("new", { bookmark: b._id }); }}>
                    <div className="w-20 shrink-0 text-xs text-muted-foreground line-clamp-2">{t.type === "transfer" ? "Transfer" : categoryLabel(t)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{t.note || (t.type === "transfer" ? `${accountName(t.accountId)} → ${accountName(t.toAccountId)}` : categoryLabel(t))}</div>
                      <div className="text-xs text-muted-foreground truncate">{t.type === "transfer" ? `${accountName(t.accountId)} → ${accountName(t.toAccountId)}` : accountName(t.accountId)}</div>
                    </div>
                    <Money amount={t.amount} kind={kind} />
                  </button>
                  {/* one tap, no form: for the ones with an amount whose method and category are still there */}
                  {!edit && t.amount > 0 && templateUsable(view, t) ? <Button variant="ghost" size="icon" className="size-8 -mr-2" aria-label={`Add ${t.note || "this"} for today`} title="Add for today" onClick={() => void quickSave(fromTemplate(t, today))}><Plus className="size-4" /></Button> : null}
                  {edit ? <Button variant="ghost" size="icon" className="size-7" aria-label="Copy quick-add link" title="Copy quick-add link (for a Shortcut)" onClick={() => void copyLink(b._id)}><Link2 className="size-4" /></Button> : null}
                  {edit ? <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label="Delete" onClick={() => remove(b._id)}><Trash2 className="size-4" /></Button> : null}
                </div>
              </SwipeToDelete>
            );
          })}
        </div>
        {list?.length ? <p className="px-4 py-3 text-xs text-muted-foreground">Tap + to add one for today. Hold the + in the ledger for your top four. In edit mode, copy a bookmark's link for an iPhone Shortcut or Back Tap.</p> : null}
      </Page>
    </>
  );
}
