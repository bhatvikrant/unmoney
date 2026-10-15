import { useOp } from "@/lib/store";
import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const KINDS: { value: string; label: string }[] = [
  { value: "cash", label: "Cash" }, { value: "bank", label: "Bank account" }, { value: "card", label: "Credit card" }, { value: "debitCard", label: "Debit card" },
  { value: "savings", label: "Savings" }, { value: "prepaid", label: "Top-up / prepaid" }, { value: "investment", label: "Investment" }, { value: "overdraft", label: "Overdraft" },
  { value: "loan", label: "Loan" }, { value: "insurance", label: "Insurance" }, { value: "other", label: "Other" },
];

export default function AccountGroupSettings() {
  const { groups, accounts } = useApp();
  const live = groups.filter((g) => !g.deletedAt).sort((a, b) => a.order - b.order);
  const create = useOp("accountGroups.create");
  const update = useOp("accountGroups.update");
  const remove = useOp("accountGroups.remove");
  const reorder = useOp("accountGroups.reorder");
  const [dialog, setDialog] = useState<null | { id?: Id<"accountGroups">; name: string; kind: string }>(null);
  const move = (i: number, dir: -1 | 1) => { const ids = live.map((g) => g._id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; reorder({ ids }); };
  return (
    <>
      <PageHeader back title="Account groups" right={<Button variant="ghost" size="icon" aria-label="Add" onClick={() => setDialog({ name: "", kind: "other" })}><Plus className="size-5" /></Button>} />
      <Page className="pb-8">
        <div className="bg-card border-y">
          {live.map((g, i) => (
            <div key={g._id} className="flex items-center gap-1 px-2 py-1.5 border-b last:border-b-0 text-sm">
              <Button variant="ghost" size="icon" className="size-7" aria-label="Up" onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Down" onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
              <div className="flex-1 px-1 min-w-0"><div className="truncate">{g.name}</div><div className="text-xs text-muted-foreground">{KINDS.find((k) => k.value === g.kind)?.label} · {accounts.filter((a) => a.groupId === g._id).length} accounts</div></div>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Edit" onClick={() => setDialog({ id: g._id, name: g.name, kind: g.kind })}><Pencil className="size-4" /></Button>
              <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label="Delete" onClick={async () => { try { await remove({ id: g._id }); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } }}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
        <p className="px-4 py-3 text-xs text-muted-foreground">The type decides how accounts in the group behave: credit cards get billing cycles, debit cards draw from a linked account, loans and overdrafts are liabilities.</p>
      </Page>
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog?.id ? "Edit group" : "New group"}</DialogTitle></DialogHeader>
          {dialog ? (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Name</Label><Input autoFocus value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Type</Label><Select value={dialog.kind} onValueChange={(v) => setDialog({ ...dialog, kind: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
          ) : null}
          <DialogFooter><Button disabled={!dialog?.name.trim()} onClick={async () => { try { if (dialog!.id) await update({ id: dialog!.id, name: dialog!.name, kind: dialog!.kind as never }); else await create({ name: dialog!.name, kind: dialog!.kind as never }); setDialog(null); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } }}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
