import { useState } from "react";
import { useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useOp, useView } from "@/lib/store";
import { budgetsList } from "../../../shared/views";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { SegmentedTabs, EmptyState, Row } from "@/components/shell/misc";
import { SwipeToDelete, useSwipedRow } from "@/components/shell/SwipeToDelete";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toMinor } from "../../../shared/money";
import { amountInput, monthLabel, LOCALE_DECIMAL } from "@/lib/format";
import { monthKeyForDate, weekRange } from "../../../shared/period";
import { parts, todayISO } from "../../../shared/dates";

type Period = "weekly" | "monthly" | "yearly";

export default function BudgetSettings() {
  const [sp] = useSearchParams();
  const { settings, categories, categoryById } = useApp();
  const [period, setPeriod] = useState<Period>((sp.get("period") as Period) || "monthly");
  const budgets = budgetsList(useView());
  const upsert = useOp("budgets.upsert");
  const setOverride = useOp("budgets.setOverride");
  const setRollover = useOp("budgets.setRollover");
  const remove = useOp("budgets.remove");
  const confirm = useConfirm();
  const list = budgets.filter((b) => b.period === period).sort((a, b) => (a.categoryId ? 1 : 0) - (b.categoryId ? 1 : 0));
  const [dialog, setDialog] = useState<null | { id?: Id<"budgets">; categoryId: string; amount: string; override: string; rollover: boolean }>(null);
  const swipe = useSwipedRow();
  // From a swiped row or the editor's button: asks first. Resolves true once the budget is gone.
  const del = (id: Id<"budgets">) =>
    confirm({ title: "Delete this budget?", description: "Spending in this category will no longer be tracked against a limit." })
      .then((ok) => { if (ok) void remove({ id }); return ok; }).finally(swipe.close);
  const today = todayISO();
  // the period the user came from (overrides apply to it), else the current one
  const fromPage = sp.get("period") === period ? sp.get("key") ?? sp.get("month") : null;
  const key = fromPage ?? (period === "monthly" ? monthKeyForDate(today, settings.monthStartDay) : period === "weekly" ? weekRange(today, settings.weekStartDay).from : String(parts(today).y));
  const keyLabel = period === "monthly" ? monthLabel(key) : period === "weekly" ? `week of ${key}` : key;
  const currentKey = period === "monthly" ? monthKeyForDate(today, settings.monthStartDay) : period === "weekly" ? weekRange(today, settings.weekStartDay).from : String(parts(today).y);
  const nextWord = period === "weekly" ? "week" : period === "yearly" ? "year" : "month";
  const mains = categories.filter((c) => c.type === "expense" && !c.parentId && !c.deletedAt && !c.archivedAt);
  const available = mains.filter((c) => !list.some((b) => b.categoryId === c._id));
  const hasTotal = list.some((b) => !b.categoryId);

  async function save() {
    if (!dialog) return;
    try {
      const amount = toMinor(dialog.amount, settings.decimals, LOCALE_DECIMAL);
      const id = await upsert({ id: dialog.id, categoryId: dialog.categoryId === "total" ? undefined : (dialog.categoryId as Id<"categories">), period, amount });
      if (dialog.id || dialog.override) {
        await setOverride({ id, key, amount: dialog.override.trim() ? toMinor(dialog.override, settings.decimals, LOCALE_DECIMAL) : null });
      }
      // carrying over starts with the current period, so nothing already past changes
      const was = !!budgets.find((b) => b._id === id)?.rolloverFrom;
      if (dialog.rollover !== was) await setRollover({ id, from: dialog.rollover ? currentKey : null });
      setDialog(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  }

  return (
    <>
      <PageHeader back title="Budget settings" right={<Button variant="ghost" size="icon" aria-label="Add budget" onClick={() => setDialog({ categoryId: hasTotal ? (available[0]?._id ?? "") : "total", amount: "", override: "", rollover: false })}><Plus className="size-5" /></Button>} />
      <Page>
        <SegmentedTabs value={period} onChange={setPeriod} items={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "yearly", label: "Annual" }]} />
        {!list.length ? <EmptyState title="No budgets for this period" hint="Tap + to add a total budget or a category budget." /> : null}
        <div className="bg-card border-y">
          {list.map((b) => {
            const ov = b.overrides[key];
            return (
              <SwipeToDelete key={b._id} className="border-b last:border-b-0" {...swipe.row(b._id)} onDelete={() => void del(b._id)}>
                <Row label={b.categoryId ? categoryById.get(b.categoryId)?.name ?? "(deleted)" : "Total budget"} hint={<>{ov !== undefined ? <>{keyLabel}: <Money amount={ov} /></> : "default"}{b.rolloverFrom ? " · carries over" : ""}</>} value={<Money amount={b.amount} />}
                  onClick={() => setDialog({ id: b._id, categoryId: b.categoryId ?? "total", amount: amountInput(b.amount, settings.decimals), override: ov !== undefined ? amountInput(ov, settings.decimals) : "", rollover: !!b.rolloverFrom })} />
              </SwipeToDelete>
            );
          })}
        </div>
        <p className="px-4 py-3 text-xs text-muted-foreground">The default amount applies to every period. Set an amount for just {keyLabel} inside a budget to override it for that period only.</p>
      </Page>
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog?.id ? "Edit budget" : "New budget"}</DialogTitle></DialogHeader>
          {dialog ? (
            <div className="space-y-3">
              {!dialog.id ? (
                <div className="space-y-1.5"><Label>Category</Label>
                  <Select value={dialog.categoryId} onValueChange={(v) => setDialog({ ...dialog, categoryId: v })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Pick" /></SelectTrigger>
                    <SelectContent>{!hasTotal ? <SelectItem value="total">Total budget</SelectItem> : null}{available.map((c) => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="space-y-1.5"><Label>Default amount</Label><Input inputMode="decimal" value={dialog.amount} onChange={(e) => setDialog({ ...dialog, amount: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Only for {keyLabel} (optional)</Label><Input inputMode="decimal" value={dialog.override} placeholder="Leave blank to use the default" onChange={(e) => setDialog({ ...dialog, override: e.target.value })} /></div>
              <label className="flex items-start justify-between gap-3 pt-1">
                <span className="space-y-0.5">
                  <span className="block text-sm">Carry over</span>
                  <span className="block text-xs text-muted-foreground">What's left at the end of each {nextWord} adds to the next one; overspending takes from it. Starts with this {nextWord}.</span>
                </span>
                <Switch checked={dialog.rollover} onCheckedChange={(v) => setDialog({ ...dialog, rollover: v })} aria-label="Carry over" />
              </label>
            </div>
          ) : null}
          <DialogFooter>
            {dialog?.id ? <Button variant="destructive" onClick={async () => { if (await del(dialog.id!)) setDialog(null); }}>Delete</Button> : null}
            <Button onClick={save} disabled={!dialog?.categoryId || !dialog.amount}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
