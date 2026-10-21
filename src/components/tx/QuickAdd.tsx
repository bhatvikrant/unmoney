import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Repeat, Star } from "lucide-react";
import { toast } from "sonner";
import type { TxFields } from "../../../shared/ops";
import { fromTemplate, quickItems } from "../../../shared/quickAdd";
import { useStore, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useOpenEntry } from "@/lib/nav";
import { useToday } from "@/lib/today";
import { primeKeyboard } from "@/lib/keyboard";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";

/** Save an entry without the form, with Undo and Open in the toast. */
export function useQuickSave() {
  const { dispatch } = useStore();
  const openEntry = useOpenEntry();
  const { fmt, accountName, categoryLabel } = useApp();
  return async (fields: TxFields) => {
    try {
      const id = await dispatch("transactions.create", fields);
      const what = fields.note || (fields.type === "transfer" ? `${accountName(fields.accountId)} → ${accountName(fields.toAccountId)}` : categoryLabel(fields));
      toast.success(`Added ${what} · ${fmt(fields.amount)}`, {
        duration: 8000,
        action: { label: "Undo", onClick: () => void dispatch("transactions.remove", { id }).catch(() => toast.error("Could not undo")) },
        cancel: { label: "Open", onClick: () => openEntry(id) },
      });
      return id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
      return null;
    }
  };
}

/**
 * Hold the + (or press Q): the top bookmarks and the last entry again, each saved for today in one
 * tap. "New entry" opens the form as a plain tap on + would.
 */
export function QuickAddSheet({ open, onOpenChange, onNew }: { open: boolean; onOpenChange: (o: boolean) => void; onNew: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const view = useView();
  const nav = useNavigate();
  const today = useToday();
  const save = useQuickSave();
  const { accountName, categoryLabel } = useApp();
  const items = useMemo(() => (open ? quickItems(view) : []), [open, view]);
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Quick add" description={`Saved for today in one tap`}>
      <div className="px-2">
        {items.length ? (
          <div className="border-y bg-card">
            {items.map((it) => {
              const t = it.template;
              const what = t.note || (t.type === "transfer" ? "Transfer" : categoryLabel(t));
              const where = t.type === "transfer" ? `${accountName(t.accountId)} → ${accountName(t.toAccountId)}` : `${categoryLabel(t)} · ${accountName(t.accountId)}`;
              return (
                <button key={it.key} type="button" className="w-full flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0 text-sm text-left hover:bg-accent/40 active:bg-accent"
                  onClick={() => { onOpenChange(false); void save(fromTemplate(t, today)); }}>
                  {it.label === "bookmark" ? <Star className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Repeat className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{it.label === "last" ? `Again: ${what}` : what}</div>
                    <div className="text-xs text-muted-foreground truncate">{where}</div>
                  </div>
                  <Money amount={t.amount} kind={t.type === "income" ? "income" : t.type === "expense" ? "expense" : "transfer"} />
                </button>
              );
            })}
          </div>
        ) : (
          <p className="px-1 py-3 text-sm text-muted-foreground">Bookmark an entry you add often (open it and tap the star) and it shows here, ready to add in one tap.</p>
        )}
        <div className="flex gap-2 pt-3">
          <Button variant="outline" className="flex-1" onClick={() => { onOpenChange(false); nav("/bookmarks"); }}>All bookmarks</Button>
          <Button className="flex-1" onClick={(e) => { primeKeyboard(e.currentTarget); onOpenChange(false); onNew(e); }}>New entry</Button>
        </div>
      </div>
    </BottomSheet>
  );
}
