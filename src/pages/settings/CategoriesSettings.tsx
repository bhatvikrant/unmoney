import { useOp } from "@/lib/store";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Pencil, Trash2, CornerDownRight } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
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
  const live = categories.filter((c) => c.type === type && !c.deletedAt);
  const mains = live.filter((c) => !c.parentId);
  const subsOf = (id: string) => live.filter((c) => c.parentId === id);
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
        <SegmentedTabs value={type} onChange={setType} items={[{ value: "expense", label: "Expenses" }, { value: "income", label: "Income" }]} />
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
        <p className="px-4 py-3 text-xs text-muted-foreground">Subcategories need the Subcategories switch in Settings. Edit a subcategory and set its parent to "Main category" to promote it.</p>
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
          <DialogFooter><Button onClick={save} disabled={!dialog?.name.trim()}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
