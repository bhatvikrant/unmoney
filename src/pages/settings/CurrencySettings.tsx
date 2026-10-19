import { useOp } from "@/lib/store";
import { useMemo, useState } from "react";
import { useBulkOps } from "@/lib/bulk";
import { useApp } from "@/lib/app";
import { CURRENCIES } from "../../../shared/currencies";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export default function CurrencySettings() {
  const { settings: s, fmt } = useApp();
  const update = useOp("settings.update");
  const bulk = useBulkOps();
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [fewer, setFewer] = useState<number | null>(null); // fewer decimals rounds every amount: confirm first
  const setDecimals = (d: number) => { if (d < s.decimals) setFewer(d); else if (d > s.decimals) void bulk.changeDecimals(d).catch(() => {}); };
  const example = (d: number) => fmt(123456).replace(/[\d.,]+/, (123456 / 10 ** s.decimals).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const list = useMemo(() => { const l = q.toLowerCase(); return CURRENCIES.filter((c) => c.code !== s.mainCurrency && (!l || c.code.toLowerCase().includes(l) || c.name.toLowerCase().includes(l))); }, [q, s.mainCurrency]);
  return (
    <>
      <PageHeader back="/settings" title="Main currency" />
      <Page className="pb-8">
        <Section title="Current">
          <Row label={s.mainCurrency} value={fmt(123456)} />
          <Row label="Symbol" right={<Input className="h-8 w-24" value={s.symbol} onChange={(e) => update({ patch: { symbol: e.target.value } })} />} />
          <Row label="Symbol position" right={<Select value={s.symbolPosition} onValueChange={(v) => update({ patch: { symbolPosition: v as "before" | "after" } })}><SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="before">Before</SelectItem><SelectItem value="after">After</SelectItem></SelectContent></Select>} />
          <Row label="Decimal places" hint="How many digits after the point amounts keep" right={<Select value={String(s.decimals)} onValueChange={(v) => setDecimals(Number(v))}><SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger><SelectContent>{[0, 1, 2, 3, 4].map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}</SelectContent></Select>} />
        </Section>
        <AlertDialog open={fewer !== null} onOpenChange={(o) => !o && setFewer(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Round every amount to {fewer} decimal {fewer === 1 ? "place" : "places"}?</AlertDialogTitle>
              <AlertDialogDescription>{fmt(123456)} becomes {fewer !== null ? example(fewer) : ""}. Entries, balances, budgets and schedules are all rounded, and the digits dropped cannot be brought back.</AlertDialogDescription>
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
            {list.map((c) => <button key={c.code} type="button" onClick={() => setPicking(c.code)} className={cn("w-full flex justify-between px-4 py-2.5 text-sm border-t hover:bg-accent/40")}><span>{c.name}</span><span className="text-muted-foreground">{c.code} · {c.symbol}</span></button>)}
          </div>
        </Section>
      </Page>
      <AlertDialog open={!!picking} onOpenChange={(o) => !o && setPicking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Switch to {picking}?</AlertDialogTitle><AlertDialogDescription>Keep your data (amounts stay as entered and are simply shown in the new currency), or start over with an empty ledger.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={() => { void bulk.changeMainCurrency(picking!, false).catch(() => {}); setPicking(null); }}>Data initialisation</Button>
            <AlertDialogAction onClick={() => { void bulk.changeMainCurrency(picking!, true).catch(() => {}); setPicking(null); }}>Data retention</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
