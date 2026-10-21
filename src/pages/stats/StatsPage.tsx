import { useMemo } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useView } from "@/lib/store";
import { statsByCategory, statsTrend } from "../../../shared/views";
import { monthRecap, recapIndex, type RecapIndexYearRow } from "../../../shared/recap";
import { monthKeyForDate, monthRange, parseMonthKey } from "../../../shared/period";
import { addDays, todayISO } from "../../../shared/dates";
import { longMonth } from "@/pages/recap/cards";
import { YearRecapRow } from "@/pages/recap/RecapsPage";
import { Row } from "@/components/shell/misc";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { StatsHeaderBar } from "./PeriodBar";
import { useStatPeriod } from "./period";
import { CategoryPie, TrendBars, colorAt } from "./charts";
import { Money } from "@/components/shell/Money";
import { cn } from "@/lib/utils";
import { dateLabel, monthLabel } from "@/lib/format";

/** What was kept of the income: "Saved X (Y%)", or what spending went over it. */
function SavedLine({ income, expense }: { income: number; expense: number }) {
  const net = income - expense;
  return (
    <div className="flex items-center justify-center gap-1 border-b py-1.5 text-xs text-muted-foreground">
      <span>{net >= 0 ? "Saved" : "Overspent"}</span>
      <Money amount={Math.abs(net)} kind={net >= 0 ? "income" : "expense"} />
      {income > 0 ? <span>({Math.round((net / income) * 100)}% of income)</span> : null}
    </div>
  );
}

export default function StatsPage() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const p = useStatPeriod();
  // in the URL, so coming back from a category keeps Income / Trend as they were
  const [sp, setSp] = useSearchParams();
  const type = sp.get("type") === "income" ? "income" : "expense";
  const mode = sp.get("mode") === "trend" ? "trend" : "list";
  const setParam = (k: string, v: string, fallback: string) => setSp((prev) => { const n = new URLSearchParams(prev); if (v === fallback) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const setType = (t: "income" | "expense") => setParam("type", t, "expense");
  const setMode = (m: "list" | "trend") => setParam("mode", m, "list");
  // the detail keeps this period (its week, year or custom range), with the Income / Expenses tab
  const categoryQuery = (() => { const n = new URLSearchParams(sp); n.set("type", type); n.set("period", p.period); n.set("from", p.range.from); n.set("to", p.range.to); return n.toString(); })();
  const view = useView();
  const expense = useMemo(() => statsByCategory(view, p.range.from, p.range.to, "expense"), [view, p.range.from, p.range.to]);
  const income = useMemo(() => statsByCategory(view, p.range.from, p.range.to, "income"), [view, p.range.from, p.range.to]);
  const data = type === "expense" ? expense : income;
  const ranges = p.trailing();
  const rangeKey = ranges.map((r) => r.key).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trend = useMemo(() => (mode === "trend" ? statsTrend(view, type, undefined, ranges) : undefined), [view, type, mode, rangeKey]);
  // every finished logical month with enough entries keeps its recap here
  const { settings } = useApp();
  const thisMonth = monthKeyForDate(todayISO(), settings.monthStartDay);
  const finished = p.period === "monthly" && p.month < thisMonth;
  const recap = useMemo(() => (finished ? monthRecap(view, p.month) : null), [view, finished, p.month]);
  // the current month's row says when its recap comes and opens the list of earlier ones
  const readyOn = p.period === "monthly" && p.month === thisMonth ? dateLabel(addDays(monthRange(p.month, settings.monthStartDay).to, 1)) : null;
  // in Annually mode a finished year gets the same row the Recaps page gives it
  const yearKey = p.period === "yearly" ? Number(p.key) : null;
  const finishedYear = yearKey !== null && yearKey < parseMonthKey(thisMonth).y;
  const yearRow = useMemo(() => (finishedYear ? (recapIndex(view, todayISO()).find((r) => r.kind === "year" && r.year === yearKey) as RecapIndexYearRow | undefined) ?? null : null), [view, finishedYear, yearKey]);
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
        {income.total || expense.total ? <SavedLine income={income.total} expense={expense.total} /> : null}
        {recap ? (
          <div className="border-b bg-card">
            <Row icon={<Sparkles />} label={`${longMonth(p.month)} recap`} hint={`${recap.cards.length} cards · what you spent, where, what changed`} right={<ChevronRight className="size-4 text-muted-foreground" />} onClick={() => nav(`/recap/${p.month}`)} />
          </div>
        ) : readyOn ? (
          <div className="border-b bg-card">
            <Row icon={<Sparkles />} label={<span className="text-muted-foreground">{longMonth(p.month)} recap</span>} hint={`Ready on ${readyOn} · earlier months`} right={<ChevronRight className="size-4 text-muted-foreground" />} onClick={() => nav("/recaps")} />
          </div>
        ) : yearRow ? (
          <div className="border-b bg-card"><YearRecapRow row={yearRow} onOpen={() => nav(`/recap/${yearRow.year}`)} /></div>
        ) : null}
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
                <button key={it.id} type="button" aria-current={pathname === `/stats/c/${encodeURIComponent(it.id)}` || undefined} onClick={() => nav(`/stats/c/${encodeURIComponent(it.id)}?${categoryQuery}`)} className="w-full flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm hover:bg-accent/40 text-left aria-[current]:bg-accent">
                  <span className="flex items-center gap-1.5 w-14 shrink-0 text-[11px] tabular text-muted-foreground"><span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colorAt(i, data.items.length) }} /><span>{Math.round(it.pct * 100)}%</span></span>
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
              {ranges.slice().reverse().map((r, i) => <div key={r.key} className="flex justify-between px-4 py-2 border-b last:border-b-0 text-sm"><span>{/^\d{4}-\d{2}$/.test(r.key) ? monthLabel(r.key) : r.label}</span><Money amount={trend?.[ranges.length - 1 - i]?.amount ?? 0} kind={type} /></div>)}
            </div>
          </div>
        )}
      </Page>
    </>
  );
}
