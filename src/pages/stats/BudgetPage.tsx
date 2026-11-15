import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useView } from "@/lib/store";
import { budgetEntries, budgetStatus, statsTrend } from "../../../shared/views";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { StatsHeaderBar } from "./PeriodBar";
import { useStatPeriod } from "./period";
import { BudgetBar, type BudgetItem } from "@/components/BudgetBars";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendBars } from "./charts";
import { EmptyState } from "@/components/shell/misc";
import { useToday } from "@/lib/today";
import { diffDays } from "../../../shared/dates";
import { billsAgainstBudgets } from "../../../shared/upcoming";
import { TransactionList } from "@/components/tx/TransactionList";
import { dateLabel, monthLabel } from "@/lib/format";

export default function BudgetPage() {
  const nav = useNavigate();
  const { categoryById } = useApp();
  const p = useStatPeriod();
  // a custom range has no budget of its own: show the month it starts in
  const period = p.period === "custom" ? "monthly" : p.period;
  const key = p.period === "custom" ? p.month : p.key;
  const view = useView();
  const status = useMemo(() => budgetStatus(view, period, key), [view, period, key]);
  const label = period === "weekly" ? "Weekly" : period === "yearly" ? "Annual" : "Monthly";
  // the open budget and the bar picked in it live in the URL, so opening an entry and coming back returns to them
  const [sp, setSp] = useSearchParams();
  const openId = sp.get("budget");
  const detail = useMemo(() => {
    if (!status || !openId) return null;
    if (status.total?.budget._id === openId) return { item: status.total, label };
    const it = status.perCategory.find((i) => i.budget._id === openId);
    return it ? { item: it as BudgetItem, label: categoryById.get(it.budget.categoryId!)?.name ?? "" } : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, openId, categoryById]);
  const patch = (next: Record<string, string | null>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(next)) { if (v === null) n.delete(k); else n.set(k, v); } setSp(n, { replace: true }); };
  const setDetail = (d: { item: BudgetItem; label: string } | null) => patch({ budget: d ? d.item.budget._id : null, bar: null });
  const ranges = p.trailing();
  const rangeKey = ranges.map((r) => r.key).join(",");
  // the bar being looked at: the one tapped, else this period's
  const barAt = (k: string | null) => (k ? ranges.findIndex((r) => r.key === k) : -1);
  const picked = barAt(sp.get("bar")) >= 0 ? barAt(sp.get("bar")) : barAt(key) >= 0 ? barAt(key) : ranges.length - 1;
  const bar = ranges[picked];
  const barLabel = !bar ? "" : period === "weekly" ? `${dateLabel(bar.from)} – ${dateLabel(bar.to)}` : period === "yearly" ? bar.key : monthLabel(bar.key);
  const barFrom = bar?.from, barTo = bar?.to;
  const entries = useMemo(() => (detail && barFrom && barTo ? budgetEntries(view, detail.item.budget.categoryId, barFrom, barTo) : []), [view, detail, barFrom, barTo]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trend = useMemo(() => (detail ? statsTrend(view, "expense", detail.item.budget.categoryId, ranges) : undefined), [view, detail, rangeKey]);
  // each bar against its own period's limit (its override and carry), not this period's
  const limits = useMemo(() => {
    if (!detail) return undefined;
    const id = detail.item.budget._id;
    return ranges.map((r) => { const st = budgetStatus(view, period, r.key); return (st?.total?.budget._id === id ? st.total : st?.perCategory.find((it) => it.budget._id === id))?.limit ?? detail.item.limit; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, detail, period, rangeKey]);
  // In the current period: what can still go out each day, and where spending at this rate ends up.
  const today = useToday();
  // in the period running today: the bills scheduled before it ends, per budget
  const due = useMemo(() => {
    const m = new Map<string, number>();
    if (!status || today < status.range.from || today > status.range.to) return m;
    for (const o of billsAgainstBudgets(view, today)) if (o.item.range.from === status.range.from && o.item.period === period) m.set(o.item.budget._id, o.adds);
    return m;
  }, [view, status, today, period]);
  const pace = status && status.spentAll && today >= status.range.from && today <= status.range.to && status.elapsed > 0 ? {
    perDay: status.total && status.total.remaining > 0 ? Math.floor(status.total.remaining / (diffDays(today, status.range.to) + 1)) : null,
    end: Math.round(status.spentAll / status.elapsed),
    over: !!status.total && status.spentAll / status.elapsed > status.total.limit,
  } : null;
  return (
    <>
      <PageHeader title={null} className="border-b-0" sub={<StatsHeaderBar />} />
      <Page className="pb-8">
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <div>
            <div className="text-xs text-muted-foreground">{status && !status.total ? `Spent (${label}, no total budget)` : `Remaining (${label})`}</div>
            <div className="text-2xl font-semibold tabular">{status?.total ? <Money amount={status.total.remaining} kind={status.total.remaining < 0 ? "expense" : "plain"} /> : status ? <Money amount={status.spentAll} kind="expense" /> : "—"}</div>
            {pace ? (
              <div className="text-xs text-muted-foreground">
                {pace.perDay !== null ? <><Money amount={pace.perDay} muted /> left per day · </> : null}
                On pace for <Money amount={pace.end} kind={pace.over ? "expense" : "plain"} muted={!pace.over} />
              </div>
            ) : null}
          </div>
          <Button variant="secondary" size="sm" onClick={() => nav(`/budget/settings?period=${period}&key=${key}`)}>Budget setting ›</Button>
        </div>
        {status?.total ? <div className="bg-card border-y"><BudgetBar item={status.total} label={label} elapsed={status.elapsed} due={due.get(status.total.budget._id)} onClick={() => setDetail({ item: status.total!, label })} /></div> : null}
        {status?.perCategory.length ? (
          <div className="bg-card border-y mt-2">
            {status.perCategory.map((it) => { const name = categoryById.get(it.budget.categoryId!)?.name ?? ""; return <BudgetBar key={it.budget._id} item={it} label={name} elapsed={status.elapsed} due={due.get(it.budget._id)} onClick={() => setDetail({ item: it, label: name })} />; })}
          </div>
        ) : null}
        {status && !status.total && !status.perCategory.length ? <EmptyState title={`No ${label.toLowerCase()} budgets`} hint="Set a total budget or one per category. The bar fills as you spend; the marker shows where today falls." action={<Button onClick={() => nav(`/budget/settings?period=${period}`)}>Set a budget</Button>} /> : null}
      </Page>
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        {/* not focusing the chart on open: that would pin a tooltip over its first bar */}
        <DialogContent className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_auto_minmax(0,1fr)] overflow-hidden" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>{detail?.label}</DialogTitle></DialogHeader>
          {trend && detail ? <TrendBars data={ranges.map((r, i) => ({ label: r.label, amount: trend[i]?.amount ?? 0 }))} limit={detail.item.limit} limits={limits}
            selected={picked} onPick={(i) => patch({ bar: ranges[i]?.key ?? null })} /> : <div className="h-48" />}
          {detail ? <div className="text-xs text-muted-foreground">Budget <Money amount={limits?.[picked] ?? detail.item.limit} /> · tap a bar to see its entries.</div> : null}
          {detail && bar ? (
            <div className="-mx-4 -mb-4 flex min-h-0 flex-col border-t">
              <div className="flex items-baseline justify-between px-4 py-2 text-xs text-muted-foreground">
                <span>{barLabel} · {entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
                <Money amount={trend?.[picked]?.amount ?? 0} kind="expense" className="text-sm font-medium" />
              </div>
              <div className="min-h-0 overflow-y-auto overscroll-contain"><TransactionList txs={entries} emptyText="Nothing spent in this period" /></div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
