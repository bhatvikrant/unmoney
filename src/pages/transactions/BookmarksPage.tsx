import { useMemo, useState } from "react";
import { useLocation } from "react-router";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
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
              <div key={b._id} aria-current={b._id === openBookmark || undefined} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm aria-[current]:bg-accent">
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
                {edit ? <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label="Delete" onClick={async () => { const doc = view.bookmarks.find((x) => x._id === b._id); if (doc && (await confirm({ title: "Delete this bookmark?", description: "The entry it was made from stays in the ledger." }))) void undoable.bookmark(doc); }}><Trash2 className="size-4" /></Button> : null}
              </div>
            );
          })}
        </div>
      </Page>
    </>
  );
}
