import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Archive, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useOp, useStore, useView } from "@/lib/store";
import { accountGet, cardStatements, creditAvailable, txSearch } from "../../../shared/views";
import { cn } from "@/lib/utils";
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
import { amountInput, dateLabel, monthLabel, reconciledLabel, LOCALE_DECIMAL } from "@/lib/format";
import { drawsFromLinked } from "../../../shared/ledger";
import { monthKey, parseMonthKey, yearRange } from "../../../shared/period";
import { todayISO } from "../../../shared/dates";
import { useToday } from "@/lib/today";
import { toMinor } from "../../../shared/money";
import { cardColorOf } from "../../../shared/defaults";
import { CardFace } from "@/components/CardFace";
import { AdjustBalanceDialog } from "./AdjustBalanceDialog";

export default function AccountDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { settings, categoryById, accountName, accounts, accountById, fmt } = useApp();
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
  // a statement picked below: the entry list shows that cycle instead of the month
  const [cycle, setCycle] = useState<{ from: string; to: string } | null>(null);
  // quiet cycles (nothing charged or paid) are left out, except the open one
  const statements = useMemo(() => cardStatements(view, realId, today, 6).filter((st) => st.open || st.charges || st.payments), [view, realId, today]);
  const cycleTxs = useMemo(() => (cycle ? txSearch(view, { accountIds: [realId], from: cycle.from, to: cycle.to }) : null), [view, realId, cycle]);
  // "Pay" from the ledger's due reminder opens the payment straight away
  const [sp, setSp] = useSearchParams();
  const payNow = sp.get("pay") === "1" && !!data?.card;
  useEffect(() => {
    if (!payNow || !data?.card) return;
    setPay({ amount: amountInput(data.card.payable || data.card.owed, settings.decimals), date: todayISO(), from: accounts.some((x) => x._id === data.account.billingAccountId && x.kind !== "card") ? data.account.billingAccountId! : "" });
    setSp((p) => { const n = new URLSearchParams(p); n.delete("pay"); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payNow]);
  const [adjusting, setAdjusting] = useState(false);
  if (!data) return <><PageHeader back="/payment-methods" title="" /><div className="p-8 text-center text-sm text-muted-foreground">Payment method not found</div></>;
  const a = data.account;
  // a debit card or linked UPI spends from its bank: its own balance means nothing, its usage does
  const row = accountById.get(a._id);
  const linked = row?.linked;
  const available = data.kind === "card" && row ? creditAvailable(row) : undefined;
  const used = available !== undefined && a.creditLimit ? Math.max(0, Math.min(1, (a.creditLimit - available) / a.creditLimit)) : 0;
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
            <CardFace kind={data.kind} name={a.name} bankName={a.bankName} last4={a.last4} color={cardColorOf({ kind: data.kind, color: a.color })} className="mx-auto sm:mx-0"
              footer={available !== undefined ? <><span className="block text-[10px] uppercase tracking-wider opacity-75">Available</span><span className="text-sm font-semibold tabular">{fmt(available)}</span></> : undefined} />
          </div>
        ) : null}
        {linked ? (
          <div className="px-4 py-2">
            <div className="text-xs text-muted-foreground">Spends from {accountName(a.linkedAccountId)}</div>
            <Money amount={row?.monthlyUsage ?? 0} kind="expense" className="text-xl font-semibold" /> <span className="text-xs text-muted-foreground">this month</span>
          </div>
        ) : (
        <div className="flex items-center justify-between px-4 py-2">
          <div>
            <div className="text-xs text-muted-foreground">{data.kind === "card" ? "Card balance today" : "Balance today"}</div>
            <Money amount={data.balance} kind={data.balance < 0 ? "expense" : "income"} className="text-xl font-semibold" />
            {data.upcoming ? <div className="text-xs text-muted-foreground">Upcoming <Money amount={data.upcoming} sign muted /> · then <Money amount={data.balance + data.upcoming} muted /></div> : null}
            {/* a debit card or linked UPI has no balance of its own: its bank is the one to check */}
            {!drawsFromLinked({ kind: data.kind, linkedAccountId: a.linkedAccountId }) ? (
              <div className="text-xs text-muted-foreground">
                {a.reconciledAt ? `${reconciledLabel(a.reconciledAt, today)} · ` : null}
                <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={() => setAdjusting(true)}>Adjust balance</button>
              </div>
            ) : null}
          </div>
          {data.card ? (
            <div className="text-right text-xs">
              <div>Payable <Money amount={data.card.payable} kind="expense" /></div>
              {data.card.payable > 0 && data.card.due ? (
                today > data.card.due ? <div className="text-destructive font-medium">Overdue since {dateLabel(data.card.due)}</div> : <div className="text-muted-foreground">Due {dateLabel(data.card.due)}</div>
              ) : null}
              <div>Outstanding <Money amount={data.card.outstanding} kind="expense" /></div>
              <Button size="sm" className="mt-1" onClick={() => setPay({ amount: amountInput(data.card!.payable || data.card!.owed, settings.decimals), date: todayISO(), from: accounts.some((x) => x._id === a.billingAccountId && x.kind !== "card") ? a.billingAccountId! : "" })}>Pay</Button>
            </div>
          ) : null}
        </div>
        )}
        {available !== undefined && a.creditLimit ? (
          <div className="px-4 pb-2">
            <div className="flex justify-between gap-3 text-xs text-muted-foreground">
              <span>Available <Money amount={available} kind={available < 0 ? "expense" : "plain"} className="text-foreground" /></span>
              <span>{Math.round(used * 100)}% of <Money amount={a.creditLimit} muted /> used</span>
            </div>
            <div className="mt-1 h-1.5 rounded bg-muted overflow-hidden" role="progressbar" aria-label="Credit limit used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)}>
              <div className={cn("h-full rounded", used >= 0.8 ? "bg-expense" : used >= 0.3 ? "bg-expense/60" : "bg-income")} style={{ width: `${used * 100}%` }} />
            </div>
          </div>
        ) : null}
        {linked ? null : <div className="px-1"><BalanceLine data={data.series} /></div>}
        {([["Expenses", data.expenses, "expense"], ["Income", data.income, "income"], ["Transfer in", data.transfersIn, "income"], ["Transfer out", data.transfersOut, "expense"]] as const).map(([title, list, kind]) => list.length ? (
          <div key={title} className="mt-3">
            <div className="flex justify-between px-4 py-1 text-xs text-muted-foreground"><span>{title}</span><Money amount={list.reduce((s, x) => s + x.amount, 0)} kind={kind} /></div>
            <div className="bg-card border-y">
              {list.map((x) => { const total = list.reduce((s, y) => s + y.amount, 0); return <div key={x.key} className="flex items-center gap-3 px-4 py-2 border-b last:border-b-0 text-sm"><span className="text-[11px] w-10 text-center rounded bg-muted px-1 py-0.5">{total ? Math.round((x.amount / total) * 100) : 0}%</span><span className="flex-1 truncate">{nameOf(x.key)}</span><Money amount={x.amount} kind={kind} /></div>; })}
            </div>
          </div>
        ) : null)}
        {statements.length ? (
          <div className="mt-3">
            <div className="px-4 py-1 text-xs text-muted-foreground">Statements</div>
            <div className="bg-card border-y">
              {statements.map((st) => {
                const on = cycle?.from === st.from;
                return (
                  <button key={st.from} type="button" aria-pressed={on} onClick={() => setCycle(on ? null : { from: st.from, to: st.to })}
                    className={cn("w-full flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm text-left hover:bg-accent/40", on && "bg-accent")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{dateLabel(st.from)} – {dateLabel(st.to)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{st.open ? "Open · so far" : st.due ? `Due ${dateLabel(st.due, { year: st.due.slice(0, 4) !== today.slice(0, 4) })}` : "Closed"}{st.payments ? <> · paid <Money amount={st.payments} muted /></> : null}</span>
                    </span>
                    <Money amount={st.charges} kind="expense" />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="mt-4 flex items-center justify-between px-4 py-1 text-xs text-muted-foreground">
          <span>{cycle ? `Transactions · ${dateLabel(cycle.from)} – ${dateLabel(cycle.to)}` : "Transactions"}</span>
          {cycle ? <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={() => setCycle(null)}>Show the month</button> : null}
        </div>
        <TransactionList txs={cycleTxs ?? data.transactions} emptyText={cycle ? "No transactions in this statement" : "No transactions in this period"} />
      </Page>
      <AdjustBalanceDialog open={adjusting} onOpenChange={setAdjusting} account={a} kind={data.kind} balance={data.balance} today={today} />
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
