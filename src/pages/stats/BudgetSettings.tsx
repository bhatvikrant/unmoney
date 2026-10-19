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
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const remove = useOp("budgets.remove");
  const list = budgets.filter((b) => b.period === period).sort((a, b) => (a.categoryId ? 1 : 0) - (b.categoryId ? 1 : 0));
  const [dialog, setDialog] = useState<null | { id?: Id<"budgets">; categoryId: string; amount: string; override: string }>(null);
  const today = todayISO();
  const key = period === "monthly" ? (sp.get("month") ?? monthKeyForDate(today, settings.monthStartDay)) : period === "weekly" ? weekRange(today, settings.weekStartDay).from : String(parts(today).y);
  const keyLabel = period === "monthly" ? monthLabel(key) : period === "weekly" ? `week of ${key}` : key;
  const mains = categories.filter((c) => c.type === "expense" && !c.parentId && !c.deletedAt);
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
      setDialog(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  }

  return (
    <>
      <PageHeader back title="Budget settings" right={<Button variant="ghost" size="icon" aria-label="Add budget" onClick={() => setDialog({ categoryId: hasTotal ? (available[0]?._id ?? "") : "total", amount: "", override: "" })}><Plus className="size-5" /></Button>} />
      <Page>
        <SegmentedTabs value={period} onChange={setPeriod} items={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "yearly", label: "Annual" }]} />
        {!list.length ? <EmptyState title="No budgets for this period" hint="Tap + to add a total budget or a category budget." /> : null}
        <div className="bg-card border-y">
          {list.map((b) => {
            const ov = b.overrides[key];
            return (
              <Row key={b._id} label={b.categoryId ? categoryById.get(b.categoryId)?.name ?? "(deleted)" : "Total budget"} hint={ov !== undefined ? <>{keyLabel}: <Money amount={ov} /></> : `default`} value={<Money amount={b.amount} />}
                onClick={() => setDialog({ id: b._id, categoryId: b.categoryId ?? "total", amount: amountInput(b.amount, settings.decimals), override: ov !== undefined ? amountInput(ov, settings.decimals) : "" })} />
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
            </div>
          ) : null}
          <DialogFooter>
            {dialog?.id ? <Button variant="destructive" onClick={() => { remove({ id: dialog.id! }); setDialog(null); }}>Delete</Button> : null}
            <Button onClick={save} disabled={!dialog?.categoryId || !dialog.amount}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
