import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Search, Star, SlidersHorizontal, StickyNote, Download, X, CheckSquare } from "lucide-react";
import { toast } from "sonner";
import { useView } from "@/lib/store";
import { budgetStatus, notesRange, txCarryBefore, txExportRows, txListRange } from "../../../shared/views";
import { useApp } from "@/lib/app";
import { primeKeyboard } from "@/lib/keyboard";
import { useMonthParam } from "@/lib/period-hooks";
import { monthLabel, dateLabel } from "@/lib/format";
import { addDays, parts, todayISO, weekday, MONTH_SHORT } from "../../../shared/dates";
import { monthKey, monthRange, parseMonthKey, weekRange, weeksInRange, yearRange } from "../../../shared/period";
import { kindsOf, sumKinds } from "../../../shared/ledger";
import { toMajor } from "../../../shared/money";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { MonthNav } from "@/components/shell/MonthNav";
import { Money, SummaryBar } from "@/components/shell/Money";
import { Fab, SegmentedTabs } from "@/components/shell/misc";
import { TransactionList, type Tx } from "@/components/tx/TransactionList";
import { BulkBar } from "@/components/tx/BulkActions";
import { useBulkSelect } from "@/components/tx/useBulkSelect";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BudgetBar } from "@/components/BudgetBars";
import { downloadText, toCSV } from "@/lib/csv";
import { cn } from "@/lib/utils";

type View = "daily" | "calendar" | "weekly" | "monthly" | "summary";

export default function TransactionsPage() {
  const nav = useNavigate();
  const { settings, ledger } = useApp();
  const { month, range, shift, setMonth } = useMonthParam();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get("view") as View) || settings.startScreen;
  const setView = (v: View) => { const n = new URLSearchParams(sp); n.set("view", v); setSp(n, { replace: true }); };
  const [filterOpen, setFilterOpen] = useState(false);
  const bulk = useBulkSelect();

  const snap = useView();
  const raw = useMemo(() => txListRange(snap, range.from, range.to), [snap, range.from, range.to]);
  const carry = useMemo(() => (settings.carryOver ? txCarryBefore(snap, range.from) : 0), [snap, settings.carryOver, range.from]);

  const filterAcc = useMemo(() => new Set((sp.get("acc") ?? "").split(",").filter(Boolean)), [sp]);
  const filterCat = useMemo(() => new Set((sp.get("cat") ?? "").split(",").filter(Boolean)), [sp]);
  const filterType = sp.get("ftype") as "income" | "expense" | null;
  const filtered = filterAcc.size > 0 || filterCat.size > 0 || !!filterType;

  const txs = useMemo(() => {
    const list = raw ?? [];
    if (!filtered) return list;
    return list.filter((t) => {
      if (t.type === "transfer" && !kindsOf(t, ledger).expense) return false;
      if (filterType && t.type !== filterType) return false;
      if (filterAcc.size && !filterAcc.has(t.accountId)) return false;
      if (filterCat.size && !(t.categoryId && filterCat.has(t.categoryId)) && !(t.subcategoryId && filterCat.has(t.subcategoryId))) return false;
      return true;
    });
  }, [raw, filtered, filterType, filterAcc, filterCat, ledger]);

  const totals = useMemo(() => sumKinds(txs, ledger), [txs, ledger]);
  const total = totals.income - totals.expense + (settings.carryOver ? carry : 0);

  const clearFilter = () => { const n = new URLSearchParams(sp); n.delete("acc"); n.delete("cat"); n.delete("ftype"); setSp(n, { replace: true }); };
  const addDate = () => { const t = todayISO(); return t >= range.from && t <= range.to ? t : range.from; };

  return (
    <>
      <PageHeader
        title="Transactions"
        left={<Button variant="ghost" size="icon" aria-label="Search" onClick={() => nav("/search")}><Search className="size-5" /></Button>}
        right={
          <>
            {view === "daily" ? <Button variant="ghost" size="icon" aria-label="Select entries" className={cn(bulk.active && "text-primary")} onClick={() => (bulk.active ? bulk.exit() : bulk.start())}><CheckSquare className="size-5" /></Button> : null}
            <Button variant="ghost" size="icon" aria-label="Bookmarks" onClick={() => nav("/bookmarks")}><Star className="size-5" /></Button>
            <Button variant="ghost" size="icon" aria-label="Filter" className={cn(filtered && "text-primary")} onClick={() => setFilterOpen(true)}><SlidersHorizontal className="size-5" /></Button>
          </>
        }
        sub={
          <div className="mx-auto max-w-3xl">
            <MonthNav label={monthLabel(month)} onPrev={() => shift(-1)} onNext={() => shift(1)} onClick={() => setMonth(monthKey(parts(todayISO()).y, parts(todayISO()).m))} />
            <SegmentedTabs value={view} onChange={setView} items={[
              { value: "daily", label: "Daily" }, { value: "calendar", label: "Calendar" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "summary", label: "Summary" },
            ]} />
            {view !== "monthly" ? <SummaryBar income={totals.income} expense={totals.expense} total={total} totalLabel={settings.carryOver ? "Total (carried)" : "Total"} /> : null}
            {filtered ? (
              <div className="flex items-center gap-2 px-4 py-1.5 text-xs bg-muted/50 border-b">
                <span className="text-muted-foreground">Filtered{filterType ? ` · ${filterType}` : ""}{filterAcc.size ? ` · ${filterAcc.size} accounts` : ""}{filterCat.size ? ` · ${filterCat.size} categories` : ""}</span>
                <button type="button" className="ml-auto flex items-center gap-1 underline-offset-4 hover:underline" onClick={clearFilter}><X className="size-3" />Clear</button>
              </div>
            ) : null}
          </div>
        }
      />
      <Page className={cn(bulk.active && view === "daily" && "pb-40")}>
        {raw === undefined ? <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div> : null}
        {raw && view === "daily" ? <TransactionList txs={txs} selectable={bulk.active} selected={bulk.selected} onToggle={bulk.toggle} onLongPress={bulk.start} emptyText="No transactions this month. Tap + to add one." /> : null}
        {raw && view === "calendar" ? <CalendarView txs={txs} range={range} /> : null}
        {raw && view === "weekly" ? <WeeklyView txs={txs} range={range} /> : null}
        {view === "monthly" ? <MonthlyView month={month} onPick={(m) => { setMonth(m); setView("daily"); }} /> : null}
        {raw && view === "summary" ? <SummaryView txs={txs} month={month} range={range} /> : null}
      </Page>
      {view === "calendar" ? <Fab label="Notes" icon={<StickyNote className="size-5" />} className="bottom-[calc(var(--tabbar-h)+6rem)] md:bottom-28 size-12 bg-card text-foreground border hover:bg-accent" onClick={() => nav(`/notes?month=${month}`)} /> : null}
      {bulk.active && view === "daily" ? null : <Fab onClick={(e) => { primeKeyboard(e.currentTarget); nav(`/t/new?date=${addDate()}`); }} />}
      {view === "daily" ? <BulkBar bulk={bulk} txs={txs} /> : null}
      <FilterSheet open={filterOpen} onOpenChange={setFilterOpen} txs={raw ?? []} />
    </>
  );
}

function CalendarView({ txs, range }: { txs: Tx[]; range: { from: string; to: string } }) {
  const nav = useNavigate();
  const { settings, ledger } = useApp();
  const snap = useView();
  const notes = useMemo(() => notesRange(snap, range.from, range.to), [snap, range.from, range.to]);
  const [day, setDay] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const m = new Map<string, { income: number; expense: number; list: Tx[] }>();
    for (const t of txs) {
      const d = m.get(t.date) ?? { income: 0, expense: 0, list: [] };
      const k = kindsOf(t, ledger);
      d.income += k.income; d.expense += k.expense; d.list.push(t);
      m.set(t.date, d);
    }
    return m;
  }, [txs, ledger]);
  const noteByDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of notes) m.set(n.date, [...(m.get(n.date) ?? []), n.color]);
    return m;
  }, [notes]);
  const start = weekRange(range.from, settings.weekStartDay).from;
  const end = weekRange(range.to, settings.weekStartDay).to;
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const today = todayISO();
  const labels = [0, 1, 2, 3, 4, 5, 6].map((i) => (settings.weekStartDay + i) % 7);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const { fmt } = useApp();
  const short = (n: number) => fmt(n).replace(/^[-+]?[^\d-]+\s?/, "");
  return (
    <>
      <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground border-b">
        {labels.map((w) => <div key={w} className={cn("py-1", w === 0 && "text-expense", w === 6 && "text-income")}>{names[w]}</div>)}
      </div>
      <div className="grid grid-cols-7 border-l">
        {days.map((d) => {
          const inMonth = d >= range.from && d <= range.to;
          const data = byDay.get(d);
          const w = weekday(d);
          const dots = noteByDay.get(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => inMonth && setDay(d)}
              className={cn("min-h-[4.6rem] border-r border-b p-1 text-left flex flex-col text-[10px] leading-tight", !inMonth && "bg-muted/40 text-muted-foreground/60", d === today && "bg-primary/10")}
            >
              <span className={cn("text-xs", w === 0 && "text-expense", w === 6 && "text-income", d === today && "font-semibold")}>{parts(d).d === 1 || d === range.from ? `${String(parts(d).m).padStart(2, "0")}/${String(parts(d).d).padStart(2, "0")}` : parts(d).d}</span>
              {dots?.length ? <span className="flex gap-0.5 mt-0.5">{dots.slice(0, 4).map((c, i) => <span key={i} className="size-1.5 rounded-full" style={{ background: c }} />)}</span> : null}
              <span className="flex-1" />
              {data?.income ? <span className="text-income tabular truncate">{short(data.income)}</span> : null}
              {data?.expense ? <span className="text-expense tabular truncate">{short(data.expense)}</span> : null}
            </button>
          );
        })}
      </div>
      <BottomSheet open={!!day} onOpenChange={(o) => !o && setDay(null)} title={day ? dateLabel(day, { weekday: true, year: true }) : ""}>
        {day ? (
          <>
            <TransactionList txs={byDay.get(day)?.list ?? []} emptyText="Nothing on this day" />
            <div className="flex gap-2 px-2 pt-3">
              <Button className="flex-1" onClick={(e) => { primeKeyboard(e.currentTarget); nav(`/t/new?date=${day}`); }}>Add entry</Button>
              <Button variant="outline" className="flex-1" onClick={() => nav(`/notes?date=${day}`)}>Add note</Button>
            </div>
          </>
        ) : null}
      </BottomSheet>
    </>
  );
}

function WeeklyView({ txs, range }: { txs: Tx[]; range: { from: string; to: string } }) {
  const { settings, ledger } = useApp();
  const [open, setOpen] = useState<{ from: string; to: string } | null>(null);
  const weeks = weeksInRange(range, settings.weekStartDay);
  const rows = weeks.map((w) => {
    const list = txs.filter((t) => t.date >= w.from && t.date <= w.to);
    const k = sumKinds(list, ledger);
    return { ...w, list, ...k };
  });
  const tot = sumKinds(txs, ledger);
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-4 py-1.5 text-[11px] text-muted-foreground border-b"><span>Week</span><span>Income</span><span>Expenses</span><span>Total</span></div>
      {rows.map((r) => (
        <button key={r.from} type="button" onClick={() => setOpen(r)} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-4 py-3 border-b text-sm w-full text-left hover:bg-accent/40">
          <span className="text-xs">{dateLabel(r.from)} – {dateLabel(r.to)}</span>
          <Money amount={r.income} kind="income" className="text-xs" />
          <Money amount={r.expense} kind="expense" className="text-xs" />
          <Money amount={r.income - r.expense} className="text-xs" />
        </button>
      ))}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-4 py-3 text-sm font-medium"><span>Total</span><Money amount={tot.income} kind="income" className="text-xs" /><Money amount={tot.expense} kind="expense" className="text-xs" /><Money amount={tot.income - tot.expense} className="text-xs" /></div>
      <BottomSheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open ? `${dateLabel(open.from)} – ${dateLabel(open.to)}` : ""}>
        {open ? <TransactionList txs={txs.filter((t) => t.date >= open.from && t.date <= open.to)} /> : null}
      </BottomSheet>
    </div>
  );
}

function MonthlyView({ month, onPick }: { month: string; onPick: (m: string) => void }) {
  const { settings, ledger } = useApp();
  const { y } = parseMonthKey(month);
  const yr = yearRange(y, settings.monthStartDay);
  const snap = useView();
  const txs = useMemo(() => txListRange(snap, yr.from, yr.to), [snap, yr.from, yr.to]);
  const rows = Array.from({ length: 12 }, (_, i) => {
    const key = monthKey(y, i + 1);
    const r = monthRange(key, settings.monthStartDay);
    const k = sumKinds(txs.filter((t) => t.date >= r.from && t.date <= r.to), ledger);
    return { key, label: MONTH_SHORT[i], ...k };
  });
  const tot = sumKinds(txs, ledger);
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-4 py-1.5 text-[11px] text-muted-foreground border-b"><span>{y}</span><span>Income</span><span>Expenses</span><span>Total</span></div>
      {rows.map((r) => (
        <button key={r.key} type="button" onClick={() => onPick(r.key)} className={cn("grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-4 py-3 border-b text-sm w-full text-left hover:bg-accent/40", r.key === month && "bg-accent/30")}>
          <span>{r.label}</span>
          <Money amount={r.income} kind="income" className="text-xs" />
          <Money amount={r.expense} kind="expense" className="text-xs" />
          <Money amount={r.income - r.expense} className="text-xs" />
        </button>
      ))}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-4 py-3 text-sm font-medium"><span>Total</span><Money amount={tot.income} kind="income" className="text-xs" /><Money amount={tot.expense} kind="expense" className="text-xs" /><Money amount={tot.income - tot.expense} className="text-xs" /></div>
    </div>
  );
}

function SummaryView({ txs, month, range }: { txs: Tx[]; month: string; range: { from: string; to: string } }) {
  const nav = useNavigate();
  const snap = useView();
  const { ledger, groupById, accountById, categoryById, settings } = useApp();
  const status = useMemo(() => budgetStatus(snap, "monthly", month), [snap, month]);
  const byGroup = useMemo(() => {
    const exp = new Map<string, number>();
    const tr = new Map<string, number>();
    for (const t of txs) {
      const k = kindsOf(t, ledger);
      const g = accountById.get(t.accountId)?.groupId ?? "none";
      if (k.expense) exp.set(g, (exp.get(g) ?? 0) + k.expense);
      if (k.transfer) tr.set(g, (tr.get(g) ?? 0) + k.transfer);
    }
    const name = (g: string) => groupById.get(g)?.name ?? "Other";
    return {
      expenses: [...exp.entries()].map(([g, a]) => ({ name: name(g), amount: a })).sort((a, b) => b.amount - a.amount),
      transfers: [...tr.entries()].map(([g, a]) => ({ name: name(g), amount: a })).sort((a, b) => b.amount - a.amount),
    };
  }, [txs, ledger, accountById, groupById]);

  async function exportMonth() {
    try {
      const rows = txExportRows(snap, range.from, range.to);
      const csv = toCSV(rows.map((r) => ({
        Date: r.time ? `${r.date} ${r.time}` : r.date, Account: r.account, Category: r.category, Subcategory: r.subcategory, Note: r.note,
        Amount: toMajor(Number(r.amount), settings.decimals), "Income/Expense": r.type, Description: r.description,
        "Amount Sub": r.subAmount, Currency: r.subCurrency, Fee: r.fee === "" ? "" : toMajor(Number(r.fee), settings.decimals), Tags: r.tags,
      })));
      downloadText(`UnMoney-${month}.csv`, csv, "text/csv");
    } catch { toast.error("Export failed"); }
  }

  return (
    <div className="pb-8">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-xs text-muted-foreground">Budget remaining</div>
          <div className="text-xl font-semibold tabular">{status?.total ? <Money amount={status.total.remaining} kind={status.total.remaining < 0 ? "expense" : "plain"} /> : "—"}</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => nav("/budget/settings")}>Budget setting ›</Button>
      </div>
      {status?.total ? <div className="border-y bg-card"><BudgetBar item={status.total} label="Monthly" elapsed={status.elapsed} onClick={() => nav("/budget")} /></div> : null}
      {status?.perCategory.length ? (
        <div className="border-y bg-card mt-2">
          {status.perCategory.map((it) => <BudgetBar key={it.budget._id} item={it} label={categoryById.get(it.budget.categoryId!)?.name ?? ""} elapsed={status.elapsed} onClick={() => nav("/budget")} />)}
        </div>
      ) : !status?.total ? <div className="px-4 text-xs text-muted-foreground">No budgets yet.</div> : null}

      <div className="px-4 pt-5 pb-1 text-xs uppercase tracking-wide text-muted-foreground">Expenses by account type</div>
      <div className="border-y bg-card">
        {byGroup.expenses.length ? byGroup.expenses.map((r) => <div key={r.name} className="flex justify-between px-4 py-2.5 border-b last:border-b-0 text-sm"><span>{r.name}</span><Money amount={r.amount} kind="expense" /></div>) : <div className="px-4 py-3 text-sm text-muted-foreground">None</div>}
      </div>
      <div className="px-4 pt-5 pb-1 text-xs uppercase tracking-wide text-muted-foreground">Transfers by account type</div>
      <div className="border-y bg-card">
        {byGroup.transfers.length ? byGroup.transfers.map((r) => <div key={r.name} className="flex justify-between px-4 py-2.5 border-b last:border-b-0 text-sm"><span>{r.name}</span><Money amount={r.amount} kind="transfer" /></div>) : <div className="px-4 py-3 text-sm text-muted-foreground">None</div>}
      </div>
      <div className="p-4"><Button variant="outline" className="w-full" onClick={exportMonth}><Download className="size-4" />Export this month to CSV</Button></div>
    </div>
  );
}

function FilterSheet({ open, onOpenChange, txs }: { open: boolean; onOpenChange: (o: boolean) => void; txs: Tx[] }) {
  const { accountGroups, categories, ledger } = useApp();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState<"income" | "expense" | "account">("expense");
  const [acc, setAcc] = useState<Set<string>>(() => new Set((sp.get("acc") ?? "").split(",").filter(Boolean)));
  const [cat, setCat] = useState<Set<string>>(() => new Set((sp.get("cat") ?? "").split(",").filter(Boolean)));
  const totals = useMemo(() => {
    const byCat = new Map<string, number>();
    const byAcc = new Map<string, { income: number; expense: number }>();
    for (const t of txs) {
      const k = kindsOf(t, ledger);
      if (t.categoryId) byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + k.income + k.expense);
      const a = byAcc.get(t.accountId) ?? { income: 0, expense: 0 };
      a.income += k.income; a.expense += k.expense; byAcc.set(t.accountId, a);
    }
    return { byCat, byAcc };
  }, [txs, ledger]);
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setter(n); };
  const apply = () => {
    const n = new URLSearchParams(sp);
    if (acc.size) n.set("acc", [...acc].join(",")); else n.delete("acc");
    if (cat.size) n.set("cat", [...cat].join(",")); else n.delete("cat");
    const hasInc = [...cat].some((id) => categories.find((c) => c._id === id)?.type === "income");
    const hasExp = [...cat].some((id) => categories.find((c) => c._id === id)?.type === "expense");
    if (hasInc && !hasExp) n.set("ftype", "income"); else if (hasExp && !hasInc) n.set("ftype", "expense"); else n.delete("ftype");
    setSp(n, { replace: true });
    onOpenChange(false);
  };
  const cats = categories.filter((c) => c.type === tab && !c.parentId && !c.deletedAt);
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Filter">
      <SegmentedTabs value={tab} onChange={setTab} items={[{ value: "income", label: "Income" }, { value: "expense", label: "Expenses" }, { value: "account", label: "Account" }]} className="mb-2" />
      {tab === "account" ? (
        accountGroups.map((g) => (
          <div key={g.group._id}>
            <div className="px-2 py-1 text-xs text-muted-foreground">{g.group.name}</div>
            {g.accounts.map((a) => (
              <label key={a._id} className="flex items-center gap-3 px-2 py-2 text-sm">
                <Checkbox checked={acc.has(a._id)} onCheckedChange={() => toggle(acc, setAcc, a._id)} />
                <span className="flex-1">{a.name}</span>
                <span className="text-xs text-right"><Money amount={totals.byAcc.get(a._id)?.income ?? 0} kind="income" /> · <Money amount={totals.byAcc.get(a._id)?.expense ?? 0} kind="expense" /></span>
              </label>
            ))}
          </div>
        ))
      ) : (
        cats.map((c) => (
          <label key={c._id} className="flex items-center gap-3 px-2 py-2 text-sm">
            <Checkbox checked={cat.has(c._id)} onCheckedChange={() => toggle(cat, setCat, c._id)} />
            <span className="flex-1">{c.name}</span>
            <Money amount={totals.byCat.get(c._id) ?? 0} kind={tab} className="text-xs" />
          </label>
        ))
      )}
      <div className="flex gap-2 px-2 pt-3">
        <Button variant="outline" className="flex-1" onClick={() => { setAcc(new Set()); setCat(new Set()); }}>Reset</Button>
        <Button className="flex-1" onClick={apply}>Filter</Button>
      </div>
    </BottomSheet>
  );
}
