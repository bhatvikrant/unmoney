import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { StatsHeaderBar } from "./PeriodBar";
import { useStatPeriod } from "./period";
import { CategoryPie, TrendBars, colorAt } from "./charts";
import { Money } from "@/components/shell/Money";
import { cn } from "@/lib/utils";

export default function StatsPage() {
  const nav = useNavigate();
  const p = useStatPeriod();
  const [type, setType] = useState<"income" | "expense">("expense");
  const [mode, setMode] = useState<"list" | "trend">("list");
  const expense = useQuery(api.stats.byCategory, { ...p.range, type: "expense" });
  const income = useQuery(api.stats.byCategory, { ...p.range, type: "income" });
  const data = type === "expense" ? expense : income;
  const ranges = p.trailing();
  const trend = useQuery(api.stats.trend, mode === "trend" ? { type, ranges: ranges.map(({ key, from, to }) => ({ key, from, to })) } : "skip");
  return (
    <>
      <PageHeader title={null} className="border-b-0" sub={<StatsHeaderBar />} />
      <Page className="pb-8">
        <div className="grid grid-cols-2 border-y text-sm">
          {(["income", "expense"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} className={cn("py-2.5 border-b-2 flex items-center justify-center gap-2", type === t ? "border-primary font-medium" : "border-transparent text-muted-foreground")}>
              <span>{t === "income" ? "Income" : "Expenses"}</span>
              <Money amount={(t === "income" ? income : expense)?.total ?? 0} kind={t} />
            </button>
          ))}
        </div>
        <div className="flex justify-end px-3 pt-2">
          <div className="flex rounded-md bg-muted p-0.5 text-xs">
            {(["list", "trend"] as const).map((m) => <button key={m} type="button" onClick={() => setMode(m)} className={cn("px-3 py-1 rounded-[5px] capitalize", mode === m ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>{m}</button>)}
          </div>
        </div>
        {mode === "list" ? (
          <>
            <div className="px-2 py-2">{data ? <CategoryPie items={data.items} /> : <div className="h-56" />}</div>
            <div className="bg-card border-y">
              {data?.items.map((it, i) => (
                <button key={it.id} type="button" onClick={() => nav(`/stats/c/${encodeURIComponent(it.id)}?type=${type}&from=${p.range.from}&to=${p.range.to}&period=${p.period}&month=${p.month}`)} className="w-full flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm hover:bg-accent/40 text-left">
                  <span className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white tabular w-12 text-center" style={{ background: colorAt(i) }}>{Math.round(it.pct * 100)}%</span>
                  <span className="flex-1 truncate">{it.name}</span>
                  <Money amount={it.amount} kind={type} />
                </button>
              ))}
              {data && !data.items.length ? <div className="px-4 py-6 text-center text-sm text-muted-foreground">No {type === "income" ? "income" : "expenses"} in this period</div> : null}
            </div>
          </>
        ) : (
          <div className="px-2 py-3">
            {trend ? <TrendBars data={ranges.map((r, i) => ({ label: r.label, amount: trend[i]?.amount ?? 0 }))} color={type === "income" ? "var(--income)" : "var(--expense)"} /> : <div className="h-48" />}
            <div className="bg-card border-y mt-3">
              {ranges.slice().reverse().map((r, i) => <div key={r.key} className="flex justify-between px-4 py-2 border-b last:border-b-0 text-sm"><span>{r.key}</span><Money amount={trend?.[ranges.length - 1 - i]?.amount ?? 0} kind={type} /></div>)}
            </div>
          </div>
        )}
      </Page>
    </>
  );
}
