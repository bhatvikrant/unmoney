import { useOp } from "@/lib/store";
import { useLocation, useNavigate } from "react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBulkOps } from "@/lib/bulk";
import { useApp } from "@/lib/app";
import { getRates } from "@/lib/fxRates";
import { CURRENCIES } from "../../../shared/currencies";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatMoney } from "../../../shared/money";
import { scaleAmount } from "../../../shared/ops";

/** Fewer decimals round every stored amount; the same sentence wherever that is about to happen. */
const ROUNDING_WARNING = "Entries, balances, budgets and schedules are all rounded, and the digits dropped cannot be brought back.";

export default function CurrencySettings() {
  const { settings: s, fmt, currencies } = useApp();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const update = useOp("settings.update");
  const bulk = useBulkOps();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [fewer, setFewer] = useState<number | null>(null); // fewer decimals rounds every amount: confirm first
  const setDecimals = (d: number) => { if (d < s.decimals) setFewer(d); else if (d > s.decimals) void bulk.changeDecimals(d).catch(() => {}); };
  const example = (d: number) => fmt(123456).replace(/[\d.,]+/, (123456 / 10 ** s.decimals).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const next = CURRENCIES.find((c) => c.code === picking);
  // "Keep entries" rescales every amount to the new currency's decimals (bulk.changeMainCurrency): the preview shows that, and fewer decimals warn as the decimals setting does
  const fewerDigits = !!next && next.decimals < s.decimals;
  const afterSwitch = (minor: number) => (next ? formatMoney(scaleAmount(minor, 10 ** (next.decimals - s.decimals)), { symbol: next.symbol, symbolPosition: next.position ?? "before", decimals: next.decimals }) : "");
  /** Starting over wipes every entry: a second, plainly worded question first. */
  async function startOver(code: string) {
    setPicking(null);
    if (!(await confirm({ title: "Delete all entries?", description: `Every entry in UnMoney is deleted and the ledger starts again in ${code}. This cannot be undone.`, action: "Delete all entries" }))) return;
    void bulk.changeMainCurrency(code, false).catch(() => {});
  }
  const list = useMemo(() => { const l = q.toLowerCase(); return CURRENCIES.filter((c) => c.code !== s.mainCurrency && (!l || c.code.toLowerCase().includes(l) || c.name.toLowerCase().includes(l))); }, [q, s.mainCurrency]);
  return (
    <>
      <PageHeader back="/settings" title="Currencies" />
      <Page className="pb-8">
        <Section title="Main currency">
          <Row label={s.mainCurrency} value={fmt(123456)} />
          <Row label="Symbol" right={(id) => <SymbolField labelledBy={id} value={s.symbol} onSave={(symbol) => update({ patch: { symbol } })} />} />
          <Row label="Symbol position" right={(id) => <Select value={s.symbolPosition} onValueChange={(v) => update({ patch: { symbolPosition: v as "before" | "after" } })}><SelectTrigger aria-labelledby={id} className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="before">Before</SelectItem><SelectItem value="after">After</SelectItem></SelectContent></Select>} />
          <Row label="Decimal places" hint="How many digits after the point amounts keep" right={(id) => <Select value={String(s.decimals)} onValueChange={(v) => setDecimals(Number(v))}><SelectTrigger aria-labelledby={id} className="h-8 w-20"><SelectValue /></SelectTrigger><SelectContent>{[0, 1, 2, 3, 4].map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}</SelectContent></Select>} />
        </Section>
        <Section>
          <Row label="Sub currencies" value={currencies.length ? currencies.map((c) => c.code).join(", ") : "None"} info="Extra currencies you spend in. Each has a rate against your main currency, and amounts are converted with the rate in force when you entered them." active={pathname.startsWith("/settings/sub-currencies")} onClick={() => nav("/settings/sub-currencies")} right={<ChevronRight className="size-4 text-muted-foreground" />} />
        </Section>
        <AlertDialog open={fewer !== null} onOpenChange={(o) => !o && setFewer(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Round every amount to {fewer} decimal {fewer === 1 ? "place" : "places"}?</AlertDialogTitle>
              <AlertDialogDescription>{fmt(123456)} becomes {fewer !== null ? example(fewer) : ""}. {ROUNDING_WARNING}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { void bulk.changeDecimals(fewer!).catch(() => {}); setFewer(null); }}>Round amounts</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Section title="Change main currency">
          <div className="p-3"><Input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="max-h-80 overflow-y-auto">
            {list.map((c) => <button key={c.code} type="button" onClick={() => { setPicking(c.code); void getRates(c.code); }} className={cn("w-full flex justify-between px-4 py-2.5 text-sm border-t hover:bg-accent/40")}><span>{c.name}</span><span className="text-muted-foreground">{c.code} · {c.symbol}</span></button>)}
          </div>
        </Section>
      </Page>
      <AlertDialog open={!!picking} onOpenChange={(o) => !o && setPicking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to {picking}?</AlertDialogTitle>
            <AlertDialogDescription>
              Amounts are not converted: they keep their numbers and are shown in {picking}
              {next ? <>, so {fmt(123456)} becomes {afterSwitch(123456)}</> : null}.
              {fewerDigits ? ` ${picking} has ${next.decimals === 0 ? "no decimals" : `${next.decimals} decimal ${next.decimals === 1 ? "place" : "places"}`}, so amounts are rounded. ${ROUNDING_WARNING}` : null}
              {" "}Or delete every entry and start over.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => void startOver(picking!)}>Delete all entries…</Button>
            <AlertDialogAction onClick={() => { void bulk.changeMainCurrency(picking!, true).catch(() => {}); setPicking(null); }}>Keep entries</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Typed here, saved once on blur or Enter: an input bound straight to a synced op lost keystrokes while each one went round through the store. */
function SymbolField({ value, onSave, labelledBy }: { value: string; onSave: (v: string) => void; labelledBy: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { const v = draft.trim(); if (v && v !== value) onSave(v); else setDraft(value); };
  return <Input className="h-8 w-24" aria-labelledby={labelledBy} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}
