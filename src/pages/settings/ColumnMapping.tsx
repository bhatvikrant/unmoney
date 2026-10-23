/**
 * "Match the columns" (docs/specs/bank-import.md): a bank statement's columns mapped onto an
 * entry, guessed from the header names and remembered per layout on this device, with a live
 * preview. Continue hands the rows to the same review a Money Manager file gets.
 */
import { useMemo, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import type { ImportRow } from "../../../shared/ops";
import { normNote } from "../../../shared/categoryLint";
import { parseNumber, toMinor } from "../../../shared/money";
import { useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { guessKind } from "@/lib/csv";
import { guessMapping, guessSign, headerNames, layoutKey, mappingReady, recallMapping, toImportRows, type BankMapping, type Grid } from "@/lib/bankImport";
import { Section } from "@/components/shell/misc";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MEMORY_KEY = "unmoney.bankMapping";
type Remembered = { mapping: BankMapping; accountId: string };
function stored(): Record<string, Remembered> {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "{}") as Record<string, Remembered>; } catch { return {}; }
}
function remember(key: string, value: Remembered) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(Object.fromEntries(Object.entries({ ...stored(), [key]: value }).slice(-10))));
  } catch { /* storage blocked: the guess runs again next time */ }
}

const NONE = "-1";
/** The payment-method choice that makes a new one from a typed name; the review lists and creates it. */
const NEW = "new";

export function ColumnMapping({ name, grid, headerRow: foundRow, onCancel, onContinue }: {
  name: string; grid: Grid; headerRow: number;
  onCancel: () => void;
  onContinue: (rows: ImportRow[], noAmount: number) => void;
}) {
  const view = useView();
  const { accounts, settings, categoryById } = useApp();
  const methods = accounts.filter((a) => !a.archivedAt && !a.hidden);
  // a method whose name (or card's bank) is in the file name, else the default one
  const fromName = methods.find((a) => [a.name, a.bankName].some((n) => n && n.length > 2 && name.toLowerCase().includes(n.toLowerCase())));
  const initial = useMemo(() => {
    const saved = recallMapping(grid, stored());
    const accountId = saved && methods.some((a) => a._id === saved.accountId) ? saved.accountId : (fromName ?? methods.find((a) => a._id === settings.defaultAccountId) ?? methods[0])?._id ?? NEW;
    const kind = methods.find((a) => a._id === accountId)?.kind;
    return { mapping: saved?.mapping ?? guessMapping(grid, foundRow, kind), accountId, saved: !!saved };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, foundRow]);
  const [m, setM] = useState<BankMapping>(initial.mapping);
  const set = (patch: Partial<BankMapping>) => setM((x) => ({ ...x, ...patch }));
  const [accountId, setAccountId] = useState(initial.accountId);
  const [newName, setNewName] = useState("");
  // once the user has set the sign rule by hand, a change of payment method leaves it alone
  const [signTouched, setSignTouched] = useState(false);
  const accountName = accountId === NEW ? newName.trim() : methods.find((a) => a._id === accountId)?.name;
  const kindOf = (id: string, name: string) => (id === NEW ? guessKind(name) : methods.find((a) => a._id === id)?.kind);
  function changeMethod(id: string, name: string) {
    setAccountId(id);
    setNewName(name);
    if (!signTouched) set({ sign: guessSign(m.drcr, kindOf(id, name)) });
  }
  const headers = headerNames(grid[m.headerRow] ?? []);

  // what the user's history files a note under, for rows without a category column
  const history = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of [...view.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
      if (t.type === "transfer" || !t.categoryId || !t.note) continue;
      const c = categoryById.get(t.categoryId);
      if (c && !c.deletedAt) map.set(`${t.type}|${normNote(t.note)}`, c.name);
    }
    return map;
  }, [view.transactions, categoryById]);
  const categoryFor = (note: string, type: "income" | "expense") => history.get(`${type}|${normNote(note)}`);
  // past spending notes and their categories, for a refund that names its merchant among bank codes
  const spent = useMemo(() => [...history].filter(([k]) => k.startsWith("expense|")).map(([k, c]) => [k.slice(8), c] as [string, string]), [history]);

  // money in that says refund or reversal becomes a refund (less spending), unless turned off here
  const [refunds, setRefunds] = useState(true);
  const ready = mappingReady(m) && !!accountName;
  const result = useMemo(() => (ready ? toImportRows(grid, m, { account: accountName!, categoryFor, refunds, spent }) : { rows: [], noAmount: 0, refunds: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, grid, m, accountName, history, refunds, spent]);
  // how many rows read as refunds with the switch on, so the switch shows only when there are some
  const refundRows = useMemo(() => (ready && !refunds ? toImportRows(grid, m, { account: accountName!, refunds: true }).refunds : result.refunds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, refunds, result, grid, m, accountName]);

  const colSelect = (label: string, value: number, onChange: (c: number) => void, optional = false) => (
    <MapRow label={label}>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="w-full" aria-label={label}><SelectValue placeholder="Pick a column" /></SelectTrigger>
        <SelectContent>
          {optional ? <SelectItem value={NONE}>None</SelectItem> : null}
          {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h}</SelectItem>)}
        </SelectContent>
      </Select>
    </MapRow>
  );
  const headerChoices = grid.slice(0, 30).map((r, i) => ({ i, cells: r.filter((c) => c.trim()) })).filter((x) => x.cells.length >= 2);

  function cont() {
    remember(layoutKey(grid[m.headerRow] ?? []), { mapping: m, accountId });
    onContinue(result.rows, result.noAmount);
  }

  return (
    <>
      <Section title="Match the columns">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <FileSpreadsheet className="size-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="text-xs text-muted-foreground">{initial.saved ? "Matched the way you did last time for this layout. Check it, then continue." : "Not a Money Manager file: say which column is which. The preview below updates as you go."}</div>
          </div>
        </div>
        <MapRow label="Header row">
          <Select value={String(m.headerRow)} onValueChange={(v) => { setM(guessMapping(grid, Number(v), kindOf(accountId, newName))); setSignTouched(false); }}>
            <SelectTrigger className="w-full" aria-label="Header row"><SelectValue /></SelectTrigger>
            <SelectContent>{headerChoices.map((x) => <SelectItem key={x.i} value={String(x.i)}>{`Row ${x.i + 1} · ${x.cells.slice(0, 3).join(", ")}`.slice(0, 60)}</SelectItem>)}</SelectContent>
          </Select>
        </MapRow>
        {colSelect("Date", m.date, (c) => set({ date: c }))}
        {colSelect("Description", m.description, (c) => set({ description: c }), true)}
        <MapRow label="Amount is in">
          <Select value={m.mode} onValueChange={(v) => set({ mode: v as BankMapping["mode"] })}>
            <SelectTrigger className="w-full" aria-label="Amount is in"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="single">One column</SelectItem><SelectItem value="split">Money out and money in columns</SelectItem></SelectContent>
          </Select>
        </MapRow>
        {m.mode === "split" ? (
          <>
            {colSelect("Money out", m.out, (c) => set({ out: c }))}
            {colSelect("Money in", m.in, (c) => set({ in: c }))}
          </>
        ) : (
          <>
            {colSelect("Amount", m.amount, (c) => set({ amount: c }))}
            <MapRow label="Money out is">
              <Select value={m.sign} onValueChange={(v) => { setSignTouched(true); set({ sign: v as BankMapping["sign"] }); }}>
                <SelectTrigger className="w-full" aria-label="Money out is"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="negativeOut">A negative amount (−500)</SelectItem>
                  <SelectItem value="positiveOut">A positive amount (card statements)</SelectItem>
                  <SelectItem value="drcr">Marked Dr in another column</SelectItem>
                </SelectContent>
              </Select>
            </MapRow>
            {m.sign === "drcr" ? colSelect("Dr / Cr column", m.drcr, (c) => set({ drcr: c })) : null}
          </>
        )}
        {colSelect("Category", m.category, (c) => set({ category: c }), true)}
      </Section>

      <Section title="Payment method">
        <MapRow label="All rows go to">
          <Select value={accountId} onValueChange={(v) => changeMethod(v, newName)}>
            <SelectTrigger className="w-full" aria-label="Payment method"><SelectValue placeholder="Pick a payment method" /></SelectTrigger>
            <SelectContent>
              {methods.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}
              <SelectItem value={NEW}>New payment method…</SelectItem>
            </SelectContent>
          </Select>
        </MapRow>
        {accountId === NEW ? (
          <MapRow label="Its name">
            <Input value={newName} onChange={(e) => changeMethod(NEW, e.target.value)} placeholder="HDFC Bank, Amex card…" aria-label="Name of the new payment method" />
          </MapRow>
        ) : null}
        {accountId === NEW ? <p className="px-4 py-2 text-xs text-muted-foreground">It is made with the import; you pick its type (bank, credit card…) in the review.</p> : null}
      </Section>

      <Section title={`Preview${result.rows.length ? ` · ${result.rows.length} rows` : ""}`}>
        {refundRows ? (
          <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b">
            <div>
              <Label htmlFor="bank-refunds" className="font-normal">Money back is a refund</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{refundRows} {refundRows === 1 ? "row says" : "rows say"} refund or reversal: {refunds ? "they reduce spending in their category instead of counting as income" : "they come in as income"}.</p>
            </div>
            <Switch id="bank-refunds" checked={refunds} onCheckedChange={setRefunds} />
          </div>
        ) : null}
        {!ready ? <div className="px-4 py-3 text-sm text-muted-foreground">Pick the date and amount columns to see the entries.</div>
          : !result.rows.length ? <div className="px-4 py-3 text-sm text-muted-foreground">No rows with an amount. Check the amount columns and the header row.</div>
          : result.rows.slice(0, 5).map((r, i) => {
            const minor = toMinor(Math.abs(parseNumber(r.amount) ?? 0), settings.decimals);
            const refund = r.type === "Refund";
            const income = r.type === "Income" || refund;
            const fromHistory = m.category < 0 && r.category !== "Other";
            return (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm">
                <div className="w-20 shrink-0 text-xs text-muted-foreground leading-tight">
                  <div className="text-foreground tabular">{r.date}</div>
                  <div className="truncate">{r.category}{fromHistory ? "*" : ""}</div>
                </div>
                <div className="min-w-0 flex-1 truncate">
                  {refund ? <span className="mr-1.5 rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">Refund</span> : null}
                  {r.note || <span className="text-muted-foreground">No description</span>}
                </div>
                <Money amount={minor} kind={income ? "income" : "expense"} sign={income} className="shrink-0" />
              </div>
            );
          })}
        {result.noAmount ? <p className="px-4 py-2 text-xs text-muted-foreground">{result.noAmount} {result.noAmount === 1 ? "row has" : "rows have"} no amount and will be left out.</p> : null}
        {ready && m.category < 0 && result.rows.some((r) => r.category !== "Other") ? <p className="px-4 py-2 text-xs text-muted-foreground">* Category from your history for the same note or merchant. The rest go to Other.</p> : null}
      </Section>

      <div className="flex gap-2 px-4 pt-4">
        <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button className="flex-1" disabled={!ready || !result.rows.length} onClick={cont}>Continue</Button>
      </div>
    </>
  );
}

function MapRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 px-4 py-2.5 border-b last:border-b-0 sm:grid-cols-[10rem_1fr] sm:items-center">
      <div className="text-sm text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
