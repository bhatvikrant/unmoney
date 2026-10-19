import { useOp } from "@/lib/store";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp, useRefreshRates } from "@/lib/app";
import { staleLabel, useFxState } from "@/lib/fxRates";
import { cn } from "@/lib/utils";
import { CURRENCIES } from "../../../shared/currencies";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BottomSheet } from "@/components/shell/BottomSheet";

export default function SubCurrencySettings() {
  const { settings: s, currencies } = useApp();
  const add = useOp("currencies.add");
  const update = useOp("currencies.update");
  const remove = useOp("currencies.remove");
  const reorder = useOp("currencies.reorder");
  const refreshRates = useRefreshRates();
  const fx = useFxState(s.mainCurrency);
  const ratesAge = currencies.some((c) => !c.isCustom) ? staleLabel(fx, "Rates") : null;
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [custom, setCustom] = useState<null | { code: string; name: string; symbol: string; rate: string; decimals: string }>(null);
  const [edit, setEdit] = useState<null | { id: Id<"currencies">; rate: string; decimals: string; symbolPosition: "before" | "after"; symbol: string; isCustom: boolean }>(null);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => { const l = q.toLowerCase(); return CURRENCIES.filter((c) => c.code !== s.mainCurrency && !currencies.some((x) => x.code === c.code) && (!l || c.code.toLowerCase().includes(l) || c.name.toLowerCase().includes(l))); }, [q, currencies, s.mainCurrency]);

  // Opening this page counts as looking at the rates: bring them up to date (a recent fetch is reused).
  useEffect(() => { void refreshRates(); }, [refreshRates]);

  async function addStandard(code: string) {
    const info = CURRENCIES.find((c) => c.code === code)!;
    setBusy(true);
    const rate = (await refreshRates())?.rates[code] ?? 1;
    try { await add({ code, name: info.name, symbol: info.symbol, rate, decimals: info.decimals, symbolPosition: info.position ?? "before", isCustom: false }); setAdding(false); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    setBusy(false);
  }
  async function refreshAll() {
    setBusy(true);
    await refreshRates({ maxAge: 0, force: true });
    setBusy(false);
  }
  const move = (i: number, dir: -1 | 1) => { const ids = currencies.map((c) => c._id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; reorder({ ids }); };

  return (
    <>
      <PageHeader back="/settings" title="Sub currencies" right={<><Button variant="ghost" size="icon" aria-label="Refresh rates" disabled={busy || !currencies.length} onClick={refreshAll}><RefreshCw className={cn("size-4", busy && "animate-spin")} /></Button><Button variant="ghost" size="icon" aria-label="Add" onClick={() => setAdding(true)}><Plus className="size-5" /></Button></>} />
      <Page className="pb-8">
        {!currencies.length ? <EmptyState title="No sub currencies" hint={`Add currencies you spend in. Rates are relative to ${s.mainCurrency} and stay up to date when you're online; past entries keep their rate.`} action={<Button onClick={() => setAdding(true)}>Add a currency</Button>} /> : null}
        <div className="bg-card border-y">
          {currencies.map((c, i) => (
            <div key={c._id} className="flex items-center gap-1 px-2 py-2 border-b last:border-b-0 text-sm">
              <Button variant="ghost" size="icon" className="size-7" aria-label="Up" onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Down" onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
              <div className="flex-1 px-1 min-w-0"><div className="truncate">{c.code} · {c.name}{c.isCustom ? " (custom)" : ""}</div><div className="text-xs text-muted-foreground">1 {s.mainCurrency} = {c.rate} {c.code} · {c.decimals} decimals</div></div>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Edit" onClick={() => setEdit({ id: c._id, rate: String(c.rate), decimals: String(c.decimals), symbolPosition: c.symbolPosition, symbol: c.symbol, isCustom: c.isCustom })}><Pencil className="size-4" /></Button>
              <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label="Delete" onClick={() => remove({ id: c._id })}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
        {ratesAge ? <p className="px-4 pt-2 text-xs text-muted-foreground">{ratesAge}</p> : null}
      </Page>
      <BottomSheet open={adding} onOpenChange={setAdding} title="Add currency">
        <div className="px-2 space-y-2">
          <Input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-64 overflow-y-auto border rounded-md divide-y">
            {options.map((c) => <button key={c.code} type="button" disabled={busy} onClick={() => addStandard(c.code)} className="w-full flex justify-between px-3 py-2 text-sm hover:bg-accent"><span>{c.name}</span><span className="text-muted-foreground">{c.code}</span></button>)}
          </div>
          <Button variant="outline" className="w-full" onClick={() => { setAdding(false); setCustom({ code: "", name: "", symbol: "", rate: "1", decimals: "2" }); }}>Custom currency (gold, points, crypto…)</Button>
        </div>
      </BottomSheet>
      <Dialog open={!!custom} onOpenChange={(o) => !o && setCustom(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Custom currency</DialogTitle></DialogHeader>
          {custom ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Code</Label><Input value={custom.code} onChange={(e) => setCustom({ ...custom, code: e.target.value.toUpperCase() })} placeholder="XAU" /></div>
              <div className="space-y-1.5"><Label>Symbol</Label><Input value={custom.symbol} onChange={(e) => setCustom({ ...custom, symbol: e.target.value })} placeholder="oz" /></div>
              <div className="space-y-1.5 col-span-2"><Label>Name</Label><Input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="Gold" /></div>
              <div className="space-y-1.5"><Label>1 {s.mainCurrency} =</Label><Input inputMode="decimal" value={custom.rate} onChange={(e) => setCustom({ ...custom, rate: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Decimals</Label><Input type="number" min={0} max={8} value={custom.decimals} onChange={(e) => setCustom({ ...custom, decimals: e.target.value })} /></div>
            </div>
          ) : null}
          <DialogFooter><Button disabled={!custom?.code || !custom.name || !(Number(custom.rate) > 0)} onClick={async () => { try { await add({ code: custom!.code, name: custom!.name, symbol: custom!.symbol || custom!.code, rate: Number(custom!.rate), decimals: Number(custom!.decimals), symbolPosition: "after", isCustom: true }); setCustom(null); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } }}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit currency</DialogTitle></DialogHeader>
          {edit ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2"><Label>1 {s.mainCurrency} =</Label><Input inputMode="decimal" value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value })} />{edit.isCustom ? null : <p className="text-xs text-muted-foreground">Updates to the latest rate when online.</p>}</div>
              <div className="space-y-1.5"><Label>Symbol</Label><Input value={edit.symbol} onChange={(e) => setEdit({ ...edit, symbol: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Decimals</Label><Input type="number" min={0} max={8} value={edit.decimals} onChange={(e) => setEdit({ ...edit, decimals: e.target.value })} /></div>
              <div className="space-y-1.5 col-span-2"><Label>Symbol position</Label><Select value={edit.symbolPosition} onValueChange={(v) => setEdit({ ...edit, symbolPosition: v as "before" | "after" })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="before">Before</SelectItem><SelectItem value="after">After</SelectItem></SelectContent></Select></div>
            </div>
          ) : null}
          <DialogFooter><Button onClick={async () => { try { await update({ id: edit!.id, rate: Number(edit!.rate), decimals: Number(edit!.decimals), symbolPosition: edit!.symbolPosition, symbol: edit!.symbol }); setEdit(null); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } }}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
