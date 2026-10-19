import { useOp, useView } from "@/lib/store";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ArrowDown, ArrowUp, Plus, Pencil, Trash2, CornerDownRight, WandSparkles, ChevronRight, ChevronDown, Check, X, Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { CLEANUP_UNDO_MS } from "../../../shared/ops";
import { lintCategories } from "../../../shared/categoryLint";
import { useApp } from "@/lib/app";
import { cn } from "@/lib/utils";
import { HistorySection } from "@/components/HistorySection";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { SegmentedTabs } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function CategoriesSettings() {
  const { categories } = useApp();
  const [type, setType] = useState<"expense" | "income">("expense");
  const create = useOp("categories.create");
  const update = useOp("categories.update");
  const remove = useOp("categories.remove");
  const reorder = useOp("categories.reorder");
  const setArchived = useOp("categories.setArchived");
  const [showArchived, setShowArchived] = useState(false);
  const ofType = categories.filter((c) => c.type === type && !c.deletedAt);
  const live = ofType.filter((c) => !c.archivedAt);
  const mains = live.filter((c) => !c.parentId);
  const subsOf = (id: string) => live.filter((c) => c.parentId === id);
  // Archived: main categories (their subcategories go with them) and subcategories archived on their own under a main still in use.
  const archived = ofType.filter((c) => c.archivedAt && (!c.parentId || mains.some((m) => m._id === c.parentId)));
  const nameOf = (id?: string) => categories.find((c) => c._id === id)?.name;
  const archive = (id: Id<"categories">, value: boolean) => setArchived({ ids: [id], archived: value }).then(() => setDialog(null)).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"));
  const tidy = useTidyUndo();
  const [dialog, setDialog] = useState<null | { id?: Id<"categories">; name: string; parentId: string }>(null);
  const move = (list: typeof mains, id: string, dir: -1 | 1) => {
    const ids = list.map((c) => c._id);
    const i = ids.indexOf(id as Id<"categories">);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder({ ids });
  };
  async function save() {
    if (!dialog) return;
    try {
      if (dialog.id) await update({ id: dialog.id, name: dialog.name, parentId: dialog.parentId === "main" ? null : (dialog.parentId as Id<"categories">) });
      else await create({ type, name: dialog.name, parentId: dialog.parentId === "main" ? undefined : (dialog.parentId as Id<"categories">) });
      setDialog(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  }
  const del = async (id: Id<"categories">, name: string) => {
    if (!window.confirm(`Delete "${name}"? Existing entries keep it as a deleted category.`)) return;
    await remove({ id });
  };
  return (
    <>
      <PageHeader back="/settings" title="Categories" right={<Button variant="ghost" size="icon" aria-label="Add" onClick={() => setDialog({ name: "", parentId: "main" })}><Plus className="size-5" /></Button>} />
      <Page className="pb-8">
        <TidyBanner tidy={tidy} />
        <SegmentedTabs value={type} onChange={setType} items={[{ value: "expense", label: "Expenses" }, { value: "income", label: "Income" }]} />
        <TidyRow />
        <div className="bg-card border-y">
          {mains.map((c) => (
            <div key={c._id} className="border-b last:border-b-0">
              <div className="flex items-center gap-1 px-2 py-1.5 text-sm">
                <Button variant="ghost" size="icon" className="size-7" aria-label="Up" onClick={() => move(mains, c._id, -1)}><ArrowUp className="size-4" /></Button>
                <Button variant="ghost" size="icon" className="size-7" aria-label="Down" onClick={() => move(mains, c._id, 1)}><ArrowDown className="size-4" /></Button>
                <span className="flex-1 px-1 font-medium">{c.name}</span>
                <Button variant="ghost" size="icon" className="size-7" aria-label="Add subcategory" onClick={() => setDialog({ name: "", parentId: c._id })}><CornerDownRight className="size-4" /></Button>
                <Button variant="ghost" size="icon" className="size-7" aria-label="Rename" onClick={() => setDialog({ id: c._id, name: c.name, parentId: "main" })}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label="Delete" onClick={() => del(c._id, c.name)}><Trash2 className="size-4" /></Button>
              </div>
              {subsOf(c._id).map((s) => (
                <div key={s._id} className="flex items-center gap-1 pl-8 pr-2 py-1 text-sm text-muted-foreground">
                  <Button variant="ghost" size="icon" className="size-6" aria-label="Up" onClick={() => move(subsOf(c._id), s._id, -1)}><ArrowUp className="size-3" /></Button>
                  <Button variant="ghost" size="icon" className="size-6" aria-label="Down" onClick={() => move(subsOf(c._id), s._id, 1)}><ArrowDown className="size-3" /></Button>
                  <span className="flex-1 px-1">{s.name}</span>
                  <Button variant="ghost" size="icon" className="size-6" aria-label="Edit" onClick={() => setDialog({ id: s._id, name: s.name, parentId: c._id })}><Pencil className="size-3" /></Button>
                  <Button variant="ghost" size="icon" className="size-6 text-destructive" aria-label="Delete" onClick={() => del(s._id, s.name)}><Trash2 className="size-3" /></Button>
                </div>
              ))}
            </div>
          ))}
        </div>
        {archived.length ? (
          <div className="mt-4">
            <button type="button" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived} className="w-full flex items-center px-4 py-1.5 text-sm text-muted-foreground">
              <ChevronDown className={cn("size-4 mr-1 transition-transform", !showArchived && "-rotate-90")} />
              <Archive className="size-3.5 mr-1.5" />
              <span className="flex-1 text-left">Archived</span>
              <span className="text-xs tabular">{archived.length}</span>
            </button>
            {showArchived ? (
              <div className="bg-card border-y">
                {archived.map((c) => {
                  const subs = ofType.filter((x) => x.parentId === c._id).length;
                  return (
                    <div key={c._id} className="flex items-center gap-1 border-b last:border-b-0 px-4 py-1.5 text-sm text-muted-foreground">
                      <span className="flex-1 min-w-0 truncate">{c.parentId ? `${nameOf(c.parentId)} › ` : ""}{c.name}{subs ? <span className="text-xs"> · {subs} {subs === 1 ? "subcategory" : "subcategories"}</span> : null}</span>
                      <Button variant="ghost" size="sm" className="h-7" onClick={() => archive(c._id, false)}><ArchiveRestore className="size-4" />Unarchive</Button>
                      <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label={`Delete ${c.name}`} onClick={() => del(c._id, c.name)}><Trash2 className="size-4" /></Button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="px-4 py-3 text-xs text-muted-foreground">Subcategories need the Subcategories switch in Settings. Edit a subcategory and set its parent to "Main category" to promote it. Archive a category you no longer use (edit it): it stops showing when you add entries, and entries already on it keep it.</p>
        <UndoLastTidy tidy={tidy} />
        <HistorySection scope="categories" className="mt-2" />
      </Page>
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog?.id ? "Edit category" : "New category"}</DialogTitle></DialogHeader>
          {dialog ? (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Name</Label><Input autoFocus value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && save()} /></div>
              {!dialog.id || !subsOf(dialog.id).length ? (
                <div className="space-y-1.5"><Label>Parent</Label>
                  <Select value={dialog.parentId} onValueChange={(v) => setDialog({ ...dialog, parentId: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="main">Main category</SelectItem>{mains.filter((m) => m._id !== dialog.id).map((m) => <SelectItem key={m._id} value={m._id}>Under {m.name}</SelectItem>)}</SelectContent></Select>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="sm:justify-between">
            {dialog?.id ? <Button variant="outline" onClick={() => archive(dialog.id!, true)}><Archive className="size-4" />Archive{!dialog.parentId || dialog.parentId === "main" ? (subsOf(dialog.id).length ? " with subcategories" : "") : ""}</Button> : <span />}
            <Button onClick={save} disabled={!dialog?.name.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Opens Tidy up, with how many quick fixes are waiting. */
function TidyRow() {
  const view = useView();
  const nav = useNavigate();
  const n = useMemo(() => lintCategories(view).length, [view]);
  return (
    <button type="button" onClick={() => nav("/settings/categories/tidy")} className="flex w-full items-center gap-3 border-b bg-card px-4 py-3 text-left hover:bg-accent/50 active:bg-accent">
      <WandSparkles className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Tidy up</div>
        <div className="text-xs text-muted-foreground">{n ? `${n} ${n === 1 ? "suggestion" : "suggestions"}: merge look-alikes, clear out unused` : "Merge look-alikes and clear out unused categories"}</div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

const DISMISSED_KEY = "unmoney:tidyBannerDismissed";
function readDismissed(): number {
  try { return Number(localStorage.getItem(DISMISSED_KEY)) || 0; } catch { return 0; }
}

type TidyUndo = { last: Doc<"categoryCleanups"> | undefined; bannerHidden: boolean; dismiss: () => void };

/**
 * The latest tidy-up while it can still be undone, and whether its banner was dismissed. The
 * banner is keyed by when the tidy-up ran, which stays the same once it syncs (its id does not).
 */
function useTidyUndo(): TidyUndo {
  const { categoryCleanups } = useView();
  const [now] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(readDismissed);
  const last = categoryCleanups[0];
  const undoable = last && !last.undoneAt && now - last.at < CLEANUP_UNDO_MS ? last : undefined;
  return {
    last: undoable,
    bannerHidden: !!undoable && dismissed === undoable.at,
    dismiss: () => {
      if (!undoable) return;
      setDismissed(undoable.at);
      try { localStorage.setItem(DISMISSED_KEY, String(undoable.at)); } catch { /* private mode */ }
    },
  };
}

function useUndo() {
  const undo = useOp("categories.undoCleanup");
  return (id: Id<"categoryCleanups">) => undo({ id }).catch((e) => toast.error(e instanceof Error ? e.message : "Could not undo"));
}

/** After a tidy-up: what changed, with Undo, until dismissed. */
function TidyBanner({ tidy: { last, bannerHidden, dismiss } }: { tidy: TidyUndo }) {
  const undo = useUndo();
  const location = useLocation();
  if (!last || bannerHidden) return null;
  const skipped = (location.state as { tidySkipped?: string[] } | null)?.tidySkipped ?? [];
  const n = last.label.length;
  return (
    <div className="mx-4 my-3 flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm" role="status">
      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div>Tidied up {n} {n === 1 ? "change" : "changes"}</div>
        <div className="text-xs text-muted-foreground line-clamp-2">{last.label.join(" · ")}</div>
        {skipped.length ? <div className="text-xs text-muted-foreground">{skipped.length} skipped: {skipped[0]}</div> : null}
      </div>
      <Button variant="outline" size="sm" className="h-7" onClick={() => undo(last._id)}>Undo</Button>
      <Button variant="ghost" size="icon" className="size-7" aria-label="Dismiss" onClick={dismiss}><X className="size-4" /></Button>
    </div>
  );
}

/** Undo stays reachable for 30 days after the banner is dismissed. */
function UndoLastTidy({ tidy: { last, bannerHidden } }: { tidy: TidyUndo }) {
  const undo = useUndo();
  if (!last || !bannerHidden) return null;
  const date = new Date(last.at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <div className="px-4 pb-6">
      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => undo(last._id)}>Undo last tidy-up ({date})</Button>
    </div>
  );
}
