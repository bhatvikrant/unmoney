import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
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

export default function BudgetPage() {
  const nav = useNavigate();
  const { categoryById } = useApp();
  const p = useStatPeriod();
  const period = p.period === "custom" ? "monthly" : p.period;
  const status = useQuery(api.budgets.status, { period, key: p.key });
  const [detail, setDetail] = useState<{ item: BudgetItem; label: string } | null>(null);
  const ranges = p.trailing();
  const trend = useQuery(api.stats.trend, detail ? { type: "expense", categoryId: detail.item.budget.categoryId, ranges: ranges.map(({ key, from, to }) => ({ key, from, to })) } : "skip");
  const label = period === "weekly" ? "Weekly" : period === "yearly" ? "Annual" : "Monthly";
  return (
    <>
      <PageHeader title={null} className="border-b-0" sub={<StatsHeaderBar />} />
      <Page className="pb-8">
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <div>
            <div className="text-xs text-muted-foreground">Remaining ({label})</div>
            <div className="text-2xl font-semibold tabular">{status?.total ? <Money amount={status.total.remaining} kind={status.total.remaining < 0 ? "expense" : "plain"} /> : status ? <Money amount={-status.spentAll} kind="expense" /> : "—"}</div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => nav(`/budget/settings?period=${period}&month=${p.month}`)}>Budget setting ›</Button>
        </div>
        {status?.total ? <div className="bg-card border-y"><BudgetBar item={status.total} label={label} elapsed={status.elapsed} onClick={() => setDetail({ item: status.total!, label })} /></div> : null}
        {status?.perCategory.length ? (
          <div className="bg-card border-y mt-2">
            {status.perCategory.map((it) => { const name = categoryById.get(it.budget.categoryId!)?.name ?? ""; return <BudgetBar key={it.budget._id} item={it} label={name} elapsed={status.elapsed} onClick={() => setDetail({ item: it, label: name })} />; })}
          </div>
        ) : null}
        {status && !status.total && !status.perCategory.length ? <EmptyState title={`No ${label.toLowerCase()} budgets`} hint="Set a total budget or one per category. The bar fills as you spend; the marker shows where today falls." action={<Button onClick={() => nav(`/budget/settings?period=${period}`)}>Set a budget</Button>} /> : null}
      </Page>
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{detail?.label}</DialogTitle></DialogHeader>
          {trend && detail ? <TrendBars data={ranges.map((r, i) => ({ label: r.label, amount: trend[i]?.amount ?? 0 }))} limit={detail.item.limit} /> : <div className="h-48" />}
          {detail ? <div className="text-xs text-muted-foreground">Budget <Money amount={detail.item.limit} /> · bars turn red above it.</div> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
