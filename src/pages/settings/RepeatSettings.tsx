import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useOp, useView } from "@/lib/store";
import { repeatsList } from "../../../shared/views";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/shell/misc";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FREQ_LABEL } from "@/components/tx/RepeatSheet";
import { toMinor } from "../../../shared/money";
import { amountInput, LOCALE_DECIMAL } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function RepeatSettings() {
  const { settings, accountName, categoryLabel } = useApp();
  const view = useView();
  const list = useMemo(() => repeatsList(view), [view]);
  const update = useOp("repeats.update");
  const remove = useOp("repeats.remove");
  const confirm = useConfirm();
  const [edit, setEdit] = useState<null | { r: Doc<"repeats">; frequency: Doc<"repeats">["frequency"]; endDate: string; nextDate: string; amount: string; note: string; active: boolean }>(null);
  return (
    <>
      <PageHeader back="/settings" title="Repeat settings" />
      <Page className="pb-8">
        {list && !list.length ? <EmptyState title="No schedules" hint="Set a repeat or installment from the Repeat button on an entry's date." /> : null}
        <div className="bg-card border-y">
          {list?.map((r) => {
            const t = r.template;
            const kind = t.type === "income" ? "income" : t.type === "expense" ? "expense" : "transfer";
            return (
              <button key={r._id} type="button" onClick={() => setEdit({ r, frequency: r.frequency, endDate: r.endDate ?? "", nextDate: r.nextDate, amount: amountInput(t.amount, settings.decimals), note: t.note, active: r.active })} className={cn("w-full flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm text-left hover:bg-accent/40", !r.active && "opacity-60")}>
                <div className="w-20 shrink-0 text-xs text-muted-foreground line-clamp-2">{t.type === "transfer" ? "Transfer" : categoryLabel(t)}</div>
                <div className="flex-1 min-w-0"><div className="truncate">{t.note || accountName(t.accountId)}</div><div className="text-xs text-muted-foreground">{r.kind === "installment" ? `${r.installmentCount} installments from ${r.startDate}` : `${FREQ_LABEL[r.frequency]} · next ${r.nextDate}${r.endDate ? ` · until ${r.endDate}` : ""}`}{!r.active ? " · stopped" : ""}</div></div>
                <Money amount={t.amount} kind={kind} />
              </button>
            );
          })}
        </div>
        <p className="px-4 py-3 text-xs text-muted-foreground">Changing or deleting a schedule never touches the entries it already created.</p>
      </Page>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.r.kind === "installment" ? "Installment plan" : "Repeat schedule"}</DialogTitle></DialogHeader>
          {edit && edit.r.kind === "repeat" ? (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Frequency</Label><Select value={edit.frequency} onValueChange={(v) => setEdit({ ...edit, frequency: v as typeof edit.frequency })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(FREQ_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Next date</Label><Input type="date" value={edit.nextDate} onChange={(e) => setEdit({ ...edit, nextDate: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>End date</Label><Input type="date" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Amount</Label><Input inputMode="decimal" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Note</Label><Input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></div>
              </div>
              <label className="flex items-center justify-between text-sm"><span>Active</span><Switch checked={edit.active} onCheckedChange={(v) => setEdit({ ...edit, active: v })} /></label>
            </div>
          ) : edit ? <p className="text-sm text-muted-foreground">All {edit.r.installmentCount} entries were created when the plan was set. Edit or delete them from the ledger (use "This and future" to change the rest).</p> : null}
          <DialogFooter>
            <Button variant="destructive" onClick={async () => { if (!(await confirm({ title: "Delete this schedule?", description: "Entries it already created stay in the ledger. No new ones will be added." }))) return; await remove({ id: edit!.r._id }); setEdit(null); }}>Delete schedule</Button>
            {edit?.r.kind === "repeat" ? <Button onClick={async () => { try { await update({ id: edit.r._id, frequency: edit.frequency, endDate: edit.endDate || null, nextDate: edit.nextDate, active: edit.active, template: { ...edit.r.template, amount: toMinor(edit.amount, settings.decimals, LOCALE_DECIMAL), note: edit.note } }); setEdit(null); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } }}>Save</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
