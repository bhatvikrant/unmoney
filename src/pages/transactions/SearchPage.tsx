import { useMemo, useState } from "react";
import { SlidersHorizontal, CheckSquare, X } from "lucide-react";
import { toast } from "sonner";
import { useOp, useView } from "@/lib/store";
import { txSearch, txTags } from "../../../shared/views";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { TransactionList } from "@/components/tx/TransactionList";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/shell/Money";
import { sumKinds } from "../../../shared/ledger";
import { cn } from "@/lib/utils";

export default function SearchPage() {
  const { accounts, categories, ledger } = useApp();
  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState<"any" | "income" | "expense" | "transfer">("any");
  const [account, setAccount] = useState<string>("any");
  const [category, setCategory] = useState<string>("any");
  const [tag, setTag] = useState<string>("any");
  const view = useView();
  const tags = useMemo(() => txTags(view), [view]);
  const active = !!(q.trim() || from || to || type !== "any" || account !== "any" || category !== "any" || tag !== "any");
  const results = useMemo(() => active ? txSearch(view, {
    q: q.trim() || undefined, from: from || undefined, to: to || undefined, type: type === "any" ? undefined : type,
    accountIds: account === "any" ? undefined : [account], categoryIds: category === "any" ? undefined : [category], tag: tag === "any" ? undefined : tag,
  }) : undefined, [view, active, q, from, to, type, account, category, tag]);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<null | "date" | "note" | "delete">(null);
  const [editVal, setEditVal] = useState("");
  const bulkUpdate = useOp("transactions.bulkUpdate");
  const bulkRemove = useOp("transactions.bulkRemove");
  const totals = useMemo(() => sumKinds(results ?? [], ledger), [results, ledger]);

  const ids = () => [...selected] as Id<"transactions">[];
  async function applyBulk() {
    try {
      if (edit === "delete") await bulkRemove({ ids: ids() });
      if (edit === "date") await bulkUpdate({ ids: ids(), date: editVal });
      if (edit === "note") await bulkUpdate({ ids: ids(), note: editVal });
      toast.success("Done");
      setSelected(new Set()); setEdit(null); setEditVal("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <>
      <PageHeader back="/" title="Search" right={
        <Button variant="ghost" size="icon" aria-label="Select" className={cn(selectMode && "text-primary")} onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}><CheckSquare className="size-5" /></Button>
      } sub={
        <div className="mx-auto max-w-3xl px-3 pb-2 space-y-2">
          <div className="flex gap-2">
            <Input autoFocus placeholder="Search notes, descriptions, tags" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant={showFilters ? "secondary" : "outline"} size="icon" aria-label="Filters" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal className="size-4" /></Button>
          </div>
          {showFilters ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}><SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger><SelectContent><SelectItem value="any">Any type</SelectItem><SelectItem value="income">Income</SelectItem><SelectItem value="expense">Expense</SelectItem><SelectItem value="transfer">Transfer</SelectItem></SelectContent></Select>
              <Select value={account} onValueChange={setAccount}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any account</SelectItem>{accounts.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}</SelectContent></Select>
              <Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any category</SelectItem>{categories.filter((c) => !c.deletedAt).map((c) => <SelectItem key={c._id} value={c._id}>{c.parentId ? "  ↳ " : ""}{c.name}{c.parentId ? "" : ` (${c.type})`}</SelectItem>)}</SelectContent></Select>
              <Select value={tag} onValueChange={setTag}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any tag</SelectItem>{tags.map((t) => <SelectItem key={t.tag} value={t.tag}>#{t.tag} ({t.count})</SelectItem>)}</SelectContent></Select>
            </div>
          ) : null}
          {results ? <div className="text-xs text-muted-foreground flex gap-3"><span>{results.length} results</span><Money amount={totals.income} kind="income" /><Money amount={totals.expense} kind="expense" /></div> : null}
        </div>
      } />
      <Page className={cn(selectMode && "pb-32")}>
        {!active ? <div className="p-10 text-center text-sm text-muted-foreground">Type to search, or open the filters.</div> : null}
        {active && results === undefined ? <div className="p-8 text-center text-sm text-muted-foreground">Searching…</div> : null}
        {results ? <TransactionList txs={results} selectable={selectMode} selected={selected} onToggle={(id, v) => setSelected((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; })} emptyText="No matches" /> : null}
      </Page>
      {selectMode ? (
        <div className="fixed bottom-16 md:bottom-0 inset-x-0 md:left-56 z-30 bg-background/95 backdrop-blur border-t safe-bottom">
          <div className="mx-auto max-w-3xl flex items-center gap-2 p-3 text-sm overflow-x-auto">
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set((results ?? []).map((t) => t._id)))}>Select all</Button>
            <span className="text-muted-foreground">{selected.size} selected</span>
            <span className="flex-1" />
            <Button variant="outline" size="sm" disabled={!selected.size} onClick={() => setEdit("date")}>Change date</Button>
            <Button variant="outline" size="sm" disabled={!selected.size} onClick={() => setEdit("note")}>Change note</Button>
            <Button variant="destructive" size="sm" disabled={!selected.size} onClick={() => setEdit("delete")}>Delete</Button>
            <Button variant="ghost" size="icon" aria-label="Exit selection" onClick={() => { setSelectMode(false); setSelected(new Set()); }}><X className="size-4" /></Button>
          </div>
        </div>
      ) : null}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit === "delete" ? `Delete ${selected.size} entries?` : edit === "date" ? "Set a new date" : "Set a new note"}</DialogTitle></DialogHeader>
          {edit === "date" ? <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={editVal} onChange={(e) => setEditVal(e.target.value)} /></div> : null}
          {edit === "note" ? <div className="space-y-1.5"><Label>Note</Label><Input value={editVal} onChange={(e) => setEditVal(e.target.value)} /></div> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant={edit === "delete" ? "destructive" : "default"} onClick={applyBulk} disabled={edit !== "delete" && !editVal}>{edit === "delete" ? "Delete" : "Apply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
