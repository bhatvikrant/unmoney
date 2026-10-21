import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useOp, useView } from "@/lib/store";
import { repeatsList } from "../../../shared/views";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/shell/misc";
import { SwipeToDelete, useSwipedRow } from "@/components/shell/SwipeToDelete";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountPicker, CategoryPicker } from "@/components/tx/pickers";
import { FREQ_LABEL } from "@/components/tx/RepeatSheet";
import { toMinor } from "../../../shared/money";
import { amountInput, LOCALE_DECIMAL } from "@/lib/format";
import { cn } from "@/lib/utils";

type Edit = {
  r: Doc<"repeats">;
  frequency: Doc<"repeats">["frequency"];
  endDate: string;
  nextDate: string;
  amount: string;
  note: string;
  active: boolean;
  accountId: Id<"accounts">;
  toAccountId?: Id<"accounts">;
  categoryId?: Id<"categories">;
  subcategoryId?: Id<"categories">;
};

const TYPE_LABEL = { income: "Income", expense: "Expense", transfer: "Transfer" } as const;

export default function RepeatSettings() {
  const { settings, accountName, categoryLabel } = useApp();
  const view = useView();
  const list = useMemo(() => repeatsList(view), [view]);
  const update = useOp("repeats.update");
  const remove = useOp("repeats.remove");
  const confirm = useConfirm();
  const [edit, setEdit] = useState<Edit | null>(null);
  // Which picker sheet is open over the edit dialog.
  const [sheet, setSheet] = useState<null | "account" | "to" | "category">(null);
  const swipe = useSwipedRow();
  // From a swiped row or the editor's button: asks first. Resolves true once the schedule is gone.
  const del = (id: Doc<"repeats">["_id"]) =>
    confirm({ title: "Delete this schedule?", description: "Entries it already created stay in the ledger. No new ones will be added." })
      .then(async (ok) => { if (ok) await remove({ id }); return ok; }).finally(swipe.close);
  const openEdit = (r: Doc<"repeats">) => {
    const t = r.template;
    setEdit({ r, frequency: r.frequency, endDate: r.endDate ?? "", nextDate: r.nextDate, amount: amountInput(t.amount, settings.decimals), note: t.note, active: r.active, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId, subcategoryId: t.subcategoryId });
  };
  const save = async (e: Edit) => {
    const t = e.r.template;
    const template = {
      ...t,
      amount: toMinor(e.amount, settings.decimals, LOCALE_DECIMAL),
      note: e.note,
      accountId: e.accountId,
      // The type never changes here, so a transfer keeps its destination and the others keep their category.
      toAccountId: t.type === "transfer" ? e.toAccountId : undefined,
      categoryId: t.type === "transfer" ? undefined : e.categoryId,
      subcategoryId: t.type === "transfer" ? undefined : e.subcategoryId,
    };
    try {
      await update({ id: e.r._id, frequency: e.frequency, endDate: e.endDate || null, nextDate: e.nextDate, active: e.active, template });
      setEdit(null);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };
  // "Edit schedule" from an upcoming row opens that schedule straight away
  const [sp, setSp] = useSearchParams();
  const wanted = sp.get("id");
  useEffect(() => {
    if (!wanted) return;
    const r = list.find((x) => x._id === wanted);
    if (r) openEdit(r);
    setSp((p) => { const n = new URLSearchParams(p); n.delete("id"); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  const editType = edit?.r.template.type;
  return (
    <>
      <PageHeader back="/settings" title="Repeat settings" />
      <Page className="pb-8">
        {list && !list.length ? <EmptyState title="No schedules" hint="Set a repeat or installment from the Repeat button on an entry's date." /> : null}
        <div className="bg-card border-y">
          {list?.map((r) => {
            const t = r.template;
            const kind = t.type === "income" ? "income" : t.type === "expense" ? "expense" : "transfer";
            const accounts = t.type === "transfer" ? `${accountName(t.accountId)} → ${accountName(t.toAccountId)}` : accountName(t.accountId);
            const when = r.kind === "installment" ? `${r.installmentCount} installments from ${r.startDate}` : `${FREQ_LABEL[r.frequency]} · next ${r.nextDate}${r.endDate ? ` · until ${r.endDate}` : ""}`;
            return (
              <SwipeToDelete key={r._id} className="border-b last:border-b-0" {...swipe.row(r._id)} onDelete={() => void del(r._id)}>
                <button type="button" onClick={() => openEdit(r)} className={cn("w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-accent/40", !r.active && "opacity-60")}>
                  <div className="w-20 shrink-0 text-xs text-muted-foreground line-clamp-2">{t.type === "transfer" ? "Transfer" : categoryLabel(t)}</div>
                  <div className="flex-1 min-w-0">
                    <div className={cn("truncate", !t.note && "text-muted-foreground")}>{t.note || "No note"}</div>
                    <div className="text-xs text-muted-foreground truncate">{accounts} · {when}{!r.active ? " · stopped" : ""}</div>
                  </div>
                  <Money amount={t.amount} kind={kind} />
                </button>
              </SwipeToDelete>
            );
          })}
        </div>
        <p className="px-4 py-3 text-xs text-muted-foreground">Changing or deleting a schedule never touches the entries it already created.</p>
      </Page>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit?.r.kind === "installment" ? "Installment plan" : "Repeat schedule"}</DialogTitle>
            {editType ? <DialogDescription>{TYPE_LABEL[editType]} entry</DialogDescription> : null}
          </DialogHeader>
          {edit && edit.r.kind === "repeat" ? (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Frequency</Label><Select value={edit.frequency} onValueChange={(v) => setEdit({ ...edit, frequency: v as typeof edit.frequency })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(FREQ_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Next date</Label><Input type="date" value={edit.nextDate} onChange={(e) => setEdit({ ...edit, nextDate: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>End date</Label><Input type="date" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} /></div>
              </div>
              {editType === "transfer" ? (
                <div className="grid grid-cols-2 gap-3">
                  <PickerField label="From" value={accountName(edit.accountId)} onClick={() => setSheet("account")} />
                  <PickerField label="To" value={edit.toAccountId ? accountName(edit.toAccountId) : "Select"} onClick={() => setSheet("to")} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <PickerField label="Account" value={accountName(edit.accountId)} onClick={() => setSheet("account")} />
                  <PickerField label="Category" value={edit.categoryId ? categoryLabel({ categoryId: edit.categoryId, subcategoryId: edit.subcategoryId }) : "Select"} onClick={() => setSheet("category")} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Amount</Label><Input inputMode="decimal" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Note</Label><Input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></div>
              </div>
              <label className="flex items-center justify-between text-sm"><span>Active</span><Switch checked={edit.active} onCheckedChange={(v) => setEdit({ ...edit, active: v })} /></label>
            </div>
          ) : edit ? <p className="text-sm text-muted-foreground">All {edit.r.installmentCount} entries were created when the plan was set. Edit or delete them from the ledger (use "This and future" to change the rest).</p> : null}
          <DialogFooter>
            <Button variant="destructive" onClick={async () => { if (await del(edit!.r._id)) setEdit(null); }}>Delete schedule</Button>
            {edit?.r.kind === "repeat" ? <Button onClick={() => void save(edit)}>Save</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* The same sheets the entry editor uses, opened over the dialog. */}
      <AccountPicker open={sheet === "account"} onOpenChange={(o) => !o && setSheet(null)} onPick={(a) => setEdit((p) => p && { ...p, accountId: a })} title={editType === "transfer" ? "From" : "Payment method"} exclude={editType === "transfer" ? edit?.toAccountId : undefined} />
      <AccountPicker open={sheet === "to"} onOpenChange={(o) => !o && setSheet(null)} onPick={(a) => setEdit((p) => p && { ...p, toAccountId: a })} title="To" exclude={edit?.accountId} />
      {editType === "income" || editType === "expense" ? (
        <CategoryPicker open={sheet === "category"} onOpenChange={(o) => !o && setSheet(null)} type={editType} onPick={(c, s) => setEdit((p) => p && { ...p, categoryId: c, subcategoryId: s })} />
      ) : null}
    </>
  );
}

/** A labelled button that reads like the Select above it and opens a picker sheet. */
function PickerField({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Button type="button" variant="outline" onClick={onClick} className={cn("w-full justify-between font-normal", value === "Select" && "text-muted-foreground")}>
        <span className="truncate">{value}</span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </Button>
    </div>
  );
}
