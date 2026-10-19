import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Archive, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useOp, useStore, useView } from "@/lib/store";
import { accountGet } from "../../../shared/views";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { MonthNav } from "@/components/shell/MonthNav";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BalanceLine } from "@/pages/stats/charts";
import { TransactionList } from "@/components/tx/TransactionList";
import { useMonthParam, useMonthsWithData, usePeriodNeighbours } from "@/lib/period-hooks";
import { amountInput, monthLabel, LOCALE_DECIMAL } from "@/lib/format";
import { monthKey, parseMonthKey, yearRange } from "../../../shared/period";
import { todayISO } from "../../../shared/dates";
import { useToday } from "@/lib/today";
import { toMinor } from "../../../shared/money";
import { cardColorOf } from "../../../shared/defaults";
import { CardFace } from "@/components/CardFace";

export default function AccountDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { settings, categoryById, accountName, accounts, fmt } = useApp();
  const { month, range, setMonth } = useMonthParam();
  const [gran, setGran] = useState<"daily" | "monthly" | "yearly">("daily");
  const r = gran === "yearly" ? yearRange(parseMonthKey(month).y, settings.monthStartDay) : range;
  const view = useView();
  const { resolveId } = useStore();
  const realId = resolveId(id ?? "");
  const monthsWithData = useMonthsWithData("transactions", realId);
  // Yearly steps between years this account has entries in, keeping the month; otherwise between its months.
  const yearly = gran === "yearly";
  const nb = usePeriodNeighbours(yearly ? "yearly" : "monthly", yearly ? String(parseMonthKey(month).y) : month, monthsWithData.dates);
  const go = (k: string) => setMonth(yearly ? monthKey(Number(k), parseMonthKey(month).m) : k);
  const today = useToday();
  const data = useMemo(() => accountGet(view, realId, gran, r.from, r.to, today), [view, realId, gran, r.from, r.to, today]);
  const payCard = useOp("accounts.payCard");
  const setArchived = useOp("accounts.setArchived");
  const [pay, setPay] = useState<{ amount: string; date: string; from: string } | null>(null);
  if (!data) return <><PageHeader back="/payment-methods" title="" /><div className="p-8 text-center text-sm text-muted-foreground">Payment method not found</div></>;
  const a = data.account;
  const nameOf = (key: string) => categoryById.get(key)?.name ?? (key === "none" ? "Uncategorised" : accountName(key));
  return (
    <>
      <PageHeader back="/payment-methods" title={a.name} right={<><Button variant="ghost" size="icon" aria-label="Edit" onClick={() => nav(`/payment-methods/${a._id}/edit`)}><Pencil className="size-4" /></Button>
        <Select value={gran} onValueChange={(v) => setGran(v as typeof gran)}><SelectTrigger className="h-8 w-16"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">D</SelectItem><SelectItem value="monthly">M</SelectItem><SelectItem value="yearly">Y</SelectItem></SelectContent></Select></>}
        sub={<div className="mx-auto max-w-3xl"><MonthNav label={yearly ? String(parseMonthKey(month).y) : monthLabel(month)} onPrev={nb.prev ? () => go(nb.prev!) : undefined} onNext={nb.next ? () => go(nb.next!) : undefined} month={month} onPick={setMonth} withData={monthsWithData.months} spent={monthsWithData.spent} /></div>} />
      <Page className="pb-8">
        {a.archivedAt ? (
          <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2 text-sm" role="status">
            <Archive className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-muted-foreground">Archived. Not offered when adding entries; its entries still count.</span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => setArchived({ ids: [a._id], archived: false }).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))}>Unarchive</Button>
          </div>
        ) : null}
        {data.kind === "card" || data.kind === "debitCard" ? (
          <div className="px-4 pt-4 pb-1">
            <CardFace kind={data.kind} name={a.name} bankName={a.bankName} last4={a.last4} color={cardColorOf({ kind: data.kind, color: a.color })} className="mx-auto sm:mx-0" />
          </div>
        ) : null}
        <div className="flex items-center justify-between px-4 py-2">
          <div>
            <div className="text-xs text-muted-foreground">{data.kind === "card" ? "Card balance today" : "Balance today"}</div>
            <Money amount={data.balance} kind={data.balance < 0 ? "expense" : "income"} className="text-xl font-semibold" />
            {data.upcoming ? <div className="text-xs text-muted-foreground">Upcoming <Money amount={data.upcoming} sign muted /> · then <Money amount={data.balance + data.upcoming} muted /></div> : null}
          </div>
          {data.card ? (
            <div className="text-right text-xs">
              <div>Payable <Money amount={data.card.payable} kind="expense" /></div>
              <div>Outstanding <Money amount={data.card.outstanding} kind="expense" /></div>
              <Button size="sm" className="mt-1" onClick={() => setPay({ amount: amountInput(data.card!.payable || data.card!.owed, settings.decimals), date: todayISO(), from: a.billingAccountId ?? "" })}>Pay</Button>
            </div>
          ) : null}
        </div>
        <div className="px-1"><BalanceLine data={data.series} /></div>
        {([["Expenses", data.expenses, "expense"], ["Income", data.income, "income"], ["Transfer in", data.transfersIn, "income"], ["Transfer out", data.transfersOut, "expense"]] as const).map(([title, list, kind]) => list.length ? (
          <div key={title} className="mt-3">
            <div className="flex justify-between px-4 py-1 text-xs text-muted-foreground"><span>{title}</span><Money amount={list.reduce((s, x) => s + x.amount, 0)} kind={kind} /></div>
            <div className="bg-card border-y">
              {list.map((x) => { const total = list.reduce((s, y) => s + y.amount, 0); return <div key={x.key} className="flex items-center gap-3 px-4 py-2 border-b last:border-b-0 text-sm"><span className="text-[11px] w-10 text-center rounded bg-muted px-1 py-0.5">{total ? Math.round((x.amount / total) * 100) : 0}%</span><span className="flex-1 truncate">{nameOf(x.key)}</span><Money amount={x.amount} kind={kind} /></div>; })}
            </div>
          </div>
        ) : null)}
        <div className="mt-4 px-4 py-1 text-xs text-muted-foreground">Transactions</div>
        <TransactionList txs={data.transactions} emptyText="No transactions in this period" />
      </Page>
      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pay {a.name}</DialogTitle></DialogHeader>
          {pay ? (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Amount ({settings.mainCurrency})</Label><Input inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Pay from</Label>
                <Select value={pay.from} onValueChange={(v) => setPay({ ...pay, from: v })}><SelectTrigger className="w-full"><SelectValue placeholder="Pick" /></SelectTrigger><SelectContent>{accounts.filter((x) => x._id !== a._id && x.kind !== "card" && (!x.archivedAt || x._id === pay.from)).map((x) => <SelectItem key={x._id} value={x._id}>{x.name} · {fmt(x.balance)}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>
          ) : null}
          <DialogFooter><Button disabled={!pay?.from || !pay?.amount} onClick={async () => { try { await payCard({ id: a._id, amount: toMinor(pay!.amount, settings.decimals, LOCALE_DECIMAL), date: pay!.date, fromAccountId: pay!.from as Id<"accounts"> }); setPay(null); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } }}>Record payment</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
