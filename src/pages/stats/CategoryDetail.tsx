import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router";
import { useView } from "@/lib/store";
import { statsByCategory, statsTrend, txSearch } from "../../../shared/views";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { TrendBars } from "./charts";
import { useStatPeriod } from "./period";
import { TransactionList } from "@/components/tx/TransactionList";
import { Money } from "@/components/shell/Money";

export default function CategoryDetail() {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
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
  const txs = useMemo(() => txSearch(view, !isTransfer && id !== "none" && id !== "fees" ? { from: p.range.from, to: p.range.to, type, categoryIds: [id] } : { from: p.range.from, to: p.range.to, type: isTransfer ? "transfer" : type }), [view, isTransfer, id, p.range.from, p.range.to, type]);
  const item = breakdown?.items.find((i) => i.id === id);
  const name = isTransfer ? `Transfer to ${accountName(id.slice(9))}` : categoryById.get(id)?.name ?? item?.name ?? "Category";
  const list = (txs ?? []).filter((t) => !isTransfer || `transfer:${t.toAccountId ?? ""}` === id);
  return (
    <>
      <PageHeader back title={name} />
      <Page className="pb-8">
        <div className="flex items-baseline justify-between px-4 pt-3"><span className="text-sm text-muted-foreground">{p.label}</span><Money amount={item?.amount ?? 0} kind={type} className="text-lg font-semibold" /></div>
        <div className="px-2 py-2">{trend ? <TrendBars data={ranges.map((r, i) => ({ label: r.label, amount: trend[i]?.amount ?? 0 }))} color={type === "income" ? "var(--income)" : "var(--expense)"} /> : <div className="h-48" />}</div>
        {item && item.children.length > 1 ? (
          <div className="bg-card border-y mb-3">
            {item.children.map((c) => <div key={c.id} className="flex justify-between px-4 py-2 text-sm border-b last:border-b-0"><span>{c.name}</span><span className="flex gap-3"><span className="text-muted-foreground text-xs">{item.amount ? Math.round((c.amount / item.amount) * 100) : 0}%</span><Money amount={c.amount} kind={type} /></span></div>)}
          </div>
        ) : null}
        <TransactionList txs={list} emptyText="No entries in this period" />
      </Page>
    </>
  );
}
