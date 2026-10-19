import { useSearchParams } from "react-router";
import { useMemo, useState } from "react";
import { SlidersHorizontal, CheckSquare } from "lucide-react";
import { useView } from "@/lib/store";
import { txSearch, txTags } from "../../../shared/views";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { TransactionList } from "@/components/tx/TransactionList";
import { BulkBar } from "@/components/tx/BulkActions";
import { useBulkSelect } from "@/components/tx/useBulkSelect";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money } from "@/components/shell/Money";
import { sumKinds } from "../../../shared/ledger";
import { cn } from "@/lib/utils";

const PAGE = 300;

export default function SearchPage() {
  const { accounts, categories, ledger } = useApp();
  // Kept in the URL, so opening a result and coming back finds the same search.
  const [sp, setSp] = useSearchParams();
  const param = <T extends string>(key: string, fallback: T) => [
    (sp.get(key) ?? fallback) as T,
    (v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v && v !== fallback) n.set(key, v); else n.delete(key); return n; }, { replace: true }),
  ] as const;
  // The box keeps its own state: the router updates the URL inside a transition, and an input
  // driven from there would lose keystrokes and its caret. The URL just mirrors it.
  const [urlQ, setUrlQ] = param("q", "");
  const [q, setQState] = useState<string>(urlQ);
  const setQ = (v: string) => { setQState(v); setUrlQ(v); };
  const [showFilters, setShowFilters] = useState(() => ["from", "to", "type", "account", "category", "tag"].some((k) => sp.has(k)));
  const [from, setFrom] = param("from", "");
  const [to, setTo] = param("to", "");
  const [type, setType] = param<"any" | "income" | "expense" | "transfer">("type", "any");
  const [account, setAccount] = param("account", "any");
  const [category, setCategory] = param("category", "any");
  const [tag, setTag] = param("tag", "any");
  const view = useView();
  const tags = useMemo(() => txTags(view), [view]);
  const active = !!(q.trim() || from || to || type !== "any" || account !== "any" || category !== "any" || tag !== "any");
  const results = useMemo(() => active ? txSearch(view, {
    q: q.trim() || undefined, from: from || undefined, to: to || undefined, type: type === "any" ? undefined : type,
    accountIds: account === "any" ? undefined : [account], categoryIds: category === "any" ? undefined : [category], tag: tag === "any" ? undefined : tag,
  }) : undefined, [view, active, q, from, to, type, account, category, tag]);
  const bulk = useBulkSelect();
  // every match counts in the totals and Select all; the list renders a page at a time
  const [more, setMore] = useState<{ for: typeof results; n: number }>({ for: undefined, n: PAGE });
  const shown = more.for === results ? more.n : PAGE; // a new search starts from the first page
  const totals = useMemo(() => sumKinds(results ?? [], ledger), [results, ledger]);

  return (
    <>
      <PageHeader back="/" title="Search" right={
        <Button variant="ghost" size="icon" aria-label="Select" className={cn(bulk.active && "text-primary")} onClick={() => (bulk.active ? bulk.exit() : bulk.start())}><CheckSquare className="size-5" /></Button>
      } sub={
        <div className="mx-auto max-w-3xl px-3 pb-2 space-y-2">
          <div className="flex gap-2">
            <Input autoFocus placeholder="Search notes, tags, categories, accounts" value={q} onChange={(e) => setQ(e.target.value)} />
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
          {results ? <div className="text-xs text-muted-foreground flex gap-3"><span>{results.length} {results.length === 1 ? "result" : "results"}</span><Money amount={totals.income} kind="income" /><Money amount={totals.expense} kind="expense" /></div> : null}
        </div>
      } />
      <Page className={cn(bulk.active && "pb-40")}>
        {!active ? <div className="p-10 text-center text-sm text-muted-foreground">Type to search, or open the filters.</div> : null}
        {active && results === undefined ? <div className="p-8 text-center text-sm text-muted-foreground">Searching…</div> : null}
        {results ? <TransactionList txs={results.slice(0, shown)} selectable={bulk.active} selected={bulk.selected} onToggle={bulk.toggle} onLongPress={bulk.start} emptyText="No matches" /> : null}
        {results && results.length > shown ? (
          <div className="p-4 text-center"><Button variant="outline" onClick={() => setMore({ for: results, n: shown + PAGE })}>Show more ({results.length - shown} left)</Button></div>
        ) : null}
      </Page>
      <BulkBar bulk={bulk} txs={results ?? []} />
    </>
  );
}
