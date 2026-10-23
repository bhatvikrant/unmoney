import { useOp } from "@/lib/store";
import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { SwipeToDelete, useSwipedRow } from "@/components/shell/SwipeToDelete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const count = (n: number) => `${n} ${n === 1 ? "payment method" : "payment methods"}`;

export default function AccountGroupSettings() {
  const { groups, accounts } = useApp();
  const live = groups.filter((g) => !g.deletedAt).sort((a, b) => a.order - b.order);
  const create = useOp("accountGroups.create");
  const update = useOp("accountGroups.update");
  const remove = useOp("accountGroups.remove");
  const reorder = useOp("accountGroups.reorder");
  const [dialog, setDialog] = useState<null | { id?: Id<"accountGroups">; name: string }>(null);
  const [deleting, setDeleting] = useState<Doc<"accountGroups"> | null>(null);
  const swipe = useSwipedRow();
  const inGroup = (id: string) => accounts.filter((a) => a.groupId === id).length;
  const move = (i: number, dir: -1 | 1) => { const ids = live.map((g) => g._id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; reorder({ ids }); };
  async function save() {
    try {
      if (dialog!.id) await update({ id: dialog!.id, name: dialog!.name }); else await create({ name: dialog!.name });
      setDialog(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }
  return (
    <>
      <PageHeader back title="Groups" right={<Button variant="ghost" size="icon" aria-label="Add group" onClick={() => setDialog({ name: "" })}><Plus className="size-5" /></Button>} />
      <Page className="pb-8">
        <div className="bg-card border-y">
          {live.map((g, i) => (
            <SwipeToDelete key={g._id} className="border-b last:border-b-0" {...swipe.row(g._id)} onDelete={() => setDeleting(g)}>
              <div className="flex items-center gap-1 px-2 py-1.5 text-sm">
                <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${g.name} up`} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${g.name} down`} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                <div className="flex-1 px-1 min-w-0"><div className="truncate">{g.name}</div><div className="text-xs text-muted-foreground">{count(inGroup(g._id))}</div></div>
                <Button variant="ghost" size="icon" className="size-7" aria-label={`Rename ${g.name}`} onClick={() => setDialog({ id: g._id, name: g.name })}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g)}><Trash2 className="size-4" /></Button>
              </div>
            </SwipeToDelete>
          ))}
          {!live.length ? <div className="px-4 py-3 text-sm text-muted-foreground">No groups. Every payment method shows under "No group".</div> : null}
        </div>
        <p className="px-4 py-3 text-xs text-muted-foreground">Groups only organise your payment methods. What a method does (credit card billing, a debit card drawing from its bank account) comes from its own type, set in its editor. Move methods between groups from the Payment methods tab: tap select, pick some, then Move to.</p>
      </Page>
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog?.id ? "Rename group" : "New group"}</DialogTitle></DialogHeader>
          {dialog ? (
            <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); if (dialog.name.trim()) void save(); }}>
              <Label htmlFor="group-name">Name</Label><Input id="group-name" autoFocus value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />
            </form>
          ) : null}
          <DialogFooter><Button disabled={!dialog?.name.trim()} onClick={() => void save()}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) { setDeleting(null); swipe.close(); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>{deleting && inGroup(deleting._id) ? `Its ${count(inGroup(deleting._id))} move to "No group". Nothing else changes.` : "It is empty, so nothing else changes."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={async () => { try { await remove({ id: deleting!._id }); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } }}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
