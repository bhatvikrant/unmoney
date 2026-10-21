import { useMemo } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ChevronRight } from "lucide-react";
import { useView } from "@/lib/store";
import { statsByCategory, statsEntries, statsTrend } from "../../../shared/views";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { TrendBars } from "./charts";
import { useStatPeriod } from "./period";
import { StatsHeaderBar } from "./PeriodBar";
import { useColumn } from "@/components/shell/SplitLayout";
import { TransactionList } from "@/components/tx/TransactionList";
import { Money } from "@/components/shell/Money";

export default function CategoryDetail() {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
  const { search } = useLocation();
  const nav = useNavigate();
  // beside the Stats list (wide screens) its period bar is right there; on its own screen it gets one
  const alone = useColumn() !== "detail";
  const type = (sp.get("type") as "income" | "expense") || "expense";
  const { categoryById, accountName } = useApp();
  const p = useStatPeriod();
  const ranges = p.trailing();
  const rangeKey = ranges.map((r) => r.key).join(",");
  const view = useView();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trend = useMemo(() => statsTrend(view, type, id, ranges), [view, type, id, rangeKey]);
  const breakdown = useMemo(() => statsByCategory(view, p.range.from, p.range.to, type), [view, p.range.from, p.range.to, type]);
  const isTransfer = id.startsWith("transfer:");
  // a subcategory opened from its main category's breakdown: its entries are in the main one's bucket
  const parentId = categoryById.get(id)?.parentId;
  const bucket = parentId ?? id;
  const list = useMemo(() => statsEntries(view, p.range.from, p.range.to, type).filter((e) => e.bucket === bucket && (!parentId || e.t.subcategoryId === id)).map((e) => e.t).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b._creationTime - a._creationTime)), [view, id, bucket, parentId, p.range.from, p.range.to, type]);
  const main = breakdown?.items.find((i) => i.id === bucket);
  const item = parentId ? main?.children.find((c) => c.id === id) : main;
  const name = isTransfer ? `Transfer to ${accountName(id.slice(9))}` : parentId ? `${categoryById.get(parentId)?.name ?? ""} › ${categoryById.get(id)?.name ?? ""}` : categoryById.get(id)?.name ?? item?.name ?? "Category";
  // a bar opens its period; from a custom range, that month
  const pick = (i: number) => { const k = ranges[i]?.key; if (!k) return; if (p.period === "custom") p.set({ period: "monthly", month: k }); else p.go(k); };
  return (
    <>
      <PageHeader back title={name} sub={alone ? <StatsHeaderBar tabs={false} /> : undefined} />
      <Page className="pb-8">
        <div className="flex items-baseline justify-between px-4 pt-3"><span className="text-sm text-muted-foreground">{p.label}</span><Money amount={item?.amount ?? 0} kind={type} className="text-lg font-semibold" /></div>
        <div className="px-2 py-2">{trend ? <TrendBars data={ranges.map((r, i) => ({ label: r.label, amount: trend[i]?.amount ?? 0 }))} color={type === "income" ? "var(--income)" : "var(--expense)"} onPick={pick} /> : <div className="h-48" />}</div>
        {!parentId && main && main.children.length > 1 ? (
          <div className="bg-card border-y mb-3">
            {main.children.map((c) => {
              const body = <><span className="flex-1 truncate">{c.name}</span><span className="flex items-center gap-3"><span className="text-muted-foreground text-xs">{main.amount ? Math.round((c.amount / main.amount) * 100) : 0}%</span><Money amount={c.amount} kind={type} /></span></>;
              // "(no subcategory)" has no screen of its own
              return c.id === "none"
                ? <div key={c.id} className="flex items-center gap-2 px-4 py-2 text-sm border-b last:border-b-0">{body}<span className="size-4" /></div>
                : <button key={c.id} type="button" onClick={() => nav(`/stats/c/${encodeURIComponent(c.id)}${search}`)} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left border-b last:border-b-0 hover:bg-accent/40">{body}<ChevronRight className="size-4 text-muted-foreground" /></button>;
            })}
          </div>
        ) : null}
        <TransactionList txs={list} emptyText="No entries in this period" />
      </Page>
    </>
  );
}
